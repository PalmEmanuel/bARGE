#!/usr/bin/env bash
# sign-in.sh — Record the Sign In scenario:
# Shows the bARGE status bar, opens the account selector, and picks an account.
#
# This script is sourced by record.sh, which sets up DISPLAY and installs the
# extension beforehand. Variables from record.sh are available here.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
mkdir -p "${FIXTURE_WORKSPACE}"

# Open VS Code with bARGE extension installed
code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --disable-telemetry \
    "${FIXTURE_WORKSPACE}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

# Allow VS Code to load
sleep 5

# Click the bARGE status bar item to open the account picker
# The status bar is at the bottom of the window; use xdotool to find and click it
xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+shift+p
sleep 1
xdotool type --clearmodifiers --delay 50 "bARGE: Sign In"
sleep 0.5
xdotool key Return
sleep 4

# Let the sign-in picker animation settle
sleep 2

kill "${VSCODE_PID}" 2>/dev/null || true
wait "${VSCODE_PID}" 2>/dev/null || true
