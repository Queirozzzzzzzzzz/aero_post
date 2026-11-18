#!/usr/bin/env bash
# Usage (on the VM, as root): bash setup.sh git@github.com:USER/REPO.git
set -euo pipefail
REPO="${1:-}"; DIR=/projects/aero_post; KEY=~/.ssh/id_ed25519_aeropost
[ -n "$REPO" ] || { echo "Usage: bash setup.sh git@github.com:USER/REPO.git"; exit 1; }
cd "$DIR" 2>/dev/null || { echo "ERROR: $DIR not found. mkdir $DIR and copy the files there first."; exit 1; }
for f in server.js index.html Dockerfile docker-compose.yml patch-docker.js; do [ -f "$f" ] || { echo "ERROR: $f missing in $DIR"; exit 1; }; done
command -v docker >/dev/null || { echo "ERROR: docker not installed"; exit 1; }
node -v >/dev/null 2>&1 && node patch-docker.js || docker run --rm -v "$DIR":/w -w /w node:22-alpine node patch-docker.js
mkdir -p data && chown 1000:1000 data
# --- GitHub: dedicated deploy key (separate from /analyzer_bot's) ---
mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f "$KEY" ] || { ssh-keygen -t ed25519 -N "" -C "aeropost@$(hostname)" -f "$KEY" >/dev/null; echo "created $KEY"; }
grep -q "Host github-aeropost" ~/.ssh/config 2>/dev/null || printf '\nHost github-aeropost\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> ~/.ssh/config
chmod 600 ~/.ssh/config
URL="${REPO/github.com/github-aeropost}"
[ -d .git ] || git init -q -b main
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$URL" || git remote add origin "$URL"
git add -A && { git diff --cached --quiet || git commit -q -m "aero_post: initial commit with Docker"; }
echo; echo "== Add this public key in GitHub repo > Settings > Deploy keys (check 'Allow write access') =="; cat "$KEY.pub"
read -rp "Press Enter after adding the key to push... " _
git push -u origin main
docker compose up -d --build
echo "aero_post: http://10.1.10.2:5757"
