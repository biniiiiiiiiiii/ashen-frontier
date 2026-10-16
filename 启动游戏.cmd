@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo 请先安装 Node.js 20.19 或更高版本，再重新打开游戏。
    pause
    exit /b 1
)
if not exist node_modules (
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)
call npm run dev -- --open
pause
