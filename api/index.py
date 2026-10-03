import os
import sys

# Vercel serverless: 用绝对路径配置 Flask
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')

sys.path.insert(0, SERVER_DIR)

from flask import Flask

app = Flask(
    __name__,
    template_folder=os.path.join(SERVER_DIR, 'templates'),
    static_folder=os.path.join(SERVER_DIR, 'static'),
    static_url_path='/static'
)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# 导入路由（app.py 里的所有 @app.route 定义）
# 先临时替换 Flask 实例，让 app.py 的注册路由到我们的 app 上
import importlib
import baidu_dish

import json
import threading
from pathlib import Path
from dotenv import load_dotenv
from flask import jsonify, render_template, request

load_dotenv()

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}
MAX_CONTENT_LENGTH = 8 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

def is_allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/spoon")
def spoon():
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

@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "service": "smart-spoon-server"})

MEAL_RECORDS_FILE = os.path.join(SERVER_DIR, "meal_records.json")
_meal_lock = threading.Lock()

def _load_meal_records():
    if not os.path.exists(MEAL_RECORDS_FILE):
        return []
    try:
        with open(MEAL_RECORDS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

@app.route("/api/meal-records", methods=["GET", "POST"])
def api_meal_records():
    if request.method == "GET":
        with _meal_lock:
            records = _load_meal_records()
        return jsonify({"ok": True, "records": records})
    record = request.get_json(silent=True)
    if not record or "id" not in record:
        return jsonify({"ok": False, "message": "记录格式不正确"}), 400
    with _meal_lock:
        records = _load_meal_records()
        if not any(r.get("id") == record["id"] for r in records):
            records.append(record)
            try:
                with open(MEAL_RECORDS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(records, f, ensure_ascii=False, indent=2)
            except:
                pass
    return jsonify({"ok": True})

# Vercel handler
handler = app
