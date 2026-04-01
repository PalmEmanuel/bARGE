#!/usr/bin/env bash
# sign-in.sh — Record the Sign In scenario.
#
# Shows a user clicking the bARGE status bar item, browsing the authentication
# picker, and selecting DefaultAzureCredential.
#
# Sourced by record.sh after start_recording. All record.sh helpers are available.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
mkdir -p "${FIXTURE_WORKSPACE}"

code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --use-gl=swiftshader \
    --no-sandbox \
    --disable-telemetry \
    "${FIXTURE_WORKSPACE}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

# Waits for the window, sets up layout, and pauses 0.5s before actions start.
wait_for_vscode_window

# --- Scenario actions ---

# Click the bARGE status bar item. Scans right-to-left to find it; fails fast
# if no click causes a screen change (quick pick did not open).
click_status_bar || { echo "Error: bARGE status bar item not found" >&2; close_vscode; exit 1; }

sleep 1

# VS Code quick pick (showQuickPick) at 1920x1080 — approximate item centers:
#   Item 1: DefaultAzureCredential   x=960, y=123
#   Divider:                                  y=157  (skip)
#   Item 2: Sign in with VS Code     x=960, y=176
QP_X=960
QP_ITEM1_Y=123
QP_ITEM2_Y=176

# Hover slowly from item 1 down to item 2 and back up, ~1s total.
move_mouse_smooth "$QP_X" "$QP_ITEM1_Y" "$QP_X" "$QP_ITEM2_Y" 500
move_mouse_smooth "$QP_X" "$QP_ITEM2_Y" "$QP_X" "$QP_ITEM1_Y" 500

# Click DefaultAzureCredential (top option).
xdotool mousemove "$QP_X" "$QP_ITEM1_Y"
xdotool click 1

sleep 2

close_vscode
