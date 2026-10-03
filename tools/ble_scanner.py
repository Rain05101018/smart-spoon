# -*- coding: utf-8 -*-
"""
ble_scanner.py — 智味勺 BLE 协议侦察工具

勺子有硬件但没有协议文档，本工具用来摸清它的蓝牙协议：
  1. scan    扫描附近 BLE 设备（名称 / MAC / 信号强度 / 广播数据）
  2. explore 连接指定设备，枚举所有 GATT 服务、特征值及属性（read/write/notify）
  3. sniff   订阅所有可通知特征值，抓取原始数据并生成协议报告

用法（在 smart-spoon 目录下）：
  .venv/Scripts/python tools/ble_scanner.py scan
  .venv/Scripts/python tools/ble_scanner.py explore --addr AA:BB:CC:DD:EE:FF
  .venv/Scripts/python tools/ble_scanner.py sniff --addr AA:BB:CC:DD:EE:FF --seconds 60

Windows 注意：--addr 用设备 MAC 地址（scan 结果里会列出）。
"""

import argparse
import asyncio
import datetime
import json
import sys
from pathlib import Path

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

REPORT_DIR = Path(__file__).resolve().parent.parent / "docs" / "protocol"


def fix_console():
    """Windows 控制台默认 GBK，强制 UTF-8 避免中文乱码。"""
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------- scan
async def cmd_scan(args):
    print(f"扫描中（{args.seconds} 秒）… 请保持勺子开机并处于可被发现状态\n")
    devices = await BleakScanner.discover(timeout=args.seconds, return_adv=True)

    if not devices:
        print("没有发现任何 BLE 设备。请确认：1) 电脑蓝牙已打开 2) 勺子已开机")
        return

    rows = []
    for addr, (device, adv) in sorted(
        devices.items(), key=lambda kv: kv[1][1].rssi, reverse=True
    ):
        name = device.name or adv.local_name or "(未命名)"
        uuids = ",".join(adv.service_uuids) if adv.service_uuids else "-"
        rows.append((name, addr, adv.rssi, uuids))

    print(f"{'名称':<24} {'MAC 地址':<20} {'RSSI':>5}  广播服务 UUID")
    print("-" * 80)
    for name, addr, rssi, uuids in rows:
        print(f"{name:<24} {addr:<20} {rssi:>5}  {uuids}")

    print("\n提示：找不到勺子时可尝试用名称关键字过滤：")
    print("  python tools/ble_scanner.py scan --name spoon")


# ---------------------------------------------------------------- explore
def describe_char(char):
    props = ",".join(char.properties)
    return {
        "uuid": char.uuid,
        "handle": char.handle,
        "properties": props,
        "descriptors": [d.uuid for d in char.descriptors],
    }


async def cmd_explore(args):
    print(f"正在连接 {args.addr} …")
    try:
        async with BleakClient(args.addr, timeout=args.timeout) as client:
            print(f"已连接（MTU={client.mtu_size}），正在枚举 GATT 服务…\n")
            report = {"address": args.addr, "services": []}

            for service in client.services:
                print(f"[Service] {service.uuid}  ({service.description})")
                svc = {"uuid": service.uuid, "description": service.description,
                       "characteristics": []}
                for char in service.characteristics:
                    info = describe_char(char)
                    svc["characteristics"].append(info)
                    print(f"    [Char] {char.uuid}  handle={char.handle}  props={info['properties']}")

                    # 可读特征值顺手读一把，帮助判断数据格式
                    if "read" in char.properties:
                        try:
                            value = await client.read_gatt_char(char.uuid)
                            text = try_decode(value)
                            print(f"           读取值: {value.hex(' ')}  {text}")
                            info["sample_value_hex"] = value.hex(" ")
                            info["sample_value_text"] = text
                        except BleakError as exc:
                            print(f"           读取失败: {exc}")
                report["services"].append(svc)
                print()

            save_report(report, suffix="explore")
    except BleakError as exc:
        print(f"连接失败：{exc}")
        print("提示：Windows 上若设备已被系统蓝牙配对占用，可先在系统设置里取消配对再试。")


def try_decode(raw: bytes) -> str:
    """尝试把原始字节解释成可读文本，方便识别协议。"""
    try:
        text = raw.decode("utf-8").strip("\x00").strip()
        if text and all(c.isprintable() or c in "\r\n\t" for c in text):
            return f"-> \"{text}\""
    except UnicodeDecodeError:
        pass
    return ""


# ---------------------------------------------------------------- sniff
def make_notify_handler(store: dict, char_uuid: str):
    def handler(_sender, data: bytearray):
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        hex_str = bytes(data).hex(" ")
        store[char_uuid].append({"time": ts, "hex": hex_str})
        print(f"[{ts}] {char_uuid}: {hex_str}  {try_decode(bytes(data))}")
    return handler


async def cmd_sniff(args):
    store = {}
    print(f"正在连接 {args.addr} …")
    async with BleakClient(args.addr, timeout=args.timeout) as client:
        print("已连接，正在订阅所有可通知 / 可指示的特征值…\n")

        subscribed = []
        for service in client.services:
            for char in service.characteristics:
                if "notify" in char.properties or "indicate" in char.properties:
                    store[char.uuid] = []
                    try:
                        await client.start_notify(char.uuid, make_notify_handler(store, char.uuid))
                        subscribed.append(char.uuid)
                        print(f"  已订阅 {char.uuid}")
                    except BleakError as exc:
                        print(f"  订阅失败 {char.uuid}: {exc}")

        if not subscribed:
            print("\n这个设备没有任何 notify/indicate 特征值，")
            print("它可能通过 read 轮询或 write 交互。先跑 explore 看属性。")
            return

        print(f"\n开始抓包 {args.seconds} 秒。现在请正常操作勺子（按键、舀取等动作都做一遍），")
        print("观察哪个 UUID 在什么动作下有数据，这就是协议逆向的关键线索。\n")
        await asyncio.sleep(args.seconds)

        for uuid in subscribed:
            try:
                await client.stop_notify(uuid)
            except BleakError:
                pass

    report = {
        "address": args.addr,
        "duration_seconds": args.seconds,
        "captured": store,
    }
    save_report(report, suffix="sniff")
    summarize(store)


def summarize(store: dict):
    print("\n===== 抓包汇总 =====")
    for uuid, packets in store.items():
        print(f"{uuid}: 收到 {len(packets)} 包")
        if packets:
            lengths = {len(p["hex"].split()) for p in packets}
            print(f"  包长分布(字节): {sorted(lengths)}")
            print(f"  首包: {packets[0]['hex']}")
            print(f"  尾包: {packets[-1]['hex']}")
    print("\n下一步：对照 docs/protocol/ 下的报告，把确认的 UUID 和解析规则")
    print("填入 App 的 lib/ble/spoon_protocol.dart。")


def save_report(report: dict, suffix: str):
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = REPORT_DIR / f"{stamp}-{suffix}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已保存: {path}")


# ---------------------------------------------------------------- main
def main():
    fix_console()
    parser = argparse.ArgumentParser(description="智味勺 BLE 协议侦察工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="扫描附近 BLE 设备")
    p_scan.add_argument("--seconds", type=int, default=8, help="扫描时长（秒）")
    p_scan.add_argument("--name", default=None, help="按名称关键字过滤（不区分大小写）")

    p_explore = sub.add_parser("explore", help="连接设备并枚举 GATT 服务")
    p_explore.add_argument("--addr", required=True, help="设备 MAC 地址")
    p_explore.add_argument("--timeout", type=float, default=15.0)

    p_sniff = sub.add_parser("sniff", help="订阅通知特征值并抓取原始数据")
    p_sniff.add_argument("--addr", required=True, help="设备 MAC 地址")
    p_sniff.add_argument("--seconds", type=int, default=60, help="抓包时长（秒）")
    p_sniff.add_argument("--timeout", type=float, default=15.0)

    args = parser.parse_args()

    if args.command == "scan" and args.name:
        # scan 模式加名称过滤
        async def scan_filtered():
            print(f"扫描中（{args.seconds} 秒），只显示名称含 \"{args.name}\" 的设备…\n")
            devices = await BleakScanner.discover(timeout=args.seconds, return_adv=True)
            found = False
            for addr, (device, adv) in devices.items():
                name = device.name or adv.local_name or ""
                if args.name.lower() in name.lower():
                    found = True
                    print(f"{name}  {addr}  RSSI={adv.rssi}  UUIDs={adv.service_uuids}")
            if not found:
                print("没有匹配的设备。")
        asyncio.run(scan_filtered())
    elif args.command == "scan":
        asyncio.run(cmd_scan(args))
    elif args.command == "explore":
        asyncio.run(cmd_explore(args))
    elif args.command == "sniff":
        asyncio.run(cmd_sniff(args))


if __name__ == "__main__":
    main()
