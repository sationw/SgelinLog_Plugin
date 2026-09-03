@echo off
chcp 65001 >nul
rem 把 easyScholar 插件打包为 zip（供拖入软件安装）
cd /d "e:\Developer Platform\Reader_SgelinLog\Plug_in\easyscholar-journal"
powershell -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'manifest.json','main.js','使用说明.md' -DestinationPath '..\easyscholar-journal.zip' -Force"
echo 已生成 easyscholar-journal.zip
