#!/usr/bin/env bash
# sign-in.sh — Record the Sign In scenario.
#
# Shows a user clicking the bARGE status bar item, browsing the authentication
# picker, and selecting DefaultAzureCredential.
#
# Sourced by record.sh after start_recording. All record.sh helpers are available.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${FIXTURE_WORKSPACE}/example.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

cat > "${FIXTURE_KQL}" << 'EOF'
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, location, resourceGroup
| limit 10
EOF

code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --use-gl=swiftshader \
    --no-sandbox \
    --disable-telemetry \
    --disable-extension github.copilot-chat \
    "${FIXTURE_WORKSPACE}" "${FIXTURE_KQL}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

# Waits for the window, sets up layout, and pauses 0.5s before actions start.
wait_for_vscode_window

# --- Scenario actions ---

# Click the bARGE status bar item (confirmed at CI x=1370 from capture-clicks.sh).
click_and_verify 1370 1063 || { echo "Error: bARGE status bar click had no effect" >&2; close_vscode; exit 1; }

sleep 1

# Quick pick items at 1920x1080 (captured on 1440x900 macOS, normalized to CI):
#   Item 1: DefaultAzureCredential  x=917, y=89
#   Item 2: Sign in with VS Code    x=917, y=~139  (+50px)
QP_X=917
QP_ITEM1_Y=89
QP_ITEM2_Y=139

# Hover slowly from item 1 down to item 2 and back, ~1s total.
move_mouse_smooth "$QP_X" "$QP_ITEM1_Y" "$QP_X" "$QP_ITEM2_Y" 500
move_mouse_smooth "$QP_X" "$QP_ITEM2_Y" "$QP_X" "$QP_ITEM1_Y" 500

# Click DefaultAzureCredential (top option).
xdotool mousemove "$QP_X" "$QP_ITEM1_Y"
xdotool click 1

sleep 2

close_vscode
