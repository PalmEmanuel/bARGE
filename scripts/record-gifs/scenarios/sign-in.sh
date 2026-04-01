#!/usr/bin/env bash
# sign-in.sh — Record the Sign In scenario:
# Opens VS Code, opens the command palette and runs the bARGE: Sign In command.
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
    --no-sandbox \
    --disable-telemetry \
    "${FIXTURE_WORKSPACE}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

wait_for_vscode_window

# Open the command palette and run the sign-in command
xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+shift+p
sleep 1
xdotool type --clearmodifiers --delay 50 "bARGE: Sign In"
sleep 0.5
xdotool key Return
sleep 4

# Let the sign-in picker animation settle
sleep 2

close_vscode
