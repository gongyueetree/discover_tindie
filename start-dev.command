#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '请先安装 Node.js（包含 npm），然后重新运行此文件。'
  read -r -p '按回车退出…' _maker_exit
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo '请使用 Node.js 20 或以上版本。'
  read -r -p '按回车退出…' _maker_exit
  exit 1
fi
if [ ! -d node_modules ]; then
  echo '首次启动：正在安装依赖…'
  npm ci --no-audit --no-fund
fi
echo '看到 Ready 后，请在浏览器打开 http://localhost:3000'
echo '保持这个终端窗口开启；按 Ctrl+C 停止。'
npm run dev -- --hostname 127.0.0.1 --port 3000
