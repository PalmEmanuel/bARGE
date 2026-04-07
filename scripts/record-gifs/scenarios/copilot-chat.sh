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
# Write the GitHub session and auxiliary bar layout into state.vscdb now, after
# install_extension has initialised the user data dir.
export KEYRING_PASSWORD="barge-gif-key"
python3 "${SCRIPT_DIR}/setup-copilot-auth.py"

# ── VS Code settings ──────────────────────────────────────────────────────────
add_setting "barge.autoAuthenticate" "true"
add_setting "breadcrumbs.enabled" "false"

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

close_vscode
