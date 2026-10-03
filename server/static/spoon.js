/**
 * spoon.js — 智味勺 Web 应用（T11 产品化版）
 *
 * 架构（T11 Part 22 数据层）：
 *   BLE → lineBuffer → SPOON_PROTOCOL.parse → spoonState → UI
 *   UI 只读 spoonState，不直接解析 BLE 字符串（Part 20）
 *
 * T11 落实清单：
 *  P5  识别结果 Confirm / Edit 流程
 *  P6  连接状态机（idle/scanning/connecting/connected/failed/lost）
 *  P20 SpoonState 统一状态对象
 *  P21 BLE 分包行缓冲（onBleData）
 *  P23 解析前格式检查，坏包丢弃不崩
 *  P26 产品数字 400ms 节流 + count-up 平滑
 *  P27 Loading / Empty / Error 状态
 *  P28 错误使用产品语言，技术细节进调试页
 */

'use strict';

// ================================================================ 协议配置
const SPOON_PROTOCOL = {
  confirmed: true,
  // Nordic UART Service（XIAO nRF52840 BLE 串口标准）
  serviceUuid: '6e400001-b5a3-f393-e0a9-a9e50e24dcca9',
  notifyUuid:  '6e400003-b5a3-f393-e0a9-a9e50e24dcca9',  // NUS TX：设备 → 手机
  writeUuid:   '6e400002-b5a3-f393-e0a9-a9e50e24dcca9',  // NUS RX：手机 → 设备
  tareCommand: 'T\n',   // TODO: 待固件确认

  /** S,234,1260,1,3 → 字段对象；格式不符返回 null（Part 23） */
  parse(line) {
    const parts = line.trim().split(',');
    if (parts[0] !== 'S' || parts.length < 5) return null;
    const weight10 = parseInt(parts[1], 10);
    if (Number.isNaN(weight10)) return null;
    return {
      weightG: weight10 / 10,
      body: parseInt(parts[2], 10),
      stable: parts[3] === '1',
      markCount: parseInt(parts[4], 10) || 0,
    };
  },
};

const COMMON_SERVICE_UUIDS = [
  SPOON_PROTOCOL.serviceUuid,
  0x1800, 0x1801, 0x180A, 0x180F,
  0xFFE0, 0xFFE5, 0xFFF0,
];

// ================================================================ SpoonState（Part 20：UI 唯一数据源）
const spoonState = {
  weight: null,        // g（已除 10）
  body: null,          // BodySense 原始值（调试字段）
  stable: false,
  markCount: 0,        // 开发字段（Part 24：后续可切换为自动口数检测）
  updatedAt: null,
};

// ================================================================ 全局状态
const state = {
  device: null,
  writeChar: null,
  mockMode: false,
  mockTimer: null,
  mock: null,
  deviceName: '',

  lineBuffer: '',
  rawLog: [],
  weightSeries: [],
  lastError: '',         // 技术错误详情（只进调试页，Part 28）

  meal: null,
  result: null,
  records: [],
  detected: null,        // 待确认的识别结果 {name, calorie}
  foodImageUrl: null,    // 食物照片预览
};

const MAX_RAW_LOG = 300;
const MAX_SERIES = 600;
const RECORDS_KEY = 'spoon_meal_records_v2';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  loadRecords();
  renderRecords();
  runBluetoothDiagnosis();
  renderConnPanel();
  setInterval(tickMealUI, 1000);
  registerServiceWorker();
});

/** PWA：注册 Service Worker（HTTPS / localhost 下生效） */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/static/sw.js').catch(() => {
    /* 注册失败不影响使用（如内嵌预览环境） */
  });
}

// ================================================================ 交互反馈工具
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function haptic(ms = 12) {
  if (!reducedMotion && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* 不支持则忽略 */ }
  }
}

const _animVal = new WeakMap();
function animateNumber(el, target, decimals = 1, duration = 400) {
  if (reducedMotion) { el.textContent = target.toFixed(decimals); return; }
  const from = _animVal.get(el) ?? parseFloat(el.textContent) ?? 0;
  if (Math.abs(target - from) < 0.05) { el.textContent = target.toFixed(decimals); return; }
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (target - from) * eased;
    el.textContent = val.toFixed(decimals);
    _animVal.set(el, val);
    if (t < 1) el._raf = requestAnimationFrame(step);
    else _animVal.set(el, target);
  };
  el._raf = requestAnimationFrame(step);
}

let toastTimer = null;
function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================================================================ 页签
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    const active = p.id === 'panel-' + tab;
    if (active && !p.classList.contains('active')) {
      p.classList.add('active');
      p.style.animation = 'none';
      void p.offsetWidth;
      p.style.animation = '';
    } else if (!active) {
      p.classList.remove('active');
    }
  });
}

// ================================================================ 蓝牙环境自诊断
function runBluetoothDiagnosis() {
  const diag = $('bt-diag');
  const hasBt = !!navigator.bluetooth;
  const secure = window.isSecureContext;
  const ua = navigator.userAgent;
  const isChrome = /Chrome\/(\d+)/.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\//.test(ua);
  const inIframe = window.self !== window.top;

  let verdict, advice;
  if (!secure && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    verdict = '❌ 页面不是安全上下文（HTTP）';
    advice = 'Web Bluetooth 只在 HTTPS 或 localhost 下可用。电脑请用 localhost 访问；手机请用 HTTPS 地址。';
  } else if (!hasBt && inIframe) {
    verdict = '❌ 当前在内嵌预览窗口中打开';
    advice = '预览面板不支持蓝牙。请在真正的 Chrome / Edge 窗口中打开本页面。';
  } else if (!hasBt && !isChrome && !isEdge) {
    verdict = '❌ 浏览器不支持 Web Bluetooth';
    advice = '请使用 Chrome 或 Edge（手机用 Android 版 Chrome；iPhone 可装 Bluefy 浏览器）。';
  } else if (!hasBt) {
    verdict = '❌ Web Bluetooth 被禁用';
    advice = 'Chrome 地址栏输入 chrome://flags 启用实验性 Web 平台功能后重启浏览器。';
  } else {
    verdict = '✅ 蓝牙环境就绪';
    advice = (isChrome || isEdge ? 'Chrome/Edge' : '当前浏览器') +
      (secure ? ' · 安全上下文' : '') + (inIframe ? ' · ⚠️ 内嵌窗口中，配对弹窗可能无法显示' : '');
  }

  diag.innerHTML = `<b>${verdict}</b><span>${advice}</span>`;
  diag.className = 'diag-line ' + (hasBt && secure ? 'ok' : 'bad');

  if (hasBt && secure) restoreKnownDevices();
}

// ================================================================ 连接状态机（Part 6）
// idle | scanning | connecting | connected | failed | lost
let connState = 'idle';
let connHint = '';             // 产品语言错误说明（Part 28）
let userDisconnected = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let connectCancelled = false;

function setConnState(s, hint = '') {
  connState = s;
  connHint = hint;
  renderConnPanel();
  const chipMap = {
    idle:       ['disconnected', '未连接'],
    scanning:   ['connecting', '正在搜索设备…'],
    connecting: ['connecting', '正在连接…'],
    connected:  ['connected', '已连接：' + state.deviceName],
    failed:     ['disconnected', '连接失败'],
    lost:       ['disconnected', '连接已断开'],
  };
  const [cls, text] = chipMap[s];
  setStatus(cls, text);
}

/** Part 6：每种连接状态，用户看到的都不同 */
function renderConnPanel() {
  const text = $('conn-state-text');
  const errBox = $('conn-error');
  const btnPair = $('btn-connect-real');
  const btnMock = $('btn-mock');
  const btnDisc = $('btn-disconnect');
  const btnCancel = $('btn-cancel-connect');
  const btnRetry = $('btn-retry');
  const btOk = !!navigator.bluetooth &&
    (window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname));

  // 先重置所有按钮的显示与文字（防止上一状态残留，如「放弃」串到「断开连接」）
  [btnPair, btnMock, btnDisc, btnCancel, btnRetry].forEach(b => { b.style.display = 'none'; });
  btnPair.innerHTML = '🔵 配对新的勺子（蓝牙）';
  btnDisc.textContent = '断开连接';
  btnRetry.textContent = '重试';
  btnCancel.textContent = '取消连接';
  btnCancel.onclick = cancelConnect;
  errBox.style.display = 'none';

  switch (connState) {
    case 'idle':
      text.innerHTML = '<span class="status-dot gray"></span>未连接';
      btnPair.style.display = '';
      btnPair.disabled = !btOk;
      btnMock.style.display = '';
      break;
    case 'scanning':
      text.innerHTML = '<span class="spinner"></span>正在搜索设备… 请在弹窗中选择你的勺子';
      break;
    case 'connecting':
      text.innerHTML = '<span class="spinner"></span>正在连接…';
      btnCancel.style.display = '';
      break;
    case 'connected':
      text.innerHTML = `<span class="status-dot green"></span>已连接 <b>${esc(state.deviceName)}</b>`;
      btnDisc.style.display = '';
      break;
    case 'failed':
      text.innerHTML = '<span class="status-dot red"></span>连接失败';
      errBox.textContent = connHint;
      errBox.style.display = 'block';
      btnRetry.style.display = '';
      btnPair.style.display = '';
      btnPair.disabled = !btOk;
      // 逃生出口：失败也能回到演示模式或初始状态
      btnMock.style.display = '';
      btnCancel.style.display = '';
      btnCancel.textContent = '返回初始状态';
      btnCancel.onclick = resetToIdle;
      break;
    case 'lost':
      text.innerHTML = '<span class="status-dot amber"></span>连接已断开';
      if (reconnectAttempts > 0 && reconnectAttempts < 3) {
        errBox.textContent = `正在自动重连（第 ${reconnectAttempts} 次）…`;
        errBox.style.display = 'block';
      }
      btnRetry.style.display = '';
      btnRetry.textContent = '立即重连';
      btnCancel.style.display = '';
      btnCancel.textContent = '返回初始状态';
      btnCancel.onclick = resetToIdle;
      break;
  }
  $('btn-tare').disabled = connState !== 'connected';
}

/** 明确回到初始界面：停掉重连计时、放弃设备、回 idle */
function resetToIdle() {
  userDisconnected = true;
  reconnectAttempts = 0;
  clearTimeout(reconnectTimer);
  if (state.device && state.device.gatt && state.device.gatt.connected) {
    try { state.device.gatt.disconnect(); } catch { /* 忽略 */ }
  }
  state.device = null;
  state.writeChar = null;
  setConnState('idle');
}

/** Part 28：技术错误 → 产品语言；原文存调试页 */
function friendlyError(err) {
  const msg = String((err && err.message) || err || '');
  state.lastError = `${err.name || 'Error'}: ${msg}`;
  if (/getPrimaryService|service.*not.*found|6e400001/i.test(msg)) {
    return '勺子已连上但找不到数据通道。请确认固件开启了 NUS 串口服务。';
  }
  if (/network|GATT|133|terminated/i.test(msg)) {
    return '连接中断了。请让勺子靠近一些，确认它已开机，然后重试。';
  }
  if (/permission|denied|security/i.test(msg)) {
    return '浏览器拒绝了蓝牙权限。请在地址栏左侧的网站设置中允许蓝牙。';
  }
  return '连接没有成功。请确认勺子已开机并靠近，然后重试。';
}

async function connectReal() {
  if (!navigator.bluetooth) {
    toast('当前环境不支持蓝牙，请看诊断信息');
    return;
  }
  const filter = $('name-filter').value.trim();
  const options = filter
    ? { filters: [{ namePrefix: filter }], optionalServices: COMMON_SERVICE_UUIDS }
    : { acceptAllDevices: true, optionalServices: COMMON_SERVICE_UUIDS };
  setConnState('scanning');
  try {
    const device = await navigator.bluetooth.requestDevice(options);
    await connectToDevice(device);
  } catch (err) {
    if (err.name === 'NotFoundError') {       // 用户取消选择 → 回 idle（Part 27：Cancel 状态）
      setConnState('idle');
    } else {
      setConnState('failed', friendlyError(err));
      renderDebug();
    }
  }
}

async function connectToDevice(device) {
  userDisconnected = false;
  connectCancelled = false;
  device.addEventListener('gattserverdisconnected', onDisconnected);
  setConnState('connecting');
  try {
    const server = await device.gatt.connect();
    if (connectCancelled) { server.disconnect(); setConnState('idle'); return; }

    const service = await server.getPrimaryService(SPOON_PROTOCOL.serviceUuid);
    const txChar = await service.getCharacteristic(SPOON_PROTOCOL.notifyUuid);
    try {
      state.writeChar = await service.getCharacteristic(SPOON_PROTOCOL.writeUuid);
    } catch { state.writeChar = null; }

    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', (e) => {
      onBleData(new Uint8Array(e.target.value.buffer));
    });

    state.device = device;
    state.deviceName = device.name || '智味勺';
    reconnectAttempts = 0;
    haptic(25);
    setConnState('connected');
  } catch (err) {
    if (connectCancelled) { setConnState('idle'); return; }
    // 自动重连流程中的失败：继续下一轮重试，而不是掉进「连接失败」态
    if (reconnectAttempts > 0 && reconnectAttempts < 3 && !userDisconnected) {
      state.lastError = `${err.name || 'Error'}: ${err.message || err}`;
      scheduleReconnect();
      return;
    }
    setConnState('failed', friendlyError(err));
    renderDebug();
  }
}

function cancelConnect() {
  connectCancelled = true;
  if (state.device && state.device.gatt.connected) state.device.gatt.disconnect();
  setConnState('idle');
}

function retryConnect() {
  if (state.device) {
    connectToDevice(state.device);   // 回连已有设备
  } else {
    connectReal();                   // 重新走配对流程
  }
}

async function restoreKnownDevices() {
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return;
  try {
    const devices = await navigator.bluetooth.getDevices();
    if (!devices || devices.length === 0) return;
    knownDevices = devices;
    const box = $('known-devices');
    box.style.display = 'block';
    box.innerHTML = '<div class="hint-inline" style="margin-bottom:6px">之前配对过的设备：</div>' +
      devices.map((d, i) => `
        <div class="known-device">
          <span>🥄 ${esc(d.name || '未知设备')}</span>
          <button type="button" class="btn btn-small" onclick="reconnectKnown(${i})">连接</button>
        </div>`).join('');
  } catch { /* 权限被重置或浏览器不支持则忽略 */ }
}

let knownDevices = [];
async function reconnectKnown(i) {
  const device = knownDevices[i];
  if (device) connectToDevice(device);
}

async function disconnectSpoon(byUser) {
  if (state.mockMode) { stopMock(); return; }
  if (byUser) userDisconnected = true;
  clearTimeout(reconnectTimer);
  if (state.device && state.device.gatt.connected) state.device.gatt.disconnect();
  if (connState !== 'connected') setConnState('idle');   // lost 状态下点「放弃」
}

function onDisconnected() {
  if (state.mockMode) { setConnState('idle'); return; }
  if (userDisconnected) {
    setConnState('idle');
    return;
  }
  setConnState('lost');
  scheduleReconnect();
}

function scheduleReconnect() {
  if (userDisconnected || !state.device) return;
  if (reconnectAttempts >= 3) {
    setConnState('lost', '自动重连没有成功。');
    renderConnPanel();
    return;
  }
  reconnectAttempts++;
  renderConnPanel();
  reconnectTimer = setTimeout(() => {
    if (state.device) connectToDevice(state.device);
  }, 2000 * reconnectAttempts);
}

function setStatus(cls, text) {
  const chip = $('conn-status');
  chip.className = 'status-chip ' + cls;
  chip.textContent = text;
  const chipMeal = $('conn-status-meal');
  if (chipMeal) chipMeal.textContent = text;
}

// ================================================================ 数据接收（Part 21/22）
function onBleData(bytes) {
  // BLE Notification 可能拆包/粘包：先入 buffer，按 \n 取完整行
  state.lineBuffer += Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  let idx;
  while ((idx = state.lineBuffer.indexOf('\n')) >= 0) {
    const line = state.lineBuffer.slice(0, idx);
    state.lineBuffer = state.lineBuffer.slice(idx + 1);
    onLine(line.trim());
  }
}

function onLine(line) {
  if (!line) return;
  state.rawLog.unshift({ time: new Date(), line });
  if (state.rawLog.length > MAX_RAW_LOG) state.rawLog.pop();

  const parsed = SPOON_PROTOCOL.parse(line);
  if (!parsed) { renderDebug(); return; }   // Part 23：坏包只进调试日志

  // 更新唯一状态对象（Part 20）
  spoonState.weight = parsed.weightG;
  spoonState.body = parsed.body;
  spoonState.stable = parsed.stable;
  spoonState.markCount = parsed.markCount;
  spoonState.updatedAt = new Date();

  state.weightSeries.push({ t: Date.now(), weightG: parsed.weightG });
  if (state.weightSeries.length > MAX_SERIES) state.weightSeries.shift();

  if (state.meal) onMealSample();
  renderLiveThrottled();     // Part 26：产品数字节流
  renderDebug();             // 调试页保持高频
}

// Part 26：主要数字最多每 400ms 刷新一次，避免整个页面高频跳动
let _lastLiveRender = 0;
function renderLiveThrottled() {
  const now = Date.now();
  if (now - _lastLiveRender >= 400) {
    _lastLiveRender = now;
    renderLive();
  }
}

// ================================================================ TARE
let tareOffset = 0;

async function sendTare() {
  if (state.mockMode) {
    if (state.mock) state.mock.weight10 = 0;
    toast('已去皮（模拟）');
    return;
  }
  if (state.writeChar) {
    try {
      await state.writeChar.writeValue(
        new Uint8Array(Array.from(SPOON_PROTOCOL.tareCommand).map(c => c.charCodeAt(0))));
      toast('去皮命令已发送');
      return;
    } catch { /* 落到软件去皮 */ }
  }
  softwareTare();
}

function softwareTare() {
  if (spoonState.weight != null) {
    tareOffset = spoonState.weight;
    toast('已软件去皮（当前重量设为零点）');
  }
}

function currentWeight() {
  if (spoonState.weight == null) return null;
  return Math.max(0, spoonState.weight - tareOffset);   // 负数兜底（Part 25）
}

// ================================================================ 用餐会话
function startMeal() {
  const dish = $('picked-dish').textContent || '';
  state.result = null;
  state.meal = {
    dish,
    dishCaloriePer100g: parseFloat($('picked-dish').dataset.calorie) || null,
    startTime: new Date(),
    startWeight: null,
    lastWeight: null,
    intake: 0,
    startMark: spoonState.markCount,
    bites: 0,
  };
  _lastBites = 0;
  switchTab('during');
  $('during-idle').style.display = 'none';
  $('during-active').style.display = 'block';
  $('during-result').style.display = 'none';
  $('meal-dish-label').textContent = dish || '未命名的一餐';
  renderLive();
}

function onMealSample() {
  const m = state.meal;
  const w = currentWeight();
  if (w == null) return;
  if (m.startWeight === null && spoonState.stable) m.startWeight = w;
  if (m.startWeight !== null) {
    m.intake = Math.max(0, m.startWeight - w);
  }
  m.lastWeight = w;
  m.bites = Math.max(0, spoonState.markCount - m.startMark);
}

function tickMealUI() {
  if (state.meal) renderLive();   // 计时器走全量刷新（1Hz，无动画抖动）
}

function mealElapsedSec() {
  return state.meal ? Math.floor((Date.now() - state.meal.startTime) / 1000) : 0;
}

let _lastBites = 0;
function renderLive() {
  if (state.meal) {
    const m = state.meal;
    animateNumber($('big-intake'), Math.min(m.intake, 9999), 1);   // 溢出兜底（Part 25）
    if (m.bites > _lastBites) haptic(15);
    _lastBites = m.bites;
    $('meal-bites').textContent = m.bites;
    $('meal-elapsed').textContent = fmtDuration(mealElapsedSec());
    const connected = connState === 'connected';
    // Part 13：颜色 + 文字双重表达状态
    $('meal-rec-status').innerHTML = connected
      ? '<span class="status-dot green"></span>记录中'
      : '<span class="status-dot amber"></span>设备断连，仅计时';
    $('meal-rec-status').className = 'second-line ' + (connected ? 'ok' : 'warn');
    const w = currentWeight();
    $('meal-spoon-weight').textContent =
      w != null ? `${w.toFixed(1)} g` : '--';          // 无数据兜底（Part 25）

    // 摄入进度环：装饰性满环（无目标摄入设定）
    const ring = $('intake-ring');
    if (ring) ring.style.strokeDashoffset = '0';
  } else if (spoonState.weight != null) {
    const w = currentWeight();
    $('pre-weight').textContent = w != null ? w.toFixed(1) + ' g' : '--';
  }
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// ================================================================ 餐后（Part 14）
function endMeal() {
  const m = state.meal;
  if (!m) return;
  const sec = mealElapsedSec();
  const calorie = (m.dishCaloriePer100g && m.intake > 0)
    ? Math.round(m.dishCaloriePer100g * m.intake / 100) : null;

  state.result = {
    id: 'meal-' + Date.now(),
    start_time: m.startTime.toISOString(),
    end_time: new Date().toISOString(),
    dish_name: m.dish,
    duration_seconds: sec,
    intake_g: +m.intake.toFixed(1),
    bites: m.bites,
    avg_per_bite_g: m.bites > 0 ? +(m.intake / m.bites).toFixed(1) : null,
    pace_bites_per_min: sec >= 30 ? +(m.bites / (sec / 60)).toFixed(1) : null,
    calorie_kcal: calorie,
    synced: false,
  };
  state.meal = null;

  state.records.unshift(state.result);
  saveRecords();
  renderRecords();

  $('during-active').style.display = 'none';
  $('during-result').style.display = 'block';
  const r = state.result;
  // Part 14：餐后可以展示更多信息，但不塞原始传感器值
  $('result-summary').innerHTML = `
    <div class="result-grid">
      <div class="result-main">
        <div class="result-num">${r.intake_g}</div>
        <div class="result-unit">总摄入（g）</div>
      </div>
      ${r.calorie_kcal != null ? `
      <div class="result-main accent">
        <div class="result-num">${r.calorie_kcal}</div>
        <div class="result-unit">约热量（千卡）</div>
      </div>` : ''}
    </div>
    <div class="result-rows">
      <div class="summary-row">用餐时长：${fmtDuration(r.duration_seconds)}</div>
      <div class="summary-row">总口数：${r.bites} 口</div>
      ${r.avg_per_bite_g != null ? `<div class="summary-row">平均每口：${r.avg_per_bite_g} g</div>` : ''}
      ${r.pace_bites_per_min != null ? `<div class="summary-row">进餐节奏：${r.pace_bites_per_min} 口/分钟</div>` : ''}
    </div>`;
  drawResultChart();

  requestAnimationFrame(() => {
    document.querySelectorAll('#result-summary .result-num').forEach(el => {
      const target = parseFloat(el.textContent) || 0;
      el.textContent = '0';
      animateNumber(el, target, Number.isInteger(target) ? 0 : 1, 700);
    });
  });

  syncRecord(r);
}

function newMeal() {
  $('during-result').style.display = 'none';
  $('during-idle').style.display = 'block';
  $('picked-dish').textContent = '';
  $('picked-dish').dataset.calorie = '';
  $('recognize-result').innerHTML = '';
  $('detected-box').style.display = 'none';
  $('food-preview').style.display = 'none';
  state.detected = null;
  switchTab('pre');
}

// ================================================================ 模拟勺子
function connectMock() {
  state.mockMode = true;
  state.deviceName = '模拟勺子 Mock-Spoon-01';
  state.mock = { weight10: 0, mark: 0, tick: 0, phase: 'idle' };
  setConnState('connecting');
  setTimeout(() => {
    state.device = null;
    reconnectAttempts = 0;
    setConnState('connected');
    state.mockTimer = setInterval(mockStep, 1000);
  }, 500);
}

function mockStep() {
  const mk = state.mock;
  mk.tick++;
  if (state.meal) {
    if (mk.phase === 'idle') { mk.weight10 = 3000; mk.phase = 'eating'; }
    else if (mk.tick % 4 === 0) {
      mk.weight10 = Math.max(0, mk.weight10 - (150 + Math.floor(Math.random() * 100)));
      mk.mark++;
    }
  } else if (mk.phase !== 'idle') {
    mk.phase = 'idle'; mk.weight10 = 0; mk.mark = 0;
  }
  const body = 1200 + Math.floor(Math.random() * 80 - 40);
  const stable = mk.tick % 4 !== 1 ? 1 : 0;
  onLine(`S,${mk.weight10},${body},${stable},${mk.mark}`);
}

function stopMock() {
  clearInterval(state.mockTimer);
  state.mockMode = false;
  state.mock = null;
  setConnState('idle');
}

// ================================================================ 摄像头（getUserMedia 取景拍照）
let camStream = null;
let camFacing = 'environment';   // 默认后置镜头（拍食物）

/** 打开取景弹窗；不支持/被拒时降级为系统文件选择 */
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('当前环境不支持调用摄像头，已改为选择图片');
    $('file-camera').click();
    return;
  }
  $('camera-modal').style.display = 'flex';
  $('camera-error').style.display = 'none';
  await startCamStream();
}

async function startCamStream() {
  stopCamStream();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: camFacing }, width: { ideal: 1280 } },
      audio: false,
    });
    const video = $('camera-video');
    video.srcObject = camStream;
    video.style.display = 'block';
  } catch (err) {
    closeCamera();
    handleCameraError(err);
  }
}

function handleCameraError(err) {
  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
    if (!window.isSecureContext) {
      // HTTP 环境（如局域网 IP 访问）：getUserMedia 被浏览器禁止，降级文件选择
      toast('当前为 HTTP 访问，无法调用摄像头，已改为选择图片');
      $('file-camera').click();
      return;
    }
    alert('摄像头权限被拒绝。\n请点击地址栏左侧的 🔒 图标，允许「摄像头」权限后重试。');
  } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
    if (camFacing === 'environment') {
      // 没有后置镜头（如电脑）→ 自动换前置再试一次
      camFacing = 'user';
      $('camera-modal').style.display = 'flex';
      startCamStream();
      return;
    }
    alert('没有检测到可用的摄像头。\n可以用「相册」从图片中选择。');
  } else if (err.name === 'NotReadableError') {
    alert('摄像头正被其他应用占用，请关闭后重试。');
  } else {
    alert('摄像头打开失败：' + err.message);
  }
}

/** 切换前后置镜头 */
async function switchCamera() {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  await startCamStream();
}

function stopCamStream() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
}

function closeCamera() {
  stopCamStream();
  $('camera-modal').style.display = 'none';
}

/** 快门：取景帧 → JPEG → 进入识别流程 */
function takePhoto() {
  const video = $('camera-video');
  if (!camStream || !video.videoWidth) { toast('摄像头还没准备好'); return; }
  const canvas = $('camera-canvas');
  // 限制最长边 1280，兼顾识别精度与上传速度
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  haptic(20);
  canvas.toBlob((blob) => {
    closeCamera();
    if (!blob) { toast('拍照失败，请重试'); return; }
    recognizeFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.88);
}

// ================================================================ 拍照识别 + 确认/修改（Part 5）
function recognizeDish(input) {
  const file = input.files[0];
  if (file) recognizeFile(file);
  input.value = '';
}

async function recognizeFile(file) {
  // 食物图片预览（Part 4）
  if (state.foodImageUrl) URL.revokeObjectURL(state.foodImageUrl);
  state.foodImageUrl = URL.createObjectURL(file);
  const preview = $('food-preview');
  preview.src = state.foodImageUrl;
  preview.style.display = 'block';

  const box = $('recognize-result');
  box.innerHTML = `
    <div class="skeleton" role="status" aria-label="正在识别菜品">
      <div class="skeleton-line w60"></div>
      <div class="skeleton-line w40"></div>
    </div>`;
  $('detected-box').style.display = 'none';

  const fd = new FormData();
  fd.append('image', file);
  try {
    const resp = await fetch('/api/recognize', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || '识别失败');
    const dishes = data.dishes || [];
    if (dishes.length === 0) {
      box.innerHTML = '<div class="empty-hint">没有识别出菜品，可以手动输入</div>';
      showEditDish();
      return;
    }
    box.innerHTML = dishes.map((d, i) => `
      <div class="dish-item ${i === 0 ? 'dish-top' : ''}"
           onclick="setDetected('${esc(d.name)}', '${esc(String(d.calorie || ''))}')">
        <div class="dish-info">
          <div class="dish-name">${esc(d.name)}</div>
          <div class="dish-cal">约 ${esc(String(d.calorie || '--'))} 千卡/100g</div>
        </div>
        <div class="dish-prob">
          <div class="prob-bar"><div style="width:${Math.round((d.probability || 0) * 100)}%"></div></div>
          <span>${Math.round((d.probability || 0) * 100)}%</span>
        </div>
      </div>`).join('');
    // 默认选中第一个，但仍需用户确认（Part 5）
    setDetected(dishes[0].name, String(dishes[0].calorie || ''));
  } catch (err) {
    box.innerHTML = `<div class="error-box">识别没有成功：${esc(err.message)}<br>可以点「修改」手动输入菜名。</div>`;
    showEditDish();
  }
}

/** Part 5：识别结果进入「待确认」状态，不直接当最终答案 */
function setDetected(name, calorie) {
  state.detected = { name, calorie };
  const box = $('detected-box');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="detected-card">
      <div class="detected-label">识别结果</div>
      <div class="detected-name">${esc(name)}</div>
      <div class="detected-cal">${calorie ? `约 ${esc(calorie)} 千卡/100g` : ''}</div>
      <div class="btn-row" style="margin:10px 0 0">
        <button type="button" class="btn btn-primary" onclick="confirmDish()">✓ 确认</button>
        <button type="button" class="btn btn-outline" onclick="showEditDish()">✎ 修改</button>
      </div>
    </div>`;
}

function confirmDish() {
  if (!state.detected) return;
  const el = $('picked-dish');
  el.textContent = state.detected.name;
  el.dataset.calorie = state.detected.calorie;
  haptic(12);
  toast(`已确认：${state.detected.name}，可以开始用餐了`);
}

/** 修改：手动输入菜名/热量（识别失败时的分支，Part 3） */
function showEditDish() {
  const cur = state.detected || { name: '', calorie: '' };
  const box = $('detected-box');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="detected-card">
      <div class="detected-label">手动修正菜品</div>
      <input type="text" id="edit-dish-name" class="edit-input" placeholder="菜名，如 宫保鸡丁"
             value="${esc(cur.name)}">
      <input type="number" id="edit-dish-cal" class="edit-input" placeholder="热量（千卡/100g，可留空）"
             value="${esc(cur.calorie)}" inputmode="decimal">
      <div class="btn-row" style="margin:10px 0 0">
        <button type="button" class="btn btn-primary" onclick="applyEditDish()">✓ 确定</button>
      </div>
    </div>`;
}

function applyEditDish() {
  const name = $('edit-dish-name').value.trim();
  const cal = $('edit-dish-cal').value.trim();
  if (!name) { toast('请输入菜名'); return; }
  setDetected(name, cal);
  confirmDish();
}

// ================================================================ 调试页（Part 15：Developer View）
function renderDebug() {
  const s = spoonState;
  const updated = s.updatedAt
    ? [s.updatedAt.getHours(), s.updatedAt.getMinutes(), s.updatedAt.getSeconds()]
        .map(n => String(n).padStart(2, '0')).join(':')
    : '--';
  $('dbg-parsed').innerHTML = s.weight != null ? `
    <div class="dbg-row"><span>BLE</span><b>${connState === 'connected' ? 'Connected' : connState}</b></div>
    <div class="dbg-row"><span>Weight</span><b>${s.weight.toFixed(1)} g（×10 传输）</b></div>
    <div class="dbg-row"><span>Body</span><b>${s.body}</b></div>
    <div class="dbg-row"><span>Stable</span><b>${s.stable ? 'true' : 'false'}</b></div>
    <div class="dbg-row"><span>Mark</span><b>${s.markCount}</b></div>
    <div class="dbg-row"><span>更新时间</span><b>${updated}</b></div>
    <div class="dbg-row"><span>软件去皮偏移</span><b>${tareOffset.toFixed(1)} g</b></div>
    ${state.lastError ? `<div class="dbg-row"><span>最近错误</span><b class="dbg-err">${esc(state.lastError)}</b></div>` : ''}`
    : `<div class="empty-hint">暂无数据</div>
       ${state.lastError ? `<div class="dbg-row"><span>最近错误</span><b class="dbg-err">${esc(state.lastError)}</b></div>` : ''}`;

  $('dbg-raw').innerHTML = state.rawLog.length === 0
    ? '<div class="empty-hint">等待 BLE 消息…</div>'
    : state.rawLog.slice(0, 60).map(p => {
        const t = p.time;
        const ts = [t.getHours(), t.getMinutes(), t.getSeconds()]
          .map(n => String(n).padStart(2, '0')).join(':');
        return `<div class="packet"><span class="packet-hex">${esc(p.line)}</span><span class="packet-meta">${ts}</span></div>`;
      }).join('');

  drawDebugChart();
}

function drawDebugChart() {
  const canvas = $('dbg-chart');
  if (!canvas || state.weightSeries.length < 2) return;
  drawLineChart(canvas, state.weightSeries.map(p => p.weightG), 'g');
}

function drawResultChart() {
  const canvas = $('result-chart');
  if (!canvas) return;
  drawLineChart(canvas, state.weightSeries.map(p => p.weightG), 'g');
}

function drawLineChart(canvas, pts, unit) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = 300;
  ctx.clearRect(0, 0, W, H);
  if (pts.length < 2) {
    ctx.fillStyle = '#999'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('数据积累中…', W / 2, H / 2);
    return;
  }
  const min = Math.min(...pts), max = Math.max(...pts);
  const pad = Math.max((max - min) * 0.2, 1);
  const x = i => 60 + i * (W - 80) / (pts.length - 1);
  const y = v => H - 30 - (v - min + pad) * (H - 60) / (max - min + 2 * pad);
  ctx.strokeStyle = '#eee'; ctx.fillStyle = '#999'; ctx.font = '18px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = min - pad + (max - min + 2 * pad) * i / 4;
    ctx.beginPath(); ctx.moveTo(60, y(v)); ctx.lineTo(W - 20, y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(v.toFixed(0) + unit, 55, y(v) + 6);
  }
  ctx.strokeStyle = '#667eea'; ctx.lineWidth = 3; ctx.beginPath();
  pts.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.stroke();
}

// ================================================================ 记录
function loadRecords() {
  try { state.records = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); }
  catch { state.records = []; }
}

function saveRecords() {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records));
}

async function syncRecord(record) {
  try {
    const resp = await fetch('/api/meal-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (resp.ok) { record.synced = true; saveRecords(); renderRecords(); }
  } catch { /* 后端不可达，稍后一键同步 */ }
}

async function syncAll() {
  let ok = 0;
  for (const r of state.records.filter(r => !r.synced)) {
    await syncRecord(r);
    if (r.synced) ok++;
  }
  toast(`已同步 ${ok} 条记录`);
}

function clearRecords() {
  if (!confirm('清空所有本地用餐记录？已同步到服务器的不受影响。')) return;
  state.records = [];
  saveRecords();
  renderRecords();
}

function renderRecords() {
  renderWeekStats();
  const box = $('records-list');
  const pending = state.records.filter(r => !r.synced).length;
  $('records-summary').textContent =
    `共 ${state.records.length} 条记录` + (pending ? ` · ${pending} 条待同步` : '');
  $('btn-sync-all').style.display = pending ? '' : 'none';
  if (state.records.length === 0) {
    box.innerHTML = '<div class="empty-hint">还没有用餐记录<br>完成一次用餐后会出现在这里</div>';
    return;
  }
  box.innerHTML = state.records.map(r => {
    const t = new Date(r.start_time);
    const ts = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const bits = [
      r.intake_g != null ? `${r.intake_g}g` : null,
      r.bites != null ? `${r.bites}口` : null,
      r.calorie_kcal != null ? `约${r.calorie_kcal}千卡` : null,
      fmtDuration(r.duration_seconds || 0),
    ].filter(Boolean).join(' · ');
    return `<div class="record-item">
      <div class="record-avatar">${esc((r.dish_name || '餐')[0])}</div>
      <div class="record-info">
        <div class="record-name">${esc(r.dish_name || '未命名的一餐')}</div>
        <div class="record-meta">${ts} · ${bits}</div>
      </div>
      <div class="record-sync ${r.synced ? 'synced' : ''}" title="${r.synced ? '已同步' : '未同步'}">${r.synced ? '☁️✓' : '☁️✗'}</div>
    </div>`;
  }).join('');
}

// ================================================================ 本周统计（数据可视化）
function renderWeekStats() {
  const card = $('week-stats-card');
  if (!card) return;
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const weekAgo = now - 7 * dayMs;
  const week = state.records.filter(r => new Date(r.start_time).getTime() >= weekAgo);

  if (week.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const sum = (f) => week.reduce((a, r) => a + (f(r) || 0), 0);
  $('week-meals').textContent = week.length;
  $('week-intake').textContent = Math.round(sum(r => r.intake_g));
  $('week-cal').textContent = Math.round(sum(r => r.calorie_kcal));
  $('week-bites').textContent = sum(r => r.bites);

  // 近 7 天柱状图：按天分桶摄入克数
  const buckets = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = (d.getMonth() + 1) + '/' + d.getDate();
    const total = state.records
      .filter(r => {
        const t = new Date(r.start_time);
        return t.getFullYear() === d.getFullYear() &&
               t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
      })
      .reduce((a, r) => a + (r.intake_g || 0), 0);
    buckets.push({ label: key, value: Math.round(total) });
  }
  drawWeekChart(buckets);
}

function drawWeekChart(buckets) {
  const canvas = $('week-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = 260;
  ctx.clearRect(0, 0, W, H);

  const max = Math.max(...buckets.map(b => b.value), 50);
  const n = buckets.length;
  const slot = (W - 40) / n;
  const barW = Math.min(slot * 0.55, 64);

  buckets.forEach((b, i) => {
    const x = 20 + i * slot + (slot - barW) / 2;
    const h = b.value > 0 ? Math.max((b.value / max) * (H - 70), 6) : 2;
    const y = H - 40 - h;

    if (b.value > 0) {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#667eea');
      grad.addColorStop(1, '#764ba2');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#e2e8f0';
    }
    const r = Math.min(8, barW / 2);
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barW, h, [r, r, 0, 0]);
    } else {
      ctx.rect(x, y, barW, h);   // 老浏览器降级为直角柱
    }
    ctx.fill();

    ctx.fillStyle = b.value > 0 ? '#4a5568' : '#a0aec0';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    if (b.value > 0) ctx.fillText(String(b.value), x + barW / 2, y - 8);
    ctx.fillStyle = '#a0aec0';
    ctx.fillText(b.label, x + barW / 2, H - 14);
  });

  ctx.fillStyle = '#cbd5e0';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('近 7 天摄入（g）', 20, 22);
}
