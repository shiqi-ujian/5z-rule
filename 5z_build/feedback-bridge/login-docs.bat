@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo 打开腾讯文档登录页（使用读取桥专用 profile，登录态会保存）。
echo 请用 QQ 扫码/登录 docs.qq.com，完成后关闭浏览器窗口即可。
node 5z_build\feedback-bridge\collect-docs.mjs --login
if "%WZ_NO_PAUSE%"=="" pause >nul
