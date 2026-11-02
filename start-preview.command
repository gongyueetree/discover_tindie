#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或以上版本（包含 npm）。'
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0]) < 20) { console.error("需要 Node.js 20 或以上版本"); process.exit(1); }'
if [ ! -d node_modules ]; then
  echo '首次启动：正在安装依赖…'
  npm ci --no-audit --no-fund
fi
if [ ! -f .next-build/BUILD_ID ]; then
  echo '正在构建正式预览版，这一步需要等待；完成后不会在点击页面时临时编译。'
  NODE_ENV=production npm run build
fi
echo '看到 Ready 后打开 http://localhost:3000；请先关闭占用该端口的旧服务。'
echo '修改代码后请先运行 npm run build 重新构建。'
NODE_ENV=production npm run start -- --hostname 127.0.0.1 --port 3000
