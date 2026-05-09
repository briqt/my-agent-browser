#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${MY_AGENT_BROWSER_HOME:-$HOME/.my-agent-browser}"
CONFIG_FILE="$CONFIG_DIR/config.json"
STATE_FILE="$CONFIG_DIR/state.json"

# --- Config ---

cfg() {
  if [[ -f "$CONFIG_FILE" ]]; then
    python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d$(echo "$1"))" 2>/dev/null || echo "$2"
  else
    echo "$2"
  fi
}

get_port()         { cfg "['browser']['cdpPort']" "19333"; }
get_headless()     { cfg "['browser']['headless']" "true"; }
get_no_sandbox()   { cfg "['browser']['noSandbox']" "true"; }
get_user_data_dir(){ cfg "['browser']['userDataDir']" "$CONFIG_DIR/profiles/default/user-data"; }
get_proxy()        { cfg "['browser']['proxy']" ""; }
get_extra_args()   { python3 -c "import json; d=json.load(open('$CONFIG_FILE')); [print(a) for a in d.get('browser',{}).get('extraArgs',[])]" 2>/dev/null || true; }
get_executable()   { cfg "['browser']['executablePath']" ""; }

# --- Chrome discovery ---

find_chrome() {
  local custom
  custom="$(get_executable)"
  if [[ -n "$custom" && -x "$custom" ]]; then echo "$custom"; return; fi
  if [[ -n "${CHROME_PATH:-}" && -x "$CHROME_PATH" ]]; then echo "$CHROME_PATH"; return; fi
  for bin in google-chrome google-chrome-stable chromium-browser chromium microsoft-edge brave-browser; do
    if command -v "$bin" &>/dev/null; then echo "$bin"; return; fi
  done
  echo "" >&2; return 1
}

# --- CDP helpers ---

is_cdp_ready() {
  curl -s --max-time 2 "http://127.0.0.1:${1}/json/version" &>/dev/null
}

# --- Process helpers ---

is_pid_alive() { kill -0 "$1" 2>/dev/null; }

# --- Commands ---

cmd_start() {
  local port headless no_sandbox user_data_dir proxy
  port="$(get_port)"
  headless="$(get_headless)"
  no_sandbox="$(get_no_sandbox)"
  user_data_dir="$(get_user_data_dir)"
  proxy="$(get_proxy)"

  # Already running?
  if [[ -f "$STATE_FILE" ]]; then
    local pid
    pid="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['pid'])" 2>/dev/null || echo 0)"
    if is_pid_alive "$pid" && is_cdp_ready "$port"; then
      echo "{\"status\":\"already_running\",\"pid\":$pid,\"port\":$port}"
      return 0
    fi
    rm -f "$STATE_FILE"
  fi

  local chrome
  chrome="$(find_chrome)" || { echo '{"error":"Chrome not found. Install google-chrome or set browser.executablePath in config."}' >&2; exit 1; }

  mkdir -p "$user_data_dir"
  mkdir -p "$CONFIG_DIR"

  local args=(
    "$chrome"
    "--remote-debugging-port=$port"
    "--user-data-dir=$user_data_dir"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-sync"
    "--disable-background-networking"
    "--disable-component-update"
    "--disable-features=Translate,MediaRouter"
    "--disable-session-crashed-bubble"
    "--hide-crash-restore-bubble"
    "--password-store=basic"
  )

  [[ "$headless" == "true" ]] && args+=("--headless=new" "--disable-gpu")
  [[ "$no_sandbox" == "true" ]] && args+=("--no-sandbox" "--disable-setuid-sandbox")
  [[ "$(uname)" == "Linux" ]] && args+=("--disable-dev-shm-usage")
  [[ -n "$proxy" ]] && args+=("--proxy-server=$proxy")

  while IFS= read -r extra; do
    [[ -n "$extra" ]] && args+=("$extra")
  done < <(get_extra_args)

  "${args[@]}" &>/dev/null &
  local pid=$!

  local elapsed=0
  while ! is_cdp_ready "$port" && (( elapsed < 30 )); do
    sleep 0.5; elapsed=$((elapsed + 1))
    if ! is_pid_alive "$pid"; then
      echo '{"error":"Chrome exited unexpectedly"}' >&2; exit 1
    fi
  done

  if ! is_cdp_ready "$port"; then
    kill "$pid" 2>/dev/null
    echo '{"error":"Chrome CDP not ready after 15s"}' >&2; exit 1
  fi

  python3 -c "import json; json.dump({'pid':$pid,'port':$port,'userDataDir':'$user_data_dir'},open('$STATE_FILE','w'),indent=2)"
  echo "{\"status\":\"started\",\"pid\":$pid,\"port\":$port}"
}

cmd_stop() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{"status":"not_running"}'
    return 0
  fi
  local pid
  pid="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['pid'])" 2>/dev/null || echo 0)"
  if is_pid_alive "$pid"; then
    kill "$pid" 2>/dev/null
    sleep 1
    is_pid_alive "$pid" && kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$STATE_FILE"
  echo "{\"status\":\"stopped\",\"pid\":$pid}"
}

cmd_status() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{"running":false}'
    return 0
  fi
  local pid port
  pid="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['pid'])" 2>/dev/null || echo 0)"
  port="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['port'])" 2>/dev/null || echo 0)"
  if ! is_pid_alive "$pid"; then
    rm -f "$STATE_FILE"
    echo '{"running":false}'
    return 0
  fi
  local browser=""
  if is_cdp_ready "$port"; then
    browser="$(curl -s "http://127.0.0.1:$port/json/version" | python3 -c "import json,sys; print(json.load(sys.stdin).get('Browser',''))" 2>/dev/null || echo "")"
  fi
  echo "{\"running\":true,\"pid\":$pid,\"port\":$port,\"browser\":\"$browser\"}"
}

cmd_ensure() {
  # Ensure Chrome is running, start if not. Used by start-mcp.sh.
  if [[ -f "$STATE_FILE" ]]; then
    local pid port
    pid="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['pid'])" 2>/dev/null || echo 0)"
    port="$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['port'])" 2>/dev/null || echo 0)"
    if is_pid_alive "$pid" && is_cdp_ready "$port"; then
      echo "$port"
      return 0
    fi
    rm -f "$STATE_FILE"
  fi
  cmd_start >/dev/null
  python3 -c "import json; print(json.load(open('$STATE_FILE'))['port'])"
}

cmd_help() {
  cat <<'EOF'
my-agent-browser — Chrome lifecycle manager

Commands:
  start     Launch Chrome with CDP debugging
  stop      Stop Chrome
  status    Check if Chrome is running
  ensure    Start if needed, print CDP port (used by start-mcp.sh)

Config: ~/.my-agent-browser/config.json
EOF
}

# --- Dispatch ---
case "${1:-help}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  ensure) cmd_ensure ;;
  *)      cmd_help ;;
esac
