#!/bin/zsh
cd "${0:A:h}"
if curl --silent --fail --max-time 2 http://127.0.0.1:5173/ | /usr/bin/grep -q 'PLY · 场景漫游'; then
  print "本地场景已在运行，正在打开 http://127.0.0.1:5173/"
  open http://127.0.0.1:5173/
  exit 0
fi
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
print "本地地址：http://127.0.0.1:5173/"
print "请保持此窗口运行；关闭窗口会停止本地场景服务。"
"$scene_node" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort --open
scene_exit=$?
if (( scene_exit != 0 )); then
  print "启动失败。如果 5173 端口已被其他程序占用，请关闭该程序后重试。"
  read '?按回车退出'
fi
exit $scene_exit
