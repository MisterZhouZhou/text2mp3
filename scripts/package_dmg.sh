#!/bin/bash

# 自动从配置文件获取产品名称和版本
APP_NAME=$(grep '"productName":' src-tauri/tauri.conf.json | head -n 1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
VERSION=$(grep '"version":' package.json | head -n 1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
DMG_NAME="${APP_NAME}_${VERSION}_macOS.dmg"
SRC_APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DIST_DIR="dist_dmg"

echo "📦 开始打包 DMG (带修复脚本)..."
echo "应用名称: $APP_NAME"
echo "应用版本: $VERSION"

# 1. 检查构建是否存在
if [ ! -d "$SRC_APP_PATH" ]; then
    echo "❌ 错误: 未找到构建好的 App -> $SRC_APP_PATH"
    echo "请确认是否已执行: npm run tauri build"
    exit 1
fi

# 2. 准备临时目录
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 3. 复制文件
echo "正在准备安装包内容..."
cp -R "$SRC_APP_PATH" "$DIST_DIR/"

# 复制修复脚本
FIX_SCRIPT="scripts/Fix_Damaged.command"
if [ -f "$FIX_SCRIPT" ]; then
    cp "$FIX_SCRIPT" "$DIST_DIR/"
    chmod +x "$DIST_DIR/Fix_Damaged.command"
    echo "已包含修复脚本"
fi

# 4. 创建 /Applications 软连接
ln -s /Applications "$DIST_DIR/Applications"

# 5. 打包 DMG
echo "正在创建 DMG 镜像..."
rm -f "$DMG_NAME"
hdiutil create -volname "${APP_NAME} Installer" -srcfolder "$DIST_DIR" -ov -format UDZO "$DMG_NAME"

# 6. 清理
rm -rf "$DIST_DIR"

echo "------------------------------------------------"
echo "✅ 全部完成!"
echo "安装包位置: $PWD/$DMG_NAME"
echo "------------------------------------------------"
