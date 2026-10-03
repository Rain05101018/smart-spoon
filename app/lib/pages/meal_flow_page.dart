/// meal_flow_page.dart — 用餐三步流程（对应原 Web 版的 1/2/3 步）
///
///  1. 餐前识别：拍照 → 调后端 /api/recognize → 展示菜品/热量
///  2. 用餐中：  开始用餐 → 勺子实时数据（看板联动）
///  3. 用餐结果：结束用餐 → 勺子回传数据汇总 → 保存为用餐记录
library;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/dish_api.dart';
import '../state/app_scope.dart';
import '../state/app_state.dart';

class MealFlowPage extends StatefulWidget {
  const MealFlowPage({super.key});

  @override
  State<MealFlowPage> createState() => _MealFlowPageState();
}

class _MealFlowPageState extends State<MealFlowPage> {
  int _step = 0;
  bool _recognizing = false;
  String? _error;
  List<DishResult> _results = [];
  String _dish = '';

  Future<void> _pickAndRecognize(AppState app, ImageSource source) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: source, maxWidth: 1280);
    if (file == null) return;

    setState(() {
      _recognizing = true;
      _error = null;
      _results = [];
    });
    try {
      final bytes = await file.readAsBytes();
      final results = await app.api.recognize(bytes, file.name);
      setState(() {
        _results = results;
        _dish = results.isNotEmpty ? results.first.name : '';
      });
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      setState(() => _recognizing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);

    return Stepper(
      currentStep: _step,
      onStepContinue: () {
        if (_step == 0 && !app.mealActive) {
          app.startMeal(dish: _dish);
          setState(() => _step = 1);
        } else if (_step == 1 && app.mealActive) {
          app.endMeal().then((_) => setState(() => _step = 2));
        } else if (_step == 2) {
          setState(() {
            _step = 0;
            _results = [];
            _dish = '';
          });
        }
      },
      onStepCancel: _step > 0 && !app.mealActive
          ? () => setState(() => _step -= 1)
          : null,
      controlsBuilder: (context, details) {
        final labels = ['开始用餐', '结束用餐', '再来一餐'];
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Row(
            children: [
              FilledButton(
                onPressed: (_step == 0 && _recognizing)
                    ? null
                    : details.onStepContinue,
                child: Text(labels[_step]),
              ),
              if (details.onStepCancel != null) ...[
                const SizedBox(width: 8),
                TextButton(
                    onPressed: details.onStepCancel, child: const Text('上一步')),
              ],
            ],
          ),
        );
      },
      steps: [
        // ------------------------------------------------ 1. 餐前识别
        Step(
          title: const Text('餐前识别'),
          subtitle: Text(_dish.isEmpty ? '拍下这道菜，AI 告诉你是什么' : '已识别：$_dish'),
          isActive: _step >= 0,
          state: _step > 0 ? StepState.complete : StepState.indexed,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.camera_alt),
                      label: const Text('拍照'),
                      onPressed: _recognizing
                          ? null
                          : () => _pickAndRecognize(app, ImageSource.camera),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.photo_library),
                      label: const Text('相册'),
                      onPressed: _recognizing
                          ? null
                          : () => _pickAndRecognize(app, ImageSource.gallery),
                    ),
                  ),
                ],
              ),
              if (_recognizing)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (_error != null)
                Card(
                  color: Colors.red.shade50,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text('识别失败：$_error\n（请确认后端服务已启动）',
                        style: TextStyle(color: Colors.red.shade800)),
                  ),
                ),
              ..._results.map((r) => ListTile(
                    leading: const Icon(Icons.restaurant),
                    title: Text(r.name),
                    subtitle: Text('约 ${r.calorie} 千卡'),
                    trailing: Text('${(r.probability * 100).toStringAsFixed(0)}%'),
                  )),
            ],
          ),
        ),
        // ------------------------------------------------ 2. 用餐中
        Step(
          title: const Text('用餐中'),
          subtitle: Text(app.mealActive
              ? (app.isConnected ? '勺子数据实时接收中' : '勺子未连接，仅计时')
              : '勺子实时记录本餐数据'),
          isActive: _step >= 1,
          state: _step > 1 ? StepState.complete : StepState.indexed,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!app.isConnected)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.warning_amber, color: Colors.orange),
                    title: Text('勺子未连接'),
                    subtitle: Text('本餐将只有时长记录。去「连接」页连上勺子可采集传感器数据。'),
                  ),
                )
              else
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.sensors, color: Colors.green),
                    title: Text('已收到 ${app.samples.length} 帧数据'),
                    subtitle: Text(app.packetLog.isNotEmpty
                        ? '最新: ${app.packetLog.first.hex}'
                        : '等待数据…'),
                  ),
                ),
            ],
          ),
        ),
        // ------------------------------------------------ 3. 用餐结果
        Step(
          title: const Text('用餐结果'),
          subtitle: const Text('本餐数据已汇总保存'),
          isActive: _step >= 2,
          content: app.records.isEmpty
              ? const Text('暂无记录')
              : Card(
                  child: ListTile(
                    leading: const Icon(Icons.check_circle, color: Colors.green),
                    title: Text(app.records.first.dishName.isEmpty
                        ? '未命名的一餐'
                        : app.records.first.dishName),
                    subtitle: Text(
                        '时长 ${app.records.first.durationSeconds} 秒 · ${app.records.first.packetCount} 帧数据'
                        '${app.records.first.eatenG != null ? ' · 进食约 ${app.records.first.eatenG!.toStringAsFixed(0)}g' : ''}'),
                    trailing: Icon(
                      app.records.first.synced
                          ? Icons.cloud_done
                          : Icons.cloud_off,
                      color: app.records.first.synced
                          ? Colors.green
                          : Colors.grey,
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}
