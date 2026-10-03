/// dish_api.dart — 对接现有 Flask 后端（server/app.py）
///
/// 复用你基础代码里的接口：
///   POST /api/recognize      拍照识餐
///   GET  /api/health         健康检查
/// 新增（已同步加到 server/app.py）：
///   POST /api/meal-records   用餐记录回传
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

class DishApi {
  /// 后端地址。Android 模拟器访问宿主机用 10.0.2.2；
  /// 真机调试请改成电脑的局域网 IP，例如 http://192.168.1.5:5000
  final String baseUrl;

  DishApi({this.baseUrl = 'http://10.0.2.2:5000'});

  Future<bool> health() async {
    try {
      final resp = await http
          .get(Uri.parse('$baseUrl/api/health'))
          .timeout(const Duration(seconds: 5));
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// 拍照识餐。返回 [{name, calorie, probability}, ...]，失败抛出异常。
  Future<List<DishResult>> recognize(List<int> imageBytes, String filename) async {
    final req = http.MultipartRequest(
        'POST', Uri.parse('$baseUrl/api/recognize'))
      ..files.add(http.MultipartFile.fromBytes('image', imageBytes,
          filename: filename));

    final streamed =
        await req.send().timeout(const Duration(seconds: 30));
    final body = await streamed.stream.bytesToString();
    final json = jsonDecode(body) as Map<String, dynamic>;

    // 现有后端响应格式：{"ok": true, "dishes": [...]} / {"ok": false, "message": ...}
    if (streamed.statusCode != 200 || json['ok'] != true) {
      throw Exception(json['message'] ?? '识别失败（HTTP ${streamed.statusCode}）');
    }
    final results = (json['dishes'] as List? ?? [])
        .map((e) => DishResult.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    return results;
  }

  /// 用餐记录回传。后端不可达时抛异常，由调用方决定重试策略。
  Future<void> uploadMealRecord(Map<String, dynamic> recordJson) async {
    final resp = await http
        .post(Uri.parse('$baseUrl/api/meal-records'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(recordJson))
        .timeout(const Duration(seconds: 10));
    if (resp.statusCode != 200) {
      throw Exception('同步失败（HTTP ${resp.statusCode}）');
    }
  }
}

class DishResult {
  final String name;
  final String calorie;
  final double probability;

  const DishResult(
      {required this.name, required this.calorie, required this.probability});

  factory DishResult.fromJson(Map<String, dynamic> j) => DishResult(
        name: (j['name'] ?? '未知') as String,
        calorie: (j['calorie'] ?? '--') as String,
        probability: ((j['probability'] ?? 0) as num).toDouble(),
      );
}
