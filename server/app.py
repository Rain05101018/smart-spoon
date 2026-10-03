"""
app.py
一个非常轻量的 Flask 后端：
- GET  /            返回前端页面
- POST /api/recognize   接收上传的图片，调用百度菜品识别 API，返回识别结果

没有数据库、没有登录系统，收藏 / 记录数据全部保存在浏览器本地（localStorage）。
"""

import json
import os
import threading
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

import baidu_dish

load_dotenv()  # 从 .env 文件加载 BAIDU_API_KEY / BAIDU_SECRET_KEY

app = Flask(__name__)
# 开发期模板改动即时生效，避免"改了 HTML 但页面不更新"的坑
app.config["TEMPLATES_AUTO_RELOAD"] = True

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}
MAX_CONTENT_LENGTH = 8 * 1024 * 1024  # 8MB，避免上传过大图片
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def is_allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/spoon")
def spoon():
    """智味勺完整版：蓝牙连接勺子 + 看板 + 识餐 + 用餐记录。"""
    return render_template("spoon.html")


@app.route("/api/recognize", methods=["POST"])
def api_recognize():
    if "image" not in request.files:
        return jsonify({"ok": False, "message": "没有收到图片文件"}), 400

    image_file = request.files["image"]

    if image_file.filename == "":
        return jsonify({"ok": False, "message": "没有选择文件"}), 400

    if not is_allowed_file(image_file.filename):
        return jsonify({"ok": False, "message": "不支持的图片格式"}), 400

    image_bytes = image_file.read()
    result = baidu_dish.recognize_dish_bytes(image_bytes)

    if "error" in result:
        return jsonify({"ok": False, "message": result["error"]}), 502

    if "error_code" in result:
        return jsonify({
            "ok": False,
            "message": result.get("error_msg", "百度接口返回错误"),
            "error_code": result.get("error_code"),
        }), 502

    dishes = []
    for item in result.get("result", []):
        dishes.append({
            "name": item.get("name", "未知菜品"),
            "probability": item.get("probability", 0),
            "calorie": item.get("calorie", ""),
        })

    return jsonify({"ok": True, "dishes": dishes})


# ---------------------------------------------------------------- 智味勺 App 接口

@app.route("/api/health")
def api_health():
    """App 侧健康检查。"""
    return jsonify({"ok": True, "service": "smart-spoon-server"})


# 用餐记录：JSON 文件存储（轻量，单机够用；多用户再上数据库）
MEAL_RECORDS_FILE = Path(__file__).resolve().parent / "meal_records.json"
_meal_lock = threading.Lock()


def _load_meal_records():
    if not MEAL_RECORDS_FILE.exists():
        return []
    try:
        return json.loads(MEAL_RECORDS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


@app.route("/api/meal-records", methods=["GET", "POST"])
def api_meal_records():
    """智味勺 App 用餐记录回传：POST 保存一条，GET 查询全部。"""
    if request.method == "GET":
        with _meal_lock:
            records = _load_meal_records()
        return jsonify({"ok": True, "records": records})

    record = request.get_json(silent=True)
    if not record or "id" not in record:
        return jsonify({"ok": False, "message": "记录格式不正确（需要 JSON 且包含 id 字段）"}), 400

    with _meal_lock:
        records = _load_meal_records()
        # 幂等：App 重试同步时同一 id 不重复入库
        if not any(r.get("id") == record["id"] for r in records):
            records.append(record)
            MEAL_RECORDS_FILE.write_text(
                json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
