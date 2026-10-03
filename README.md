# 智味勺 Smart Spoon

基于你 `D:/files` 的拍照识餐基础代码扩展的完整项目：手机 App 通过蓝牙（BLE）连接智味勺，
接收勺子传感器数据，并在用餐结束后把数据回传保存为用餐记录。

## 项目结构

```
smart-spoon/
├── app/          Flutter 手机 App（Android）
├── server/       Flask 后端（你的基础代码 + 新增用餐记录接口）
├── tools/        ble_scanner.py —— 勺子 BLE 协议侦察工具
└── docs/         协议报告存放处（protocol/）
```

## 让别人也能访问

| 场景 | 方法 |
|------|------|
| 同一 Wi-Fi 的人 | 右键**以管理员身份运行** `开放局域网访问.bat`（放行防火墙 5000 端口），对方访问 `http://你的IP:5000/spoon` |
| 互联网上任何人 | 双击 `启动网站.bat`，会同时启动服务和内网穿透，得到一个 `https://xxxx.loca.lt` 公网地址发给任何人即可 |

注意：
- 公网地址是**临时的**，每次重启隧道都会变；你的电脑必须开着服务别人才能访问
- 访客首次打开公网地址如果出现验证页，输入隧道密码（启动窗口里显示的你的公网 IP）即可
- 公网地址是 HTTPS 的，**手机上蓝牙功能直接可用**，不需要再改 Chrome 开关
- 想要固定域名、7×24 在线的正式版：需要部署到云服务器（约 ¥50/年的轻量云即可），需要时找我

## 成品网页（推荐，开箱即用）🌟

```bash
cd smart-spoon/server
../.venv/Scripts/python app.py
```

浏览器打开 **http://localhost:5000/spoon**（Chrome / Edge），四个页签：

- **连接**：蓝牙连接真勺子（Web Bluetooth），或点「模拟勺子」无硬件演示全流程
- **看板**：勺子传感器数据实时显示。协议未确认前是原始 hex 数据流（诊断模式），
  确认后在 `static/spoon.js` 顶部 `SPOON_PROTOCOL` 填入解析规则，自动变成曲线
- **识餐**：拍照 → AI 识别菜品/热量 → 开始用餐 → 结束生成结果
- **记录**：用餐数据本地保存（localStorage）+ 自动同步后端

手机使用注意：Web Bluetooth 要求安全上下文。手机 Chrome 访问
`http://电脑IP:5000/spoon` 时，需在 `chrome://flags` 搜索
**unsafely-treat-insecure-origin-as-secure**，填入该地址并启用，重启浏览器即可。
（电脑上用 localhost 无此限制。）

## 当前状态与关键路径

勺子**有硬件但没协议文档**，所以整个项目围绕「先侦察协议，再正式接入」设计：

| 阶段 | 状态 | 说明 |
|------|------|------|
| 1. 协议侦察 | ✅ 工具就绪 | 用 PC 跑 `ble_scanner.py` 摸清勺子的 UUID 和数据格式 |
| 2. App 框架 | ✅ 完成 | 连接/看板/识餐/记录四页全通，`flutter analyze` 零问题 |
| 3. 协议接入 | ⏳ 等你侦察 | 把 UUID 和解析规则填进 `app/lib/ble/spoon_protocol.dart` |

协议未确认期间，App 连上真勺子后处于**原始透传模式**：
订阅所有可通知特征值，看板页直接显示 hex 数据流——App 本身就是随身诊断工具。
没有硬件时可以用内置的**模拟勺子**跑通全部流程。

## 一、协议侦察（PC + 勺子）

```bash
cd smart-spoon
.venv/Scripts/python tools/ble_scanner.py scan                    # 1. 找到勺子的 MAC
.venv/Scripts/python tools/ble_scanner.py explore --addr XX:XX..  # 2. 枚举服务/特征值
.venv/Scripts/python tools/ble_scanner.py sniff --addr XX:XX.. --seconds 60
```

sniff 抓包期间正常操作勺子（按键、舀取都试一遍），观察哪个 UUID 在什么动作下有数据。
报告保存在 `docs/protocol/`。确认协议后：

1. 打开 `app/lib/ble/spoon_protocol.dart`
2. 填入真实 UUID，把 `confirmed` 改为 `true`
3. 在 `parse()` 里实现数据帧解析（文件里有示例模板）

## 二、启动后端（拍照识餐 + 记录同步）

```bash
cd smart-spoon/server
cp .env.example .env        # 填入百度 AI 的 API Key / Secret Key
../.venv/Scripts/python app.py
```

接口：
- `POST /api/recognize` — 拍照识餐（原有）
- `GET /api/health` — 健康检查（新增）
- `GET/POST /api/meal-records` — 用餐记录（新增，JSON 文件存储，按 id 幂等）

## 三、运行 App

环境：Flutter SDK 已安装在 `C:\Users\Rain\.workbuddy\binaries\flutter\flutter\bin`。

```bash
cd smart-spoon/app
flutter pub get
flutter run          # 需要：Android 手机开 USB 调试，或 Android 模拟器
```

真机调试注意：
- 手机首次连接会弹蓝牙权限申请，允许即可
- 后端地址在 `app/lib/api/dish_api.dart` 的 `baseUrl`：
  模拟器用 `http://10.0.2.2:5000`，真机改成电脑局域网 IP（如 `http://192.168.1.5:5000`），
  手机和电脑需在同一 Wi-Fi

## 四、架构说明（关键决策）

**传输层抽象（SpoonTransport）**——协议未确认 + 真机调试成本高的阶段，
把「数据怎么来」和「数据怎么用」解耦。上层（看板/用餐流程/记录）只依赖接口：

- `BleSpoonTransport`：真机蓝牙（flutter_blue_plus）
- `MockSpoonTransport`：模拟勺子，每秒推一帧假数据，无硬件可演示全流程

协议确认后只需改 `spoon_protocol.dart` 和 BLE 实现内部，上层页面不动。

**本地优先的记录同步**——用餐记录先存手机本地（shared_preferences），
后台尝试同步到后端；同步失败不丢数据，记录页有「一键同步」重试。
后端按记录 id 幂等，重试不会产生重复数据。

## 下一步建议

1. 跑协议侦察三步，把报告发给我，我帮你写解析规则
2. 如果勺子在 PC 上扫不到（部分设备只广播给手机），可以直接用 App 的
   原始透传模式抓数据：连接页连接勺子 → 看板页看 hex 流
3. 想要 APK 安装包：装 Android SDK 后 `flutter build apk --debug`
