@echo off
chcp 65001 >nul
echo ============================================
echo  装修小程序 - 后端推送到 GitHub
echo ============================================
echo.
set /p REPO=粘贴 GitHub 仓库地址 (https://github.com/用户名/room-mini-img-proxy.git): 
set /p USER=GitHub 用户名: 
set /p PAT=粘贴 Personal Access Token (ghp_xxx 开头): 
echo.
cd /d "%~dp0"
git add -A
git commit -m "deploy backend" >nul 2>&1 || echo (无新改动，跳过提交)
for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
set REPO_N=%REPO:https://=%
set PUSHURL=https://%USER%:%PAT%@%REPO_N%
echo.
echo 正在推送到分支 %BRANCH% ...
git push %PUSHURL% %BRANCH% --force
echo.
echo 完成。去 Render 连这个仓库部署。
pause
