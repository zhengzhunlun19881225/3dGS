#!/bin/zsh
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  scene_node=$(command -v node)
else
  scene_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$scene_node" || ! -f node_modules/vite/bin/vite.js ]]; then
  print "请先安装 Node.js 并在项目目录运行 npm install。"
  read '?按回车退出'
  exit 1
fi
"$scene_node" node_modules/vite/bin/vite.js --host 127.0.0.1
