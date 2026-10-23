#!/bin/sh
# Runs inside the node container started by scripts/prisma.ps1.
# /work/prisma is the host's backend/prisma folder; the Prisma CLI is cached in the /cli volume.
set -e

if [ ! -x /cli/node_modules/.bin/prisma ]; then
  echo "Installing Prisma CLI 7.10.1 into the cache volume..."
  apt-get -qq update >/dev/null && apt-get -qq install -y openssl >/dev/null
  cd /cli
  npm init -y >/dev/null
  npm install --silent --no-audit --no-fund prisma@7.10.1
fi

cd /work
cat > prisma.config.mjs <<'EOF'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
EOF
export NODE_PATH=/cli/node_modules
ln -sfn /cli/node_modules /work/node_modules
exec /cli/node_modules/.bin/prisma "$@"
