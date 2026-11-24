#!/bin/zsh
# 一键更新：打包 → 退出旧版 → 旧版进废纸篓 → 覆盖到 /Applications → 打开。
# 只动自建产出的 .app，不碰用户数据（~/Library/Application Support）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 根目录换了 app.png 就先重生成图标，没换就跳过，免得每次打包都脏一堆二进制。
if [ -f app.png ] && [ app.png -nt src-tauri/icons/icon.icns ]; then
  echo "==> 从 app.png 重新生成图标"
  pnpm tauri icon app.png
  # 只用 macOS，android/ios 那一堆别跟着进仓库。
  rm -rf src-tauri/icons/android src-tauri/icons/ios
fi

echo "==> 打包（桌面 + 手机网页版）"
pnpm tauri build --bundles app

APP="$ROOT/src-tauri/target/release/bundle/macos/self-notion.app"
DEST="/Applications/self-notion.app"
[ -d "$APP" ] || { echo "没找到打包产物：$APP"; exit 1; }

echo "==> 退出正在运行的 self-notion"
osascript -e 'tell application "self-notion" to quit' >/dev/null 2>&1 || true
for _ in {1..12}; do pgrep -x self-notion >/dev/null 2>&1 || break; sleep 0.25; done
pkill -x self-notion >/dev/null 2>&1 || true
sleep 0.5

if [ -d "$DEST" ]; then
  OLD="$HOME/.Trash/self-notion-$(date +%Y%m%d-%H%M%S).app"
  echo "==> 旧版移到废纸篓：$OLD"
  mv "$DEST" "$OLD"
fi

echo "==> 安装新版本"
ditto "$APP" "$DEST"
xattr -dr com.apple.quarantine "$DEST" >/dev/null 2>&1 || true

echo "==> 打开"
open "$DEST"
echo "完成。手机上的网页版不用重装，从后台划掉再打开就会自动更新。"
