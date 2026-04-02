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

# Scenario-specific settings: show sign-in notification, disable auto-authenticate
add_setting "barge.autoAuthenticate" "false"
add_setting "barge.hideLoginMessages" "false"

code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --use-gl=swiftshader \
    --no-sandbox \
    --disable-telemetry \
    --disable-extension github.copilot \
    --disable-extension github.copilot-chat \
    "${FIXTURE_WORKSPACE}" "${FIXTURE_KQL}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

# Waits for the window, sets up layout, and pauses 0.5s before actions start.
wait_for_vscode_window

# --- Scenario actions ---

QP_X=917
QP_ITEM1_Y=89
QP_ITEM2_Y=139
SB_Y=$((DISPLAY_HEIGHT - 11))

# Start mouse in the editor area (natural resting position)
xdotool mousemove 960 500
sleep 0.3

# Smoothly drag down to the status bar where the bARGE item lives
move_mouse_smooth 960 500 1380 $SB_Y 800

# Click the bARGE status bar item, scanning nearby if not exact
click_status_bar || { echo "Error: bARGE status bar item not found" >&2; close_vscode; exit 1; }

sleep 0.5

# Smoothly drag from the status bar up to the quick pick
move_mouse_smooth $BARGE_STATUS_BAR_X $SB_Y $QP_X $QP_ITEM1_Y 700
sleep 0.3

# Hover slowly between the two options to show the picker contents
move_mouse_smooth $QP_X $QP_ITEM1_Y $QP_X $QP_ITEM2_Y 1200
move_mouse_smooth $QP_X $QP_ITEM2_Y $QP_X $QP_ITEM1_Y 1200

# Click DefaultAzureCredential (top option)
xdotool click 1

sleep 2

close_vscode
