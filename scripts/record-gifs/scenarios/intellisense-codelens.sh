#!/usr/bin/env bash
# intellisense-codelens.sh — Record IntelliSense and CodeLens scenario.
#
# Shows KQL autocomplete, hover documentation for 'where' with scroll,
# and running queries via "► Run" and "► Run (New Tab)" CodeLens buttons.
# The GIF ends with two result tabs open side by side.
#
# Sourced by record.sh after start_recording. All record.sh helpers are available.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${REPO_ROOT}/src/test/fixtures/barge-resources.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

# autoAuthenticate=true (default) — bARGE signs in on startup via DefaultAzureCredential
add_setting "barge.autoAuthenticate" "true"

code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu --use-gl=swiftshader --no-sandbox --disable-telemetry \
    --disable-extension github.copilot \
    --disable-extension github.copilot-chat \
    "${FIXTURE_WORKSPACE}" "${FIXTURE_KQL}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

wait_for_vscode_window

# --- Coordinate constants (1920×1080, sidebar right, no activity bar) ---
#
# Editor content starts at y≈44 (tab bar + breadcrumb), x≈45 (after line numbers).
# Line height ≈22px. CodeLens row ≈18px above each block's first line.
#
# With barge-resources.kql (2 blocks, each with CodeLens):
#   CodeLens block 1 (► Run  ► Run (New Tab)): y≈53
#   Line 1  resources:                          y≈73
#   Line 2  | where ... storageaccounts:        y≈95
#   Line 3  | take 5:                           y≈117
#   Line 4  (blank):                            y≈139
#   CodeLens block 2 (► Run  ► Run (New Tab)): y≈159
#   Line 5  resources:                          y≈179
#   Line 6  | where ... keyvaults:              y≈201
#   Line 7  | take 5:                           y≈223
#
# CodeLens x positions: "► Run" ≈55, "► Run (New Tab)" ≈130
# 'where' on line 6: center ≈ x=80

EDITOR_X=500
EDITOR_Y=300

CL1_RUN_X=55
CL1_RUN_Y=53

CL2_RUN_X=55
CL2_RUN_Y=159
CL2_NEWTAB_X=130
CL2_NEWTAB_Y=159

WHERE_X=80
WHERE_Y=201

# Start mouse in editor area
xdotool mousemove $EDITOR_X $EDITOR_Y
sleep 0.5

# -- Step 1: Run storage accounts query via "► Run" --
sleep 1  # Ensure CodeLens has rendered

# Save debug screenshot to see what's at y=53 before clicking
mkdir -p /tmp/barge-debug
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- /tmp/barge-debug/before-codelens1.png 2>/dev/null || true

move_mouse_smooth $EDITOR_X $EDITOR_Y $CL1_RUN_X $CL1_RUN_Y 800
click_and_verify $CL1_RUN_X $CL1_RUN_Y "0.003" "1920x1000+0+0" \
    || { echo "Error: CodeLens 1 click produced no visible change" >&2; close_vscode; exit 1; }

# Save debug screenshot after click
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- /tmp/barge-debug/after-codelens1.png 2>/dev/null || true

sleep 1.5

# -- Step 2: Show autocomplete in key vaults 'where' clause --
move_mouse_smooth $CL1_RUN_X $CL1_RUN_Y $WHERE_X $WHERE_Y 900
xdotool click 1
sleep 0.3
xdotool key ctrl+space
sleep 1.5
xdotool key Escape
sleep 0.4

# -- Step 3: Hover 'where' and scroll through documentation --
move_mouse_smooth $WHERE_X $WHERE_Y $((WHERE_X + 5)) $WHERE_Y 300
sleep 1.5

# Scroll down slowly through hover popup examples
for i in {1..6}; do
    xdotool click --button 5
    sleep 0.4
done

sleep 0.5

# -- Step 4: Run key vaults query in new tab via "► Run (New Tab)" --
move_mouse_smooth $WHERE_X $WHERE_Y $CL2_NEWTAB_X $CL2_NEWTAB_Y 800
click_and_verify $CL2_NEWTAB_X $CL2_NEWTAB_Y "0.003" "1920x1000+0+0" \
    || { echo "Error: CodeLens 2 New Tab click produced no change" >&2; close_vscode; exit 1; }

sleep 1.5

stop_recording
close_vscode
