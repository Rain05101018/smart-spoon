/// dashboard_page.dart — 传感器实时看板
///
/// 协议未确认前：显示原始 hex 数据流（诊断模式）
/// 协议确认后：  显示重量/温度实时曲线
library;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../state/app_scope.dart';
import '../state/app_state.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);

    if (!app.isConnected) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bluetooth_disabled, size: 64, color: Colors.grey),
            SizedBox(height: 12),
            Text('请先在「连接」页连接智味勺'),
          ],
        ),
      );
    }

    final hasParsed = app.samples.any((s) => s.weightG != null);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (hasParsed) ...[
          Text('实时重量曲线', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SizedBox(height: 220, child: _WeightChart(app: app)),
          const SizedBox(height: 16),
        ] else ...[
          Card(
            color: Colors.amber.shade50,
            child: const ListTile(
              leading: Icon(Icons.engineering, color: Colors.amber),
              title: Text('协议侦察模式'),
              subtitle: Text(
                  '勺子协议尚未配置，以下为原始数据流。\n跑完 tools/ble_scanner.py 侦察并填入 spoon_protocol.dart 后，这里会变成重量/温度曲线。'),
            ),
          ),
          const SizedBox(height: 16),
        ],
        Row(
          children: [
            Text('原始数据流', style: Theme.of(context).textTheme.titleMedium),
            const Spacer(),
            Text('共 ${app.packetLog.length} 帧',
                style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 8),
        if (app.packetLog.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('等待勺子推送数据…\n试试按一下勺子上的按键')),
            ),
          )
        else
          ...app.packetLog.take(50).map((p) => Card(
                margin: const EdgeInsets.only(bottom: 4),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.hex,
                          style: const TextStyle(
                              fontFamily: 'monospace', fontSize: 13)),
                      if (p.asText.isNotEmpty)
                        Text('文本: ${p.asText}',
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey.shade700)),
                      Text(
                        '${p.time.hour.toString().padLeft(2, '0')}:${p.time.minute.toString().padLeft(2, '0')}:${p.time.second.toString().padLeft(2, '0')}.${(p.time.millisecond ~/ 100)}  ·  ${p.charUuid.substring(4, 8)}',
                        style:
                            TextStyle(fontSize: 11, color: Colors.grey.shade500),
                      ),
                    ],
                  ),
                ),
              )),
      ],
    );
  }
}

class _WeightChart extends StatelessWidget {
  final AppState app;
  const _WeightChart({required this.app});

  @override
  Widget build(BuildContext context) {
    final samples = app.samples.where((s) => s.weightG != null).toList();
    if (samples.length < 2) {
      return const Center(child: Text('数据积累中…'));
    }
    final spots = <FlSpot>[
      for (var i = 0; i < samples.length; i++)
        FlSpot(i.toDouble(), samples[i].weightG!),
    ];
    final minY = spots.map((s) => s.y).reduce((a, b) => a < b ? a : b);
    final maxY = spots.map((s) => s.y).reduce((a, b) => a > b ? a : b);
    final pad = ((maxY - minY) * 0.2).clamp(1.0, 50.0);

    return LineChart(
      LineChartData(
        minY: minY - pad,
        maxY: maxY + pad,
        gridData: const FlGridData(show: true),
        titlesData: FlTitlesData(
          topTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 44,
              getTitlesWidget: (v, _) =>
                  Text('${v.toStringAsFixed(0)}g',
                      style: const TextStyle(fontSize: 10)),
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: Theme.of(context).colorScheme.primary,
            barWidth: 2,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              color:
                  Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
            ),
          ),
        ],
      ),
    );
  }
}
