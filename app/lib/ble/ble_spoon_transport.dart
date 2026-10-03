/// ble_spoon_transport.dart — 真机蓝牙传输实现（flutter_blue_plus）
///
/// 两种工作模式（由 SpoonProtocol.confirmed 决定）：
///  - 协议未确认：订阅设备上【所有】可 notify/indicate 的特征值，原始透传
///  - 协议已确认：只订阅 SpoonProtocol.sensorNotifyUuid
library;

import 'dart:async';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import 'spoon_protocol.dart';
import 'spoon_transport.dart';

class BleSpoonTransport implements SpoonTransport {
  final _stateCtrl = StreamController<SpoonLinkState>.broadcast();
  final _packetCtrl = StreamController<SpoonPacket>.broadcast();
  final _scanCtrl = StreamController<List<SpoonCandidate>>.broadcast();

  final List<SpoonCandidate> _candidates = [];
  BluetoothDevice? _device;
  BluetoothCharacteristic? _commandChar;
  final List<StreamSubscription> _subs = [];
  final List<String> _services = [];
  SpoonLinkState _state = SpoonLinkState.disconnected;

  void _setState(SpoonLinkState s) {
    _state = s;
    _stateCtrl.add(s);
  }

  @override
  Stream<SpoonLinkState> get stateStream => _stateCtrl.stream;
  @override
  Stream<SpoonPacket> get packetStream => _packetCtrl.stream;
  @override
  Stream<List<SpoonCandidate>> get scanStream => _scanCtrl.stream;
  @override
  SpoonLinkState get currentState => _state;
  @override
  String get deviceName => _device?.platformName.isNotEmpty == true
      ? _device!.platformName
      : (_device?.remoteId.str ?? '未知设备');
  @override
  List<String> get serviceSummary => List.unmodifiable(_services);

  @override
  Future<void> startScan() async {
    // 蓝牙关闭时尝试唤起系统开启弹窗（仅 Android 有效）
    if (await FlutterBluePlus.adapterState.first != BluetoothAdapterState.on) {
      try {
        await FlutterBluePlus.turnOn();
      } catch (_) {/* 用户拒绝则继续走扫描报错 */}
    }

    _candidates.clear();
    _scanCtrl.add(const []);
    _setState(SpoonLinkState.scanning);

    _subs.add(FlutterBluePlus.scanResults.listen((results) {
      for (final r in results) {
        final name = r.advertisementData.advName.isNotEmpty
            ? r.advertisementData.advName
            : r.device.platformName;
        // 协议确认后按名称前缀过滤；未确认阶段不过滤，避免把勺子滤没了
        final idx = _candidates.indexWhere((c) => c.id == r.device.remoteId.str);
        final cand = SpoonCandidate(
          id: r.device.remoteId.str,
          name: name.isEmpty ? '(未命名设备)' : name,
          rssi: r.rssi,
          native: r.device,
        );
        if (idx >= 0) {
          _candidates[idx] = cand;
        } else {
          _candidates.add(cand);
        }
      }
      _candidates.sort((a, b) => b.rssi.compareTo(a.rssi));
      _scanCtrl.add(List.unmodifiable(_candidates));
    }));

    await FlutterBluePlus.startScan(timeout: const Duration(seconds: 10));
    await FlutterBluePlus.isScanning.where((s) => s == false).first;
    if (_state == SpoonLinkState.scanning) {
      _setState(SpoonLinkState.disconnected);
    }
  }

  @override
  Future<void> stopScan() => FlutterBluePlus.stopScan();

  @override
  Future<void> connect(SpoonCandidate? candidate) async {
    if (candidate == null) {
      throw ArgumentError('真机蓝牙必须指定候选设备');
    }
    await stopScan();
    _setState(SpoonLinkState.connecting);

    _device = candidate.native as BluetoothDevice;
    try {
      // flutter_blue_plus 2.x 要求声明使用许可（个人/非商业项目用 nonprofit）
      await _device!.connect(
        license: License.nonprofit,
        timeout: const Duration(seconds: 15),
        mtu: null, // MTU 在连接后手动申请，避免与 autoConnect 的断言冲突
      );
      // Android 默认 MTU 23，传感器数据稍大时不够，申请 247
      try {
        await _device!.requestMtu(247);
      } catch (_) {/* iOS 自动协商，忽略 */}

      final services = await _device!.discoverServices();
      _services.clear();
      for (final svc in services) {
        _services.add(
            '${svc.uuid}: ${svc.characteristics.map((c) => '${c.uuid.toString().substring(4, 8)}(${c.properties.notify ? 'N' : ''}${c.properties.read ? 'R' : ''}${c.properties.write ? 'W' : ''})').join(', ')}');
        for (final char in svc.characteristics) {
          final p = char.properties;
          final wantNotify = SpoonProtocol.confirmed
              ? char.uuid.toString() == SpoonProtocol.sensorNotifyUuid
              : (p.notify || p.indicate);
          if (wantNotify && (p.notify || p.indicate)) {
            await char.setNotifyValue(true);
            _subs.add(char.lastValueStream.listen((value) {
              if (value.isNotEmpty) {
                _packetCtrl.add(SpoonPacket(
                    charUuid: char.uuid.toString(), raw: value));
              }
            }));
          }
          if (char.uuid.toString() == SpoonProtocol.commandWriteUuid &&
              (p.write || p.writeWithoutResponse)) {
            _commandChar = char;
          }
        }
      }
      _setState(SpoonLinkState.connected);

      _subs.add(_device!.connectionState.listen((s) {
        if (s == BluetoothConnectionState.disconnected) {
          _setState(SpoonLinkState.disconnected);
        }
      }));
    } catch (e) {
      _setState(SpoonLinkState.error);
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    await _device?.disconnect();
    _device = null;
    _commandChar = null;
    _setState(SpoonLinkState.disconnected);
  }

  @override
  Future<void> sendCommand(List<int> bytes) async {
    final char = _commandChar;
    if (char == null) {
      throw StateError('命令特征值未找到（请先在 spoon_protocol.dart 配置 commandWriteUuid）');
    }
    await char.write(bytes,
        withoutResponse: char.properties.writeWithoutResponse);
  }

  @override
  Future<void> dispose() async {
    for (final s in _subs) {
      await s.cancel();
    }
    await disconnect();
    await _stateCtrl.close();
    await _packetCtrl.close();
    await _scanCtrl.close();
  }
}
