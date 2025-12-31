#!/bin/bash
# 获取当前脚本所在目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_NAME=$(grep '"productName":' "$DIR/../src-tauri/tauri.conf.json" | head -n 1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')

echo "------------------------------------------------"
echo "正在修复 ${APP_NAME} '应用已损坏 / 无法验证开发者' 问题..."
echo "------------------------------------------------"
echo "系统可能要求您输入开机密码以执行此操作（输入时屏幕不显示）"

# 尝试对当前目录下的应用（如果在 DMG 里运行）或标准名称应用执行修复
if [ -d "$DIR/${APP_NAME}.app" ]; then
    sudo xattr -rd com.apple.quarantine "$DIR/${APP_NAME}.app"
    echo "✅ 修复成功！请重新尝试打开应用。"
else
    echo "❌ 错误：在当前目录下未找到 ${APP_NAME}.app"
fi

echo "------------------------------------------------"
echo "按任意键退出..."
read -n 1
