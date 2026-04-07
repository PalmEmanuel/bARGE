#!/usr/bin/env bash
# copilot-chat.sh — Record Copilot Chat using bARGE MCP tools scenario.
#
# Shows:
#  1. Copilot Chat open in the right sidebar
#  2. User prompts Copilot to query keyvaults via bARGE, filter to Sweden,
#     and select the first two rows
#  3. Copilot runs bARGE LM tools automatically (run_query, filter_table, select_rows)
#  4. bARGE results panel updates live as tools execute
#
# Sourced by record.sh after start_recording. All record.sh helpers are available.
#
# Requires GH_COPILOT_CHAT env var (set via workflow secret) and gnome-keyring running.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
mkdir -p "${FIXTURE_WORKSPACE}"

# ── Auth and layout prep ──────────────────────────────────────────────────────
# Write the GitHub session into state.vscdb now, after install_extension has
# initialised the user data dir.
python3 "${SCRIPT_DIR}/setup-copilot-auth.py"

# ── VS Code settings ──────────────────────────────────────────────────────────
add_setting "barge.autoAuthenticate" "true"
add_setting "breadcrumbs.enabled" "false"
# sideBar on left → primary sidebar (Explorer) on left, auxiliary bar (Chat) on right
add_setting "workbench.sideBar.location" '"left"'

# Tell wait_for_vscode_window to open Copilot Chat (ctrl+alt+i) instead of
# closing the secondary sidebar, so Chat is already visible at the trim point.
KEEP_SECONDARY_SIDEBAR=1

# ── Launch VS Code ────────────────────────────────────────────────────────────
code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu --use-gl=swiftshader --no-sandbox --disable-telemetry \
    "${FIXTURE_WORKSPACE}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

wait_for_vscode_window

# Debug: capture initial Chat panel state to verify Copilot auth status
mkdir -p /tmp/barge-debug
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null \
    | convert xwd:- /tmp/barge-debug/copilot-chat-initial.png 2>/dev/null || true

# ── Copilot Chat input ────────────────────────────────────────────────────────
# Auxiliary bar (right side, 500px wide): x=1420–1920, center x≈1670.
# Chat input sits ~40px above the bottom of the content area.
# These coordinates assume no prior chat history (empty chat state).
# Tune CHAT_INPUT_X / CHAT_INPUT_Y after the first CI run if needed.
CHAT_INPUT_X=1670
CHAT_INPUT_Y=1038

PROMPT="Get all keyvaults using bARGE, filter the table to only show the ones in Sweden, select the first two rows."

# Move mouse to the chat input and click to focus it
xdotool mousemove ${CHAT_INPUT_X} ${CHAT_INPUT_Y}
sleep 0.3
click_and_verify ${CHAT_INPUT_X} ${CHAT_INPUT_Y} "0.003" "1920x200+1419+900" || {
    echo "Warning: chat input click not verified, continuing anyway" >&2
}

sleep 0.3

# Type the prompt naturally
natural_type "${PROMPT}"
sleep 0.5

# Submit
xdotool key --clearmodifiers Return

# Wait for Copilot to run the bARGE tools and stream a response.
# The tool calls (run_query → filter_table → select_rows) take ~20–30s in total.
sleep 35

# Save a debug screenshot so we can verify auth and response content
mkdir -p /tmp/barge-debug
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null \
    | convert xwd:- /tmp/barge-debug/copilot-chat-response.png 2>/dev/null || true

# Capture VS Code extension host logs for auth debugging
if [[ -d "${VSCODE_USER_DATA_DIR}/logs" ]]; then
    cp -r "${VSCODE_USER_DATA_DIR}/logs" /tmp/barge-debug/vscode-logs 2>/dev/null || true
fi

# Dump state.vscdb structure so we can verify what VS Code actually stores
mkdir -p /tmp/barge-debug
GLOBAL_DB="${VSCODE_USER_DATA_DIR}/User/globalStorage/state.vscdb"
echo "VSCODE_USER_DATA_DIR=${VSCODE_USER_DATA_DIR}" > /tmp/barge-debug/state-vscdb-dump.txt
echo "Global state.vscdb: ${GLOBAL_DB}" >> /tmp/barge-debug/state-vscdb-dump.txt
ls -la "${GLOBAL_DB}" >> /tmp/barge-debug/state-vscdb-dump.txt 2>&1
python3 - "${GLOBAL_DB}" >> /tmp/barge-debug/state-vscdb-dump.txt 2>&1 <<'PYEOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)
for table in tables:
    print(f"\n--- {table} ---")
    for row in db.execute(f"SELECT key, value FROM {table}").fetchall():
        key, val = row[0], row[1]
        if any(w in key.lower() for w in ["github", "secret", "auth", "copilot"]):
            print(f"  MATCH key: {key[:120]}")
            print(f"  MATCH val: {str(val)[:120]}")
        else:
            print(f"  {key[:80]}")
db.close()
PYEOF

close_vscode
