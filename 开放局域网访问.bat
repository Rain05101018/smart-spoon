@echo off
chcp 65001 >nul
REM 开放 Windows 防火墙 5000 端口，让同一 Wi-Fi 下的其他设备可以访问网站
REM 使用方法：右键此文件 → 以管理员身份运行

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请右键此文件，选择"以管理员身份运行"
    pause
    exit /b 1
)

netsh advfirewall firewall add rule name="SmartSpoon-5000" dir=in action=allow protocol=TCP localport=5000 >nul 2>&1
if %errorlevel% equ 0 (
    echo [成功] 防火墙已放行 5000 端口
    echo 同一 Wi-Fi 下的设备现在可以访问：
    ipconfig | findstr /C:"IPv4"
    echo.
    echo 告诉别人用浏览器打开： http://上面的IP:5000/spoon
) else (
    echo [提示] 规则可能已存在，或添加失败
)
pause
