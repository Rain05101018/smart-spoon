import os
import sys

# 让 Python 找到 server/ 目录下的模块
SERVER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server')
sys.path.insert(0, SERVER_DIR)

# 切换工作目录到 server/，这样 Flask 能找到 templates/ 和 static/
os.chdir(SERVER_DIR)

from app import app

# Vercel 需要 handler 变量
handler = app
