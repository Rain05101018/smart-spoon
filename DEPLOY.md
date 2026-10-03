# 🚀 部署指南：GitHub + 公网访问

## 第一步：创建 GitHub 仓库并推送代码

### 1A. 在 GitHub 上创建新仓库
1. 打开 https://github.com/new
2. Repository name 填：**smart-spoon**
3. 选 **Public**（这样别人才能访问）
4. ❌ 不要勾选 "Add a README file"（我们已有代码）
5. 点 **Create repository**

### 1B. 推送代码到 GitHub
打开你电脑的 **命令提示符（CMD）或 PowerShell**，依次运行：

```bash
cd C:\Users\Rain\WorkBuddy\2026-10-02-13-13-52\smart-spoon
git remote add origin https://github.com/你的GitHub用户名/smart-spoon.git
git push -u origin main
```

> 如果弹出登录窗口，输入你的 GitHub 账号密码（或 Personal Access Token）即可。
> 没有 Token 的话去 https://github.com/settings/tokens → Generate new token → 勾选 `repo` 权限。

推送成功后，你的代码就在这里了：
**https://github.com/你的用户名/smart-spoon**

---

## 第二步：部署到公网（免费，5 分钟上线）

我们用 **Render**（免费额度足够个人项目）来托管你的 Flask 服务。

### 2A. 注册 Render 并导入项目
1. 打开 https://dashboard.render.com
2. 用 **GitHub 账号**登录（点 "Get Started" → "Continue with GitHub"）
3. 点 **"New +"** → **"Web Service"**
4. 在列表里找到 **smart-spoon** 仓库，点 **Connect**
5. Render 会自动读取 `render.yaml` 配置

### 2B. 配置环境变量（重要！）
在 Render 的部署配置页：

| 名称 | 值 |
|------|-----|
| `BAIDU_API_KEY` | `QseGqS5XZcFaykoyRy61HSD5` |
| `BAIDU_SECRET_KEY` | `B1bWipQQIj3hlSGoHXwMbUYoBC1JZlJR` |

> ⚠️ 这两个值填入后，你的网站就能使用百度菜品识别了。

### 2C. 启动部署
- **Runtime**: Python（应该已自动选中）
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python app.py`
- **Plan**: 选 **Free**（免费版）
- 点底部 **"Create Web Service"**

Render 会自动：
1. 安装 Python 依赖
2. 启动 Flask 服务
3. 分配一个公网网址：**https://xxxxx.onrender.com**

---

## 第三步：访问你的网站

部署完成后（通常 2-3 分钟），Render 会给你一个 URL，类似：

```
https://smart-spoon-xxxx.onrender.com/spoon
```

- **电脑/手机都能打开** ✅
- **HTTPS 安全连接**（手机蓝牙功能可用）✅
- **24 小时在线**（免费版闲置 15 分钟后会休眠，再次访问自动唤醒）✅
- **任何人都能访问** ✅

---

## 后续：绑定自定义域名（可选）

如果你想要更短的域名（如 `spoon.yourname.com`）：
1. Render 控制台 → 你的服务 → **Settings** → **Custom Domains**
2. 输入你的域名
3. 在你的域名 DNS 处添加 CNAME 记录指向 Render 给的地址

---

## 本地开发提醒

本地运行仍然用：
```bash
cd server
../.venv/Scripts/python app.py
# 打开 http://localhost:5000/spoon
```

## 常见问题

**Q: 推送时提示 "Authentication failed"？**
A: 需要生成 GitHub Personal Access Token：
https://github.com/settings/tokens → Generate new token (classic) → 勾选 `repo` → 复制 token 作为密码使用

**Q: Render 部署失败？**
A: 查看 Render 的 Logs 标签页，最常见原因是环境变量没填对。确保 BAIDU_API_KEY 和 BAIDU_SECRET_KEY 正确填写。

**Q: 免费版会收费吗？**
A: Render 免费版有 750 小时/月的限制，个人项目完全够用。超出后会暂停，下月重置。
