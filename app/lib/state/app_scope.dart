/// app_scope.dart — 轻量状态注入（InheritedNotifier，零第三方依赖）
///
/// 设计权衡：项目规模小（一个全局 AppState），引入 provider/riverpod
/// 的收益抵不过依赖成本。用 Flutter 自带的 InheritedNotifier 即可，
/// 未来状态变复杂再迁移也不迟（接口只有 AppScope.of 一处）。
library;

import 'package:flutter/widgets.dart';

import 'app_state.dart';

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child})
      : super(notifier: state);

  /// 订阅式读取：AppState 变化时当前 Widget 自动重建
  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope 未在 Widget 树中找到');
    return scope!.notifier!;
  }
}
