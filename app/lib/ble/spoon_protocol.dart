/// spoon_protocol.dart — 智味勺 BLE 协议定义（占位 + 解析入口）
///
/// ⚠️ 协议尚未确认。请先用 PC 端工具摸清协议：
///   tools/ble_scanner.py scan / explore / sniff
/// 然后把扫描报告（docs/protocol/*.json）里的真实 UUID 和解析规则填到这里。
///
/// App 在协议未确认期间会进入「原始透传模式」：
/// 订阅设备上所有可 notify 的特征值，原始 hex 直接显示在看板页，
/// App 本身就是一个随身诊断工具。
library;

class SpoonProtocol {
  // ------------------------------------------------------------------
  // TODO(协议侦察后填写): 以下 UUID 是常见蓝牙串口模块（JDY/HM-10 风格）的
  // 典型值，仅作占位。请替换成 ble_scanner 报告中的真实值。
  // ------------------------------------------------------------------
  static const String serviceUuid = '0000ffe0-0000-1000-8000-00805f9b34fb';
  static const String sensorNotifyUuid = '0000ffe1-0000-1000-8000-00805f9b34fb';
  static const String commandWriteUuid = '0000ffe2-0000-1000-8000-00805f9b34fb';

  /// 设备名称前缀过滤（扫描时优先展示）。侦察后改成勺子的真实广播名。
  static const String namePrefix = 'Spoon';

  /// 协议是否已确认。false 时 App 使用原始透传模式（订阅全部 notify 特征）。
  static const bool confirmed = false;

  /// 将一帧原始数据解析成传感器采样。
  /// 返回 null 表示无法解析（协议未确认前总是 null，看板只显示原始 hex）。
  ///
  /// TODO(协议侦察后实现): 按 sniff 报告里的包长/字段偏移写解析，例如：
  ///   if (raw.length >= 6) {
  ///     final weight = (raw[1] << 8) | raw[2];        // 0.1g 单位
  ///     final temp   = ((raw[3] << 8) | raw[4]) / 10; // 0.1℃ 单位
  ///     return ParsedSample(weightG: weight / 10, temperatureC: temp);
  ///   }
  static ParsedSample? parse(List<int> raw) {
    return null;
  }
}

/// 一帧解析后的传感器数据
class ParsedSample {
  final double? weightG;
  final double? temperatureC;
  final int? batteryPercent;

  const ParsedSample({this.weightG, this.temperatureC, this.batteryPercent});
}

/// 一帧原始数据包（协议侦察阶段的主力数据形态）
class SpoonPacket {
  final String charUuid;
  final List<int> raw;
  final DateTime time;

  SpoonPacket({required this.charUuid, required this.raw, DateTime? time})
      : time = time ?? DateTime.now();

  String get hex =>
      raw.map((b) => b.toRadixString(16).padLeft(2, '0')).join(' ');

  String get asText {
    try {
      final s = String.fromCharCodes(raw).replaceAll('\x00', '').trim();
      final printable = s.runes.every((r) => r >= 32 && r < 127 || r > 127);
      return s.isNotEmpty && printable ? s : '';
    } catch (_) {
      return '';
    }
  }
}
