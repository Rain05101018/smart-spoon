/// app_state.dart — 全局状态（ChangeNotifier，无额外状态管理框架依赖）
///
/// 职责：
///  - 持有 SpoonTransport（真机 / 模拟）
///  - 汇聚实时数据包 → 看板采样序列（滚动窗口）
///  - 管理「一顿饭」的生命周期：开始用餐 → 收集数据 → 结束并生成 MealRecord
///  - 用餐记录的本地持久化（shared_preferences）与后端同步
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/dish_api.dart';
import '../ble/ble_spoon_transport.dart';
import '../ble/mock_spoon_transport.dart';
import '../ble/spoon_protocol.dart';
import '../ble/spoon_transport.dart';
import '../models/models.dart';

class AppState extends ChangeNotifier {
  SpoonTransport? _transport;
  final List<StreamSubscription> _subs = [];

  SpoonLinkState linkState = SpoonLinkState.disconnected;
  List<SpoonCandidate> candidates = [];
  String statusMessage = '未连接';

  /// 看板滚动窗口（最近 120 帧）
  final List<SensorSample> samples = [];
  static const int maxSamples = 120;

  /// 最近的原始包日志（诊断用，最多 200 条）
  final List<SpoonPacket> packetLog = [];

  /// 用餐会话
  bool mealActive = false;
  DateTime? _mealStart;
  int _mealPackets = 0;
  double? _mealStartWeight;
  double? _mealLastWeight;
  String currentDish = '';

  /// 用餐记录
  List<MealRecord> records = [];

  final DishApi api = DishApi();

  static const _recordsKey = 'meal_records_v1';

  SpoonTransport? get transport => _transport;
  bool get isConnected => linkState == SpoonLinkState.connected;

  AppState() {
    _loadRecords();
  }

  // ------------------------------------------------------------ 连接
  void useMockSpoon() => _attach(MockSpoonTransport(), '模拟勺子已就绪');

  void useRealBle() => _attach(BleSpoonTransport(), '真机蓝牙模式');

  void _attach(SpoonTransport t, String msg) {
    _teardown();
    _transport = t;
    statusMessage = msg;
    _subs.add(t.stateStream.listen((s) {
      linkState = s;
      statusMessage = switch (s) {
        SpoonLinkState.disconnected => '未连接',
        SpoonLinkState.scanning => '正在扫描…',
        SpoonLinkState.connecting => '正在连接…',
        SpoonLinkState.connected => '已连接：${t.deviceName}',
        SpoonLinkState.error => '连接出错，请重试',
      };
      notifyListeners();
    }));
    _subs.add(t.scanStream.listen((list) {
      candidates = list;
      notifyListeners();
    }));
    _subs.add(t.packetStream.listen(_onPacket));
    notifyListeners();
  }

  Future<void> scan() async => _transport?.startScan();

  Future<void> connectTo(SpoonCandidate? c) async {
    try {
      await _transport?.connect(c);
    } catch (e) {
      statusMessage = '连接失败：$e';
      notifyListeners();
    }
  }

  Future<void> disconnect() async => _transport?.disconnect();

  List<String> get serviceSummary => _transport?.serviceSummary ?? const [];

  // ------------------------------------------------------------ 数据
  void _onPacket(SpoonPacket p) {
    packetLog.insert(0, p);
    if (packetLog.length > 200) packetLog.removeLast();

    final parsed = SpoonProtocol.parse(p.raw);
    final sample = SensorSample(
      time: p.time,
      hex: p.hex,
      weightG: parsed?.weightG,
      temperatureC: parsed?.temperatureC,
    );
    samples.add(sample);
    if (samples.length > maxSamples) samples.removeAt(0);

    if (mealActive) {
      _mealPackets++;
      _mealStartWeight ??= parsed?.weightG;
      if (parsed?.weightG != null) _mealLastWeight = parsed!.weightG;
    }
    notifyListeners();
  }

  // ------------------------------------------------------------ 用餐会话
  void startMeal({String dish = ''}) {
    mealActive = true;
    currentDish = dish;
    _mealStart = DateTime.now();
    _mealPackets = 0;
    _mealStartWeight = null;
    _mealLastWeight = null;
    notifyListeners();
  }

  /// 结束用餐：汇总勺子回传的数据生成记录，本地保存并尝试同步后端
  Future<MealRecord> endMeal() async {
    final end = DateTime.now();
    final start = _mealStart ?? end;
    final record = MealRecord(
      id: 'meal-${end.millisecondsSinceEpoch}',
      startTime: start,
      endTime: end,
      dishName: currentDish,
      durationSeconds: end.difference(start).inSeconds,
      packetCount: _mealPackets,
      startWeightG: _mealStartWeight,
      endWeightG: _mealLastWeight,
    );
    mealActive = false;
    currentDish = '';
    records.insert(0, record);
    notifyListeners();
    await _saveRecords();
    unawaited(syncRecord(record));
    return record;
  }

  // ------------------------------------------------------------ 记录持久化/同步
  Future<void> _loadRecords() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_recordsKey);
    if (raw != null && raw.isNotEmpty) {
      try {
        records = MealRecord.decodeList(raw);
        notifyListeners();
      } catch (_) {/* 本地数据损坏则从空开始 */}
    }
  }

  Future<void> _saveRecords() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_recordsKey, MealRecord.encodeList(records));
  }

  /// 同步单条记录到后端；成功后更新 synced 标记
  Future<bool> syncRecord(MealRecord record) async {
    try {
      await api.uploadMealRecord(record.toJson());
      final idx = records.indexWhere((r) => r.id == record.id);
      if (idx >= 0) {
        records[idx] = records[idx].copyWith(synced: true);
        notifyListeners();
        await _saveRecords();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /// 同步所有未同步的记录（记录页的「一键同步」按钮）
  Future<int> syncAll() async {
    var ok = 0;
    for (final r in records.where((r) => !r.synced).toList()) {
      if (await syncRecord(r)) ok++;
    }
    return ok;
  }

  Future<void> clearRecords() async {
    records = [];
    notifyListeners();
    await _saveRecords();
  }

  void _teardown() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    _transport?.dispose();
    _transport = null;
    candidates = [];
    linkState = SpoonLinkState.disconnected;
  }

  @override
  void dispose() {
    _teardown();
    super.dispose();
  }
}
