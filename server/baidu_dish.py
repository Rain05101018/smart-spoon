"""
baidu_dish.py
封装百度菜品识别 API 的调用逻辑：
- get_access_token(): 获取（并缓存）access_token
- recognize_dish_bytes(): 传入图片二进制数据，返回识别结果
- recognize_dish_file(): 传入图片路径，返回识别结果（本地脚本 / 调试用）

API Key / Secret Key 从环境变量读取，不要写死在代码里。
建议使用 .env 文件配置，参考 .env.example。
"""

import base64
import os
import time

import requests

TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
DISH_URL = "https://aip.baidubce.com/rest/2.0/image-classify/v2/dish"

# 简单的内存缓存，避免每次识别都重新申请 access_token
_token_cache = {
    "access_token": None,
    "expires_at": 0,
}


def get_api_credentials():
    """从环境变量中读取百度 API 凭证。"""
    api_key = os.environ.get("BAIDU_API_KEY", "")
    secret_key = os.environ.get("BAIDU_SECRET_KEY", "")
    return api_key, secret_key


def get_access_token(force_refresh: bool = False):
    """获取 access_token，带简单的过期缓存。"""
    now = time.time()

    if not force_refresh and _token_cache["access_token"] and now < _token_cache["expires_at"]:
        return _token_cache["access_token"], None

    api_key, secret_key = get_api_credentials()

    if not api_key or not secret_key:
        return None, "未配置 BAIDU_API_KEY / BAIDU_SECRET_KEY，请检查 .env 文件"

    params = {
        "grant_type": "client_credentials",
        "client_id": api_key,
        "client_secret": secret_key,
    }

    try:
        response = requests.post(TOKEN_URL, params=params, timeout=10)
        result = response.json()
    except requests.RequestException as exc:
        return None, f"请求百度 OAuth 接口失败：{exc}"

    if "access_token" not in result:
        return None, f"获取 access_token 失败：{result}"

    # 百度返回的 expires_in 单位是秒，提前 60 秒过期，留出安全余量
    expires_in = result.get("expires_in", 2592000)
    _token_cache["access_token"] = result["access_token"]
    _token_cache["expires_at"] = now + expires_in - 60

    return result["access_token"], None


def recognize_dish_bytes(image_bytes: bytes, top_num: int = 5):
    """传入图片的二进制内容，调用百度菜品识别接口，返回结果字典。"""
    access_token, error = get_access_token()

    if error:
        return {"error": error}

    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

    params = {"access_token": access_token}
    data = {
        "image": image_base64,
        "top_num": top_num,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    try:
        response = requests.post(DISH_URL, params=params, data=data, headers=headers, timeout=10)
        result = response.json()
    except requests.RequestException as exc:
        return {"error": f"请求百度菜品识别接口失败：{exc}"}

    return result


def recognize_dish_file(image_path: str, top_num: int = 5):
    """传入本地图片路径，调用百度菜品识别接口（本地调试用）。"""
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    return recognize_dish_bytes(image_bytes, top_num=top_num)


if __name__ == "__main__":
    # 简单的命令行自测：识别当前文件夹下的所有图片
    import json
    from pathlib import Path

    IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".webp"]
    folder = Path(__file__).resolve().parent

    image_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS]

    if not image_files:
        print("当前文件夹里没有找到图片。")
    else:
        all_results = []
        for image_path in image_files:
            result = recognize_dish_file(str(image_path))
            all_results.append({"image": image_path.name, "result": result})

        print(json.dumps(all_results, ensure_ascii=False, indent=2))
