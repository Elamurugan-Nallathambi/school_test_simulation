#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  EOG Practice Portal (us-bme-test) — dev & deploy helper
#  Cloudflare Worker + Static Assets + D1, deployed via `cfl` (acct: rugan)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="us-bme-test"
DB_NAME="us-bme-test-db"
ACC="rugan"
PORT=8787
PIDFILE="/tmp/${PROJECT}-dev.pid"
LOGFILE="/tmp/${PROJECT}-dev.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; RESET='\033[0m'
log()  { echo -e "${BLUE}[setup]${RESET} $*"; }
ok()   { echo -e "${GREEN}[ ok ]${RESET} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $*"; }
err()  { echo -e "${RED}[err ]${RESET} $*" >&2; }

# wrangler: prefer `cfl` (handles the rugan account), else npx wrangler
WRANGLER="npx wrangler"
have_cfl=0
if command -v cfl >/dev/null 2>&1; then have_cfl=1; fi
cfl_run() { if [ "$have_cfl" = 1 ]; then cfl "$@" --acc "$ACC"; else $WRANGLER "$@"; fi; }

check_prereqs() {
  command -v node >/dev/null || { err "node not found"; exit 1; }
  command -v npm  >/dev/null || { err "npm not found"; exit 1; }
  ok "node $(node -v), npm $(npm -v)"
  [ "$have_cfl" = 1 ] && ok "cfl found (account: $ACC)" || warn "cfl not found — using 'npx wrangler' (run 'wrangler login' first)"
}

check_port() { lsof -ti tcp:"$PORT" >/dev/null 2>&1; }
kill_port()  { lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true; }

install_deps() {
  if [ ! -d node_modules ]; then log "Installing dependencies…"; npm install; ok "deps installed"; else ok "deps present"; fi
}

db_create() {
  log "Ensuring D1 database '$DB_NAME' exists…"
  if cfl_run d1 list 2>/dev/null | grep -q "$DB_NAME"; then
    ok "D1 '$DB_NAME' already exists"
  else
    log "Creating D1 '$DB_NAME'…"
    cfl_run d1 create "$DB_NAME" || true
    warn "Copy the printed database_id into wrangler.toml (database_id = ...)"
  fi
}
db_push() {   # $1 = --local | --remote
  local mode="${1:---local}"
  log "Applying schema ($mode)…"
  cfl_run d1 execute "$DB_NAME" "$mode" --file schema.sql -y
  ok "schema applied ($mode)"
}
db_seed() {   # $1 = --local | --remote
  local mode="${1:---local}"
  log "Building seed.sql from data/tests/*.json…"
  node scripts/seed.mjs >/dev/null
  log "Seeding curated tests ($mode)…"
  cfl_run d1 execute "$DB_NAME" "$mode" --file scripts/seed.sql -y
  ok "curated tests seeded ($mode)"
}
db_shell() { cfl_run d1 execute "$DB_NAME" --remote --command "${1:-SELECT id, subject, test_type, question_count FROM tests ORDER BY id;}"; }

start_dev() {
  install_deps
  if check_port; then warn "port $PORT busy — freeing it"; kill_port; sleep 1; fi
  db_push --local || warn "local schema push failed (continuing)"
  db_seed --local || warn "local seed failed (continuing)"
  log "Starting wrangler dev on http://localhost:$PORT …"
  nohup $WRANGLER dev --port "$PORT" --local >"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 3
  ok "dev started (pid $(cat "$PIDFILE")) — logs: $LOGFILE"
  log "Open: http://localhost:$PORT"
}
stop_dev() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true; ok "stopped dev (pid $(cat "$PIDFILE"))"
  else warn "no tracked dev process"; fi
  kill_port; rm -f "$PIDFILE"
}
status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then ok "dev running (pid $(cat "$PIDFILE")) on :$PORT"; else warn "dev not running"; fi
  check_port && log "port $PORT is in use" || log "port $PORT is free"
}

cmd="${1:-help}"
case "$cmd" in
  setup)
    check_prereqs; install_deps; db_create
    log "Validating curated tests…"; node scripts/validate.mjs
    db_push --local || true; db_seed --local || true
    start_dev ;;
  start)        check_prereqs; start_dev ;;
  stop)         stop_dev ;;
  restart)      stop_dev; sleep 1; start_dev ;;
  status)       status ;;
  logs)         tail -n "${2:-80}" -f "$LOGFILE" ;;
  test|validate) node scripts/validate.mjs ;;
  build)        node scripts/validate.mjs; node scripts/seed.mjs ;;
  db:create)    db_create ;;
  db:push)      db_push "${2:---remote}" ;;
  db:seed)      db_seed "${2:---remote}" ;;
  db:shell)     db_shell "${2:-}" ;;
  deploy|deploy:qa)
    check_prereqs
    node scripts/validate.mjs
    db_push --remote
    db_seed --remote
    log "Deploying '$PROJECT' to Cloudflare (account: $ACC)…"
    cfl_run deploy
    ok "deployed" ;;
  help|*)
    cat <<EOF
EOG Practice Portal — setup.sh

  ./setup.sh setup        First-time: deps, D1, validate, seed local, start dev
  ./setup.sh start        Start local dev (wrangler dev on :$PORT)
  ./setup.sh stop         Stop local dev
  ./setup.sh restart      Restart local dev
  ./setup.sh status       Show dev status
  ./setup.sh logs [n]     Tail dev logs
  ./setup.sh test         Validate all curated tests
  ./setup.sh build        Validate + (re)build seed.sql
  ./setup.sh db:create    Create the D1 database
  ./setup.sh db:push [--local|--remote]   Apply schema (default --remote)
  ./setup.sh db:seed [--local|--remote]   Seed curated tests (default --remote)
  ./setup.sh db:shell ["SQL"]             Run SQL on remote D1
  ./setup.sh deploy       Validate, push+seed remote D1, deploy worker
EOF
    ;;
esac
