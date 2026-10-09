#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_CONFIG="$TASK_ROOT/docker/.env.collab-demo.local"
if [[ ! -f "$TASK_CONFIG" ]]; then
  umask 077
  node -e 'const fs=require("node:fs"),crypto=require("node:crypto");fs.writeFileSync(process.argv[1],"COLLAB_SECRET="+crypto.randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"})' "$TASK_CONFIG"
fi
docker compose --env-file "$TASK_CONFIG" -f "$TASK_ROOT/docker/docker-compose.collab-demo.yml" up --build -d
echo '本地试点：http://localhost:3110'
