// 基础冒烟测试：App 能启动并显示底部导航
import 'package:flutter_test/flutter_test.dart';

import 'package:smart_spoon_app/main.dart';
import 'package:smart_spoon_app/state/app_scope.dart';
import 'package:smart_spoon_app/state/app_state.dart';

void main() {
  testWidgets('App 启动后显示四个底部导航', (WidgetTester tester) async {
    await tester.pumpWidget(
      AppScope(state: AppState(), child: const SmartSpoonApp()),
    );

    expect(find.text('连接'), findsOneWidget);
    expect(find.text('看板'), findsOneWidget);
    expect(find.text('识餐'), findsOneWidget);
    expect(find.text('记录'), findsOneWidget);
    expect(find.text('连接真实勺子（蓝牙）'), findsOneWidget);
  });
}
