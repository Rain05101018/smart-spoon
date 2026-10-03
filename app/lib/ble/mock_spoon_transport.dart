/// mock_spoon_transport.dart — 模拟勺子传输实现
///
/// 用途：硬件不在身边 / 协议未确认时，也能把「连接 → 实时数据 →
/// 用餐流程 → 数据回传记录」全链路跑通演示。
/// 生成的数据帧采用假定的简单格式（见 spoon_protocol.dart 的 TODO），
/// 协议确认后这个类只用于单元测试和演示模式。
library;

import 'dart:async';
import 'dart:math';

import 'spoon_protocol.dart';
import 'spoon_transport.dart';

class MockSpoonTransport implements SpoonTransport {
  final _stateCtrl = StreamController<SpoonLinkState>.broadcast();
  final _packetCtrl = StreamController<SpoonPacket>.broadcast();
  final _scanCtrl = StreamController<List<SpoonCandidate>>.broadcast();
  final _random = Random();

  Timer? _ticker;
  SpoonLinkState _state = SpoonLinkState.disconnected;
  int _tickCount = 0;

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
  String get deviceName => '模拟勺子 Mock-Spoon-01';
  @override
  List<String> get serviceSummary => const [
        '0000ffe0(模拟): ffe1(N), ffe2(W)',
      ];

  @override
  Future<void> startScan() async {
    _setState(SpoonLinkState.scanning);
    await Future.delayed(const Duration(seconds: 1));
    _scanCtrl.add(const [
      SpoonCandidate(id: 'MOCK:01', name: 'Mock-Spoon-01', rssi: -42),
    ]);
    _setState(SpoonLinkState.disconnected);
  }

  @override
  Future<void> stopScan() async {}

  @override
  Future<void> connect(SpoonCandidate? candidate) async {
    _setState(SpoonLinkState.connecting);
    await Future.delayed(const Duration(milliseconds: 800));
    _setState(SpoonLinkState.connected);
    _startTicker();
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      _tickCount++;
      // 假定帧格式（占位）：[0xAA, weightHi, weightLo, tempHi, tempLo, battery]
      // 模拟一顿饭的重量曲线：从满碗逐渐下降，带一点抖动
      final base = 320 - (_tickCount * 1.5).clamp(0, 280);
      final weight = (base + _random.nextDouble() * 4).clamp(0, 500);
      final temp = 62 - _tickCount * 0.15 + _random.nextDouble();
      final w = (weight * 10).round();
      final t = (temp * 10).round();
      final frame = <int>[
        0xAA,
        (w >> 8) & 0xFF,
        w & 0xFF,
        (t >> 8) & 0xFF,
        t & 0xFF,
        88,
      ];
      _packetCtrl.add(SpoonPacket(
        charUuid: SpoonProtocol.sensorNotifyUuid,
        raw: frame,
      ));
    });
  }

  @override
  Future<void> disconnect() async {
    _ticker?.cancel();
    _setState(SpoonLinkState.disconnected);
  }

  @override
  Future<void> sendCommand(List<int> bytes) async {
    // 模拟模式直接吞掉命令
  }

  @override
  Future<void> dispose() async {
    await disconnect();
    await _stateCtrl.close();
    await _packetCtrl.close();
    await _scanCtrl.close();
  }
}
