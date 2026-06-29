#!/bin/bash
# SessionStart hook: warm up node_modules in the background so workspace
# installs are ready without making the user wait at session start.
# Backgrounded + disowned + nohup'd so the hook returns immediately and the
# install survives the hook script's shell exiting.
cd "$(dirname "$0")/.." || exit 0

if [[ -f package.json ]] && command -v npm >/dev/null 2>&1; then
  nohup npm install --no-audit --no-fund \
    > /tmp/lcyt-session-start-npm-install.log 2>&1 < /dev/null &
  disown
fi

exit 0
