#!/usr/bin/env bash
# Repo snapshot — tree, entry points, and run hints.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

echo "══════════════════════════════════════════════════════════════"
echo "  REPO SNAPSHOT"
echo "══════════════════════════════════════════════════════════════"
echo ""

# Git context
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "── Git ──"
  echo "Branch:  $(git branch --show-current 2>/dev/null || echo 'unknown')"
  echo "Commit:  $(git log -1 --oneline 2>/dev/null || echo 'unknown')"
  echo "Remote:  $(git remote get-url origin 2>/dev/null || echo 'none')"
  echo ""
fi

# Top-level manifest
echo "── Root files ──"
ls -1a | grep -v '^\.$' | grep -v '^\.\.$' | head -40
echo ""

# File tree (compact)
echo "── Source tree (max depth 4) ──"
if command -v tree >/dev/null 2>&1; then
  tree -L 4 -I '.git|node_modules|dist|build|coverage|.next' --dirsfirst 2>/dev/null || true
else
  find . -maxdepth 4 \
    \( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './build' \) -prune \
    -o -type f -print 2>/dev/null | sort | head -80
fi
echo ""

# package.json scripts
if [[ -f package.json ]]; then
  echo "── npm scripts (package.json) ──"
  node -e "
    const p = require('./package.json');
    console.log('name:', p.name || '(unnamed)');
    console.log('version:', p.version || 'n/a');
    console.log('main:', p.main || 'n/a');
    console.log('engines:', JSON.stringify(p.engines || {}));
    console.log('');
    if (p.scripts) {
      for (const [k, v] of Object.entries(p.scripts)) {
        console.log('  npm run ' + k.padEnd(12) + ' → ' + v);
      }
    }
  " 2>/dev/null || cat package.json
  echo ""
fi

# Docker / cloud config
echo "── Deploy / container config ──"
for f in Dockerfile docker-compose.yml docker-compose.yaml render.yaml Procfile .cursor/environment.json; do
  [[ -f "$f" ]] && echo "  ✓ $f" || true
done
echo ""

# Entry points
echo "── Likely entry points ──"
for f in src/index.js src/server.js src/main.js index.js app.js server.js; do
  [[ -f "$f" ]] && echo "  • $f"
done
echo ""

# README excerpt
if [[ -f README.md ]]; then
  echo "── README (first 35 lines) ──"
  head -35 README.md
  echo ""
fi

# Run hints (LuckCoin-aware but generic)
echo "── Quick run hints ──"
if [[ -f package.json ]]; then
  node -e "
    const p = require('./package.json');
    const s = p.scripts || {};
    if (s.start) console.log('CLI/app:     npm start');
    if (s.server) console.log('Web server:  npm run server');
    if (s.demo) console.log('Demo:        npm run demo');
    if (s.test) console.log('Tests:       npm test');
  " 2>/dev/null
fi
[[ -f docker-compose.yml || -f docker-compose.yaml ]] && echo "Docker:      docker compose up --build"
[[ -f Dockerfile && ! -f docker-compose.yml ]] && echo "Docker:      docker build -t app . && docker run -p 3000:3000 app"
[[ -f render.yaml ]] && echo "Render:      deploy via render.yaml Blueprint"
echo ""
echo "══════════════════════════════════════════════════════════════"
