/// records_page.dart — 用餐记录（勺子数据回传后的本地存档 + 后端同步）
library;

import 'package:flutter/material.dart';

import '../state/app_scope.dart';

class RecordsPage extends StatelessWidget {
  const RecordsPage({super.key});

  String _fmt(DateTime t) =>
      '${t.month}/${t.day} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final pending = app.records.where((r) => !r.synced).length;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              Text('共 ${app.records.length} 条记录'
                  '${pending > 0 ? ' · $pending 条待同步' : ''}'),
              const Spacer(),
              if (pending > 0)
                TextButton.icon(
                  icon: const Icon(Icons.sync, size: 18),
                  label: const Text('一键同步'),
                  onPressed: () async {
                    final ok = await app.syncAll();
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('已同步 $ok 条记录')),
                      );
                    }
                  },
                ),
              if (app.records.isNotEmpty)
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20),
                  tooltip: '清空记录',
                  onPressed: () => showDialog(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('清空所有记录？'),
                      content: const Text('本地用餐记录将被删除，已同步到服务器的不受影响。'),
                      actions: [
                        TextButton(
                            onPressed: () => Navigator.pop(ctx),
                            child: const Text('取消')),
                        FilledButton(
                            onPressed: () {
                              app.clearRecords();
                              Navigator.pop(ctx);
                            },
                            child: const Text('清空')),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: app.records.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.receipt_long, size: 64, color: Colors.grey),
                      SizedBox(height: 12),
                      Text('还没有用餐记录\n去「识餐」页开始第一餐吧',
                          textAlign: TextAlign.center),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: app.records.length,
                  itemBuilder: (context, i) {
                    final r = app.records[i];
                    return Card(
                      child: ListTile(
                        leading: CircleAvatar(
                          child: Text(r.dishName.isNotEmpty
                              ? r.dishName.characters.first
                              : '餐'),
                        ),
                        title: Text(
                            r.dishName.isNotEmpty ? r.dishName : '未命名的一餐'),
                        subtitle: Text(
                          '${_fmt(r.startTime)} · ${r.durationSeconds}秒 · ${r.packetCount}帧'
                          '${r.eatenG != null ? ' · 进食约${r.eatenG!.toStringAsFixed(0)}g' : ''}',
                        ),
                        trailing: Icon(
                          r.synced ? Icons.cloud_done : Icons.cloud_off,
                          size: 20,
                          color: r.synced ? Colors.green : Colors.grey,
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
