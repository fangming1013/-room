@echo off
chcp 65001 >nul
echo ============================================
echo  装修小程序 - 生图后端 本地运行
echo ============================================
echo.
set /p KEY=粘贴你的 SiliconFlow API Key (sk-xxx 开头，粘贴时无显示属正常): 
if "%KEY%"=="" (
  echo [错误] 未输入 Key，已退出
  pause
  exit /b
)
set SILICONFLOW_API_KEY=%KEY%
cd /d "%~dp0"
echo.
echo 正在启动后端，监听 http://localhost:3000
echo 保持此窗口打开；关闭窗口即停止服务
echo ============================================
"C:\Users\HUAWEI\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" img-proxy.js
pause
