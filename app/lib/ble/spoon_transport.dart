/// spoon_transport.dart — 勺子传输层抽象
///
/// 设计权衡：协议未确认 + 真机调试成本高的阶段，
/// 把「数据怎么来」和「数据怎么用」解耦是关键。
/// App 上层（看板/用餐流程/记录）只依赖 SpoonTransport 接口：
///   - BleSpoonTransport  真机蓝牙（flutter_blue_plus）
///   - MockSpoonTransport 模拟勺子（无硬件时演示完整流程）
/// 协议确认后只需改 BleSpoonTransport 内部 + spoon_protocol.dart，上层不动。
library;

import 'dart:async';

import 'spoon_protocol.dart';

enum SpoonLinkState { disconnected, scanning, connecting, connected, error }

/// 扫描到的候选设备
class SpoonCandidate {
  final String id; // 平台设备 ID（Android 为 MAC）
  final String name;
  final int rssi;
  final dynamic native; // BluetoothDevice，App 层不需要知道类型

  const SpoonCandidate({
    required this.id,
    required this.name,
    required this.rssi,
    this.native,
  });
}

abstract class SpoonTransport {
  /// 连接状态流
  Stream<SpoonLinkState> get stateStream;

  /// 原始数据包流（实时传感器数据 + 用餐数据回传都走这里）
  Stream<SpoonPacket> get packetStream;

  /// 扫描结果流（仅真机传输有意义；模拟实现返回空流）
  Stream<List<SpoonCandidate>> get scanStream;

  SpoonLinkState get currentState;
  String get deviceName;

  /// 开始扫描附近设备
  Future<void> startScan();

  /// 停止扫描
  Future<void> stopScan();

  /// 连接指定候选设备；candidate 为 null 时（模拟模式）直接连接
  Future<void> connect(SpoonCandidate? candidate);

  Future<void> disconnect();

  /// 向勺子下发命令（协议确认后使用）
  Future<void> sendCommand(List<int> bytes);

  /// 已发现的 GATT 服务摘要（诊断页展示用），未连接时为空
  List<String> get serviceSummary;

  Future<void> dispose();
}
