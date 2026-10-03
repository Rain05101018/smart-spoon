# -*- coding: utf-8 -*-
"""
deploy.py — 一键部署智味勺到腾讯云轻量服务器（Ubuntu 22.04）

用法：
  .venv/Scripts/python tools/deploy.py --ip <服务器公网IP> --password <root密码>

部署内容：
  1. 安装系统依赖（python3-venv、nginx）
  2. 上传 server/ 代码到 /opt/smart-spoon
  3. 创建 venv + 安装 Python 依赖 + gunicorn
  4. 配置 systemd 服务（开机自启、崩溃自动重启）
  5. 配置 nginx 反向代理 80 → 127.0.0.1:5000
  6. 健康检查

注意：.env（百度密钥）会一起上传，请确保服务器是你自己的。
"""

import argparse
import posixpath
import sys
import time
from pathlib import Path

import paramiko

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
REMOTE_DIR = "/opt/smart-spoon"

# 上传时跳过的文件/目录
SKIP = {"__pycache__", "meal_records.json", ".git"}

PIP_MIRROR = "https://mirrors.cloud.tencent.com/pypi/simple"


def run(ssh, cmd, check=True, timeout=300):
    print(f"  $ {cmd[:90]}{'...' if len(cmd) > 90 else ''}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    if check and code != 0:
        print(f"  [失败 exit={code}] {err[-500:]}")
        sys.exit(1)
    return code, out, err


def upload_dir(sftp, local: Path, remote: str):
    for item in sorted(local.rglob("*")):
        rel = item.relative_to(local).as_posix()
        if any(part in SKIP for part in item.parts):
            continue
        remote_path = posixpath.join(remote, rel)
        if item.is_dir():
            try:
                sftp.mkdir(remote_path)
            except IOError:
                pass
        else:
            ensure_remote_dir(sftp, posixpath.dirname(remote_path))
            sftp.put(str(item), remote_path)
            print(f"  ↑ {rel}")


def ensure_remote_dir(sftp, path):
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.mkdir(cur)
        except IOError:
            pass


def main():
    parser = argparse.ArgumentParser(description="部署智味勺到腾讯云轻量服务器")
    parser.add_argument("--ip", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--user", default="root")
    args = parser.parse_args()

    print(f"[1/6] 连接服务器 {args.ip} …")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(args.ip, username=args.user, password=args.password, timeout=20)
    sftp = ssh.open_sftp()

    print("[2/6] 安装系统依赖（约 1-2 分钟）…")
    run(ssh, "apt-get update -qq")
    run(ssh, "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv python3-pip nginx > /dev/null", timeout=600)

    print("[3/6] 上传代码 …")
    run(ssh, f"mkdir -p {REMOTE_DIR}")
    upload_dir(sftp, SERVER_DIR, REMOTE_DIR)

    print("[4/6] 配置 Python 环境 …")
    run(ssh, f"cd {REMOTE_DIR} && python3 -m venv .venv", timeout=180)
    run(ssh, f"{REMOTE_DIR}/.venv/bin/pip install -q -i {PIP_MIRROR} flask flask-cors python-dotenv requests gunicorn", timeout=600)

    print("[5/6] 配置 systemd 服务 + nginx …")
    service = f"""[Unit]
Description=Smart Spoon Flask App
After=network.target

[Service]
WorkingDirectory={REMOTE_DIR}
ExecStart={REMOTE_DIR}/.venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 app:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    nginx_conf = """server {
    listen 80 default_server;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
"""
    run(ssh, f"cat > /etc/systemd/system/smart-spoon.service << 'EOF'\n{service}EOF")
    run(ssh, f"cat > /etc/nginx/sites-available/smart-spoon << 'EOF'\n{nginx_conf}EOF")
    run(ssh, "ln -sf /etc/nginx/sites-available/smart-spoon /etc/nginx/sites-enabled/smart-spoon")
    run(ssh, "rm -f /etc/nginx/sites-enabled/default")
    run(ssh, "systemctl daemon-reload && systemctl enable --now smart-spoon")
    run(ssh, "nginx -t && systemctl restart nginx")

    print("[6/6] 健康检查 …")
    time.sleep(3)
    code, out, _ = run(ssh, "curl -s http://127.0.0.1/api/health")
    print(f"  本机检查: {out}")

    sftp.close()
    ssh.close()

    print()
    print("=" * 56)
    print(f"部署完成！网站地址:  http://{args.ip}/spoon")
    print("如果打不开，去腾讯云控制台 → 轻量服务器 → 防火墙，")
    print("确认已放行 80 端口（TCP）。")
    print("=" * 56)


if __name__ == "__main__":
    main()
