#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -x "$HOME/.local/node/bin/node" ]; then
  PATH="$HOME/.local/node/bin:$PATH"
fi
if [ -d /opt/homebrew/bin ]; then
  PATH="/opt/homebrew/bin:$PATH"
fi
PATH="/usr/local/bin:$PATH"
export PATH
exec npm run dev
