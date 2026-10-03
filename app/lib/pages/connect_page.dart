/// connect_page.dart — 连接智味勺
library;

import 'package:flutter/material.dart';

import '../ble/spoon_transport.dart';
import '../state/app_scope.dart';
import '../state/app_state.dart';

class ConnectPage extends StatelessWidget {
  const ConnectPage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final connected = app.isConnected;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusCard(app: app),
        const SizedBox(height: 16),
        if (app.transport == null) ...[
          FilledButton.icon(
            icon: const Icon(Icons.bluetooth_searching),
            label: const Text('连接真实勺子（蓝牙）'),
            onPressed: () {
              app.useRealBle();
              app.scan();
            },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.science_outlined),
            label: const Text('使用模拟勺子（无硬件演示）'),
            onPressed: () {
              app.useMockSpoon();
              app.connectTo(null);
            },
          ),
        ] else if (!connected) ...[
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  icon: const Icon(Icons.radar),
                  label: Text(app.linkState == SpoonLinkState.scanning
                      ? '扫描中…'
                      : '重新扫描'),
                  onPressed: app.linkState == SpoonLinkState.scanning
                      ? null
                      : app.scan,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (app.candidates.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('没有发现设备\n请确认勺子已开机并靠近手机',
                  textAlign: TextAlign.center)),
            )
          else
            ...app.candidates.map((c) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.flatware),
                    title: Text(c.name),
                    subtitle: Text('${c.id}  ·  信号 ${c.rssi} dBm'),
                    trailing: FilledButton(
                      onPressed: app.linkState == SpoonLinkState.connecting
                          ? null
                          : () => app.connectTo(c),
                      child: const Text('连接'),
                    ),
                  ),
                )),
        ] else ...[
          FilledButton.tonalIcon(
            icon: const Icon(Icons.bluetooth_disabled),
            label: const Text('断开连接'),
            onPressed: app.disconnect,
          ),
          const SizedBox(height: 16),
          if (app.serviceSummary.isNotEmpty) ...[
            Text('已发现的 GATT 服务（诊断信息）',
                style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            ...app.serviceSummary.map((s) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(s,
                        style: const TextStyle(
                            fontFamily: 'monospace', fontSize: 12)),
                  ),
                )),
          ],
        ],
      ],
    );
  }
}

class _StatusCard extends StatelessWidget {
  final AppState app;
  const _StatusCard({required this.app});

  @override
  Widget build(BuildContext context) {
    final connected = app.isConnected;
    return Card(
      color: connected
          ? Colors.green.shade50
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        leading: Icon(
          connected ? Icons.bluetooth_connected : Icons.bluetooth,
          color: connected ? Colors.green : Colors.grey,
          size: 36,
        ),
        title: Text(connected ? '智味勺已连接' : '智味勺未连接',
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(app.statusMessage),
      ),
    );
  }
}
