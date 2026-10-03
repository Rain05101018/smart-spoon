// app.js —— 纯前端逻辑，不依赖任何框架
// 收藏 / 记录数据保存在 localStorage 中，没有后端数据库

const STORAGE_KEYS = {
  favorites: "zws_favorites",
  records: "zws_records",
};

// ---------------- 通用工具 ----------------

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatTime(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------- 页面状态 ----------------

const state = {
  currentView: "quickstart",
  currentStep: 1,
  selectedDish: null,
  timerSeconds: 0,
  timerHandle: null,
};

// ---------------- DOM 元素 ----------------

const els = {
  navItems: document.querySelectorAll(".nav-item"),
  views: {
    quickstart: document.getElementById("view-quickstart"),
    favorites: document.getElementById("view-favorites"),
    records: document.getElementById("view-records"),
    settings: document.getElementById("view-settings"),
  },
  stepper: document.getElementById("stepper"),
  steps: document.querySelectorAll(".step"),
  stepPanels: {
    1: document.getElementById("panel-step1"),
    2: document.getElementById("panel-step2"),
    3: document.getElementById("panel-step3"),
  },

  fileInput: document.getElementById("fileInput"),
  previewWrap: document.getElementById("previewWrap"),
  previewImg: document.getElementById("previewImg"),
  recognizeLoading: document.getElementById("recognizeLoading"),
  recognizeError: document.getElementById("recognizeError"),
  recognizeResult: document.getElementById("recognizeResult"),
  dishCards: document.getElementById("dishCards"),
  btnConfirmDish: document.getElementById("btnConfirmDish"),

  chosenDishLabel: document.getElementById("chosenDishLabel"),
  timerDisplay: document.getElementById("timerDisplay"),
  btnFinishMeal: document.getElementById("btnFinishMeal"),

  mealSummary: document.getElementById("mealSummary"),
  btnSaveFavorite: document.getElementById("btnSaveFavorite"),
  btnSaveRecord: document.getElementById("btnSaveRecord"),
  btnRestart: document.getElementById("btnRestart"),

  favoritesList: document.getElementById("favoritesList"),
  favoritesEmpty: document.getElementById("favoritesEmpty"),
  recordsList: document.getElementById("recordsList"),
  recordsEmpty: document.getElementById("recordsEmpty"),
  btnClearData: document.getElementById("btnClearData"),
};

// ---------------- 导航切换 ----------------

function switchView(viewName) {
  state.currentView = viewName;

  Object.entries(els.views).forEach(([name, el]) => {
    el.classList.toggle("hidden", name !== viewName);
    el.classList.toggle("active", name === viewName);
  });

  els.navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  // 三步流程指示器只在“快速开始”主线里展示
  els.stepper.classList.toggle("hidden", viewName !== "quickstart");

  if (viewName === "favorites") renderFavorites();
  if (viewName === "records") renderRecords();
}

els.navItems.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---------------- 步骤切换 ----------------

function goToStep(stepNumber) {
  state.currentStep = stepNumber;

  Object.entries(els.stepPanels).forEach(([num, el]) => {
    el.classList.toggle("hidden", Number(num) !== stepNumber);
    el.classList.toggle("active", Number(num) === stepNumber);
  });

  els.steps.forEach((stepEl) => {
    const num = Number(stepEl.dataset.step);
    stepEl.classList.remove("active", "done");
    if (num < stepNumber) stepEl.classList.add("done");
    if (num === stepNumber) stepEl.classList.add("active");
  });
}

// ---------------- 第一步：上传 & 识别 ----------------

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // 预览图片
  const reader = new FileReader();
  reader.onload = (e) => {
    els.previewImg.src = e.target.result;
    els.previewWrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);

  // 重置识别结果区域
  els.recognizeError.classList.add("hidden");
  els.recognizeResult.classList.add("hidden");
  els.dishCards.innerHTML = "";
  state.selectedDish = null;
  els.btnConfirmDish.disabled = true;

  els.recognizeLoading.classList.remove("hidden");

  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch("/api/recognize", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    els.recognizeLoading.classList.add("hidden");

    if (!data.ok) {
      els.recognizeError.textContent = data.message || "识别失败，请重试";
      els.recognizeError.classList.remove("hidden");
      return;
    }

    if (!data.dishes || data.dishes.length === 0) {
      els.recognizeError.textContent = "没有识别到菜品，请换一张照片试试";
      els.recognizeError.classList.remove("hidden");
      return;
    }

    renderDishCards(data.dishes);
    els.recognizeResult.classList.remove("hidden");
  } catch (err) {
    els.recognizeLoading.classList.add("hidden");
    els.recognizeError.textContent = "网络请求失败，请检查后端服务是否已启动";
    els.recognizeError.classList.remove("hidden");
  }
});

function renderDishCards(dishes) {
  els.dishCards.innerHTML = "";

  dishes.forEach((dish, index) => {
    const card = document.createElement("div");
    card.className = "dish-card";
    card.dataset.index = index;

    const probPercent = Math.round((dish.probability || 0) * 100);

    card.innerHTML = `
      <div>
        <div class="dish-name">${dish.name}</div>
        <div class="dish-meta">${dish.calorie ? "热量：" + dish.calorie + " 大卡/100g" : "热量信息暂无"}</div>
      </div>
      <div class="dish-prob">${probPercent}%</div>
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".dish-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedDish = dish;
      els.btnConfirmDish.disabled = false;
    });

    els.dishCards.appendChild(card);
  });
}

els.btnConfirmDish.addEventListener("click", () => {
  if (!state.selectedDish) return;
  els.chosenDishLabel.textContent = `本餐：${state.selectedDish.name}`;
  startTimer();
  goToStep(2);
});

// ---------------- 第二步：用餐中 ----------------

function startTimer() {
  state.timerSeconds = 0;
  els.timerDisplay.textContent = formatTime(0);

  if (state.timerHandle) clearInterval(state.timerHandle);

  state.timerHandle = setInterval(() => {
    state.timerSeconds += 1;
    els.timerDisplay.textContent = formatTime(state.timerSeconds);
  }, 1000);
}

function stopTimer() {
  if (state.timerHandle) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

els.btnFinishMeal.addEventListener("click", () => {
  stopTimer();
  renderMealSummary();
  goToStep(3);
});

// ---------------- 第三步：用餐结果 ----------------

function renderMealSummary() {
  const dish = state.selectedDish || { name: "未知菜品" };
  const duration = formatTime(state.timerSeconds);

  els.mealSummary.innerHTML = `
    <div>🍽 菜品：<strong>${dish.name}</strong></div>
    <div>⏱ 用餐时长：<strong>${duration}</strong></div>
    <div>${dish.calorie ? "🔥 参考热量：<strong>" + dish.calorie + " 大卡/100g</strong>" : ""}</div>
  `;
}

els.btnSaveFavorite.addEventListener("click", () => {
  if (!state.selectedDish) return;
  const favorites = readStorage(STORAGE_KEYS.favorites);

  const already = favorites.some((f) => f.name === state.selectedDish.name);
  if (!already) {
    favorites.push({
      name: state.selectedDish.name,
      calorie: state.selectedDish.calorie || "",
      addedAt: new Date().toISOString(),
    });
    writeStorage(STORAGE_KEYS.favorites, favorites);
  }

  els.btnSaveFavorite.textContent = "已加入收藏 ✓";
  els.btnSaveFavorite.disabled = true;
});

els.btnSaveRecord.addEventListener("click", () => {
  if (!state.selectedDish) return;
  const records = readStorage(STORAGE_KEYS.records);

  records.unshift({
    name: state.selectedDish.name,
    calorie: state.selectedDish.calorie || "",
    duration: state.timerSeconds,
    finishedAt: new Date().toISOString(),
  });
  writeStorage(STORAGE_KEYS.records, records);

  els.btnSaveRecord.textContent = "已保存记录 ✓";
  els.btnSaveRecord.disabled = true;
});

els.btnRestart.addEventListener("click", () => {
  resetQuickStartFlow();
  goToStep(1);
});

function resetQuickStartFlow() {
  state.selectedDish = null;
  state.timerSeconds = 0;
  stopTimer();

  els.fileInput.value = "";
  els.previewWrap.classList.add("hidden");
  els.recognizeError.classList.add("hidden");
  els.recognizeResult.classList.add("hidden");
  els.dishCards.innerHTML = "";
  els.btnConfirmDish.disabled = true;

  els.btnSaveFavorite.disabled = false;
  els.btnSaveFavorite.textContent = "加入收藏";
  els.btnSaveRecord.disabled = false;
  els.btnSaveRecord.textContent = "保存到用餐记录";
}

// ---------------- 收藏食物 ----------------

function renderFavorites() {
  const favorites = readStorage(STORAGE_KEYS.favorites);
  els.favoritesList.innerHTML = "";

  els.favoritesEmpty.classList.toggle("hidden", favorites.length > 0);

  favorites.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="list-item-name">${item.name}</div>
        <div class="list-item-meta">${item.calorie ? item.calorie + " 大卡/100g" : "热量信息暂无"}</div>
      </div>
      <button class="list-item-remove" data-index="${index}">✕</button>
    `;
    row.querySelector(".list-item-remove").addEventListener("click", () => {
      const updated = readStorage(STORAGE_KEYS.favorites);
      updated.splice(index, 1);
      writeStorage(STORAGE_KEYS.favorites, updated);
      renderFavorites();
    });
    els.favoritesList.appendChild(row);
  });
}

// ---------------- 用餐记录 ----------------

function renderRecords() {
  const records = readStorage(STORAGE_KEYS.records);
  els.recordsList.innerHTML = "";

  els.recordsEmpty.classList.toggle("hidden", records.length > 0);

  records.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const dateStr = new Date(item.finishedAt).toLocaleString("zh-CN");
    row.innerHTML = `
      <div>
        <div class="list-item-name">${item.name}</div>
        <div class="list-item-meta">${dateStr} · 用餐 ${formatTime(item.duration)}</div>
      </div>
      <button class="list-item-remove" data-index="${index}">✕</button>
    `;
    row.querySelector(".list-item-remove").addEventListener("click", () => {
      const updated = readStorage(STORAGE_KEYS.records);
      updated.splice(index, 1);
      writeStorage(STORAGE_KEYS.records, updated);
      renderRecords();
    });
    els.recordsList.appendChild(row);
  });
}

// ---------------- 设置 ----------------

els.btnClearData.addEventListener("click", () => {
  if (confirm("确定要清空本地收藏与用餐记录吗？此操作无法撤销。")) {
    localStorage.removeItem(STORAGE_KEYS.favorites);
    localStorage.removeItem(STORAGE_KEYS.records);
    renderFavorites();
    renderRecords();
  }
});

// ---------------- 初始化 ----------------

switchView("quickstart");
goToStep(1);
