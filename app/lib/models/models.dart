/// models.dart — 领域模型
library;

import 'dart:convert';

/// 看板图表用的采样点（原始帧 + 可选解析值）
class SensorSample {
  final DateTime time;
  final String hex;
  final double? weightG;
  final double? temperatureC;

  const SensorSample({
    required this.time,
    required this.hex,
    this.weightG,
    this.temperatureC,
  });
}

/// 用餐记录（用餐结束后勺子回传数据 + App 侧汇总生成）
class MealRecord {
  final String id;
  final DateTime startTime;
  final DateTime endTime;
  final String dishName; // 餐前识别出的菜品（可空）
  final int durationSeconds;
  final int packetCount; // 本餐收到的数据帧数
  final double? startWeightG;
  final double? endWeightG;
  final bool synced; // 是否已同步到后端

  const MealRecord({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.dishName,
    required this.durationSeconds,
    required this.packetCount,
    this.startWeightG,
    this.endWeightG,
    this.synced = false,
  });

  double? get eatenG =>
      (startWeightG != null && endWeightG != null)
          ? startWeightG! - endWeightG!
          : null;

  MealRecord copyWith({bool? synced}) => MealRecord(
        id: id,
        startTime: startTime,
        endTime: endTime,
        dishName: dishName,
        durationSeconds: durationSeconds,
        packetCount: packetCount,
        startWeightG: startWeightG,
        endWeightG: endWeightG,
        synced: synced ?? this.synced,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'start_time': startTime.toIso8601String(),
        'end_time': endTime.toIso8601String(),
        'dish_name': dishName,
        'duration_seconds': durationSeconds,
        'packet_count': packetCount,
        'start_weight_g': startWeightG,
        'end_weight_g': endWeightG,
        'eaten_g': eatenG,
      };

  static MealRecord fromLocalJson(Map<String, dynamic> j, {bool synced = true}) {
    return MealRecord(
      id: j['id'] as String,
      startTime: DateTime.parse(j['start_time'] as String),
      endTime: DateTime.parse(j['end_time'] as String),
      dishName: (j['dish_name'] ?? '') as String,
      durationSeconds: (j['duration_seconds'] ?? 0) as int,
      packetCount: (j['packet_count'] ?? 0) as int,
      startWeightG: (j['start_weight_g'] as num?)?.toDouble(),
      endWeightG: (j['end_weight_g'] as num?)?.toDouble(),
      synced: synced,
    );
  }

  static String encodeList(List<MealRecord> records) =>
      jsonEncode(records.map((r) {
        final j = r.toJson();
        j['synced'] = r.synced;
        return j;
      }).toList());

  static List<MealRecord> decodeList(String jsonStr) {
    final list = jsonDecode(jsonStr) as List;
    return list.map((e) {
      final j = Map<String, dynamic>.from(e as Map);
      final synced = (j.remove('synced') ?? false) as bool;
      return MealRecord.fromLocalJson(j, synced: synced);
    }).toList();
  }
}
