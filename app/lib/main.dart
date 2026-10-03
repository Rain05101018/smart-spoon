/// main.dart — 智味勺 App 入口
///
/// 四个主页面（底部导航）：
///   连接  —— 蓝牙连接勺子（真机 / 模拟）
///   看板  —— 传感器实时数据
///   识餐  —— 三步用餐流程（餐前识别 → 用餐中 → 用餐结果）
///   记录  —— 用餐数据回传记录
library;

import 'package:flutter/material.dart';

import 'pages/connect_page.dart';
import 'pages/dashboard_page.dart';
import 'pages/meal_flow_page.dart';
import 'pages/records_page.dart';
import 'state/app_scope.dart';
import 'state/app_state.dart';

void main() {
  runApp(
    AppScope(
      state: AppState(),
      child: const SmartSpoonApp(),
    ),
  );
}

class SmartSpoonApp extends StatelessWidget {
  const SmartSpoonApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF667EEA));
    return MaterialApp(
      title: '智味勺',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        useMaterial3: true,
        appBarTheme: AppBarTheme(
          backgroundColor: scheme.primary,
          foregroundColor: Colors.white,
        ),
      ),
      home: const HomeShell(),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  static const _pages = [
    ConnectPage(),
    DashboardPage(),
    MealFlowPage(),
    RecordsPage(),
  ];

  static const _titles = ['连接智味勺', '实时看板', '拍照识餐', '用餐记录'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_tab])),
      body: IndexedStack(index: _tab, children: _pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.bluetooth), label: '连接'),
          NavigationDestination(
              icon: Icon(Icons.show_chart), label: '看板'),
          NavigationDestination(
              icon: Icon(Icons.restaurant_menu), label: '识餐'),
          NavigationDestination(
              icon: Icon(Icons.receipt_long), label: '记录'),
        ],
      ),
    );
  }
}
