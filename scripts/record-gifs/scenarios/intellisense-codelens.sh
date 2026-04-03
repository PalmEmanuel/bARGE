#!/usr/bin/env bash
# intellisense-codelens.sh — Record IntelliSense and CodeLens scenario.
#
# Shows:
#  1. Running a storage accounts query via "► Run" CodeLens
#  2. Live-typing a key vault query with IntelliSense autocomplete visible
#  3. Hovering the "contains" operator for hover documentation
#  4. Running the key vault query via "► Run (New Tab)" CodeLens
#
# Sourced by record.sh after start_recording. All record.sh helpers are available.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${REPO_ROOT}/src/test/fixtures/barge-resources.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

add_setting "barge.autoAuthenticate" "true"
# Disable auto-closing pairs so xdotool type produces clean output
add_setting "editor.autoClosingQuotes" '"never"'
add_setting "editor.autoClosingBrackets" '"never"'

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
# CodeLens 1 is above line 1 of the file.
# After running CL1 and typing query 2, the file has:
#   line 1: resources
#   line 2: | where ... storageaccounts
#   line 3: | take 5
#   line 4: (blank — from one Enter after Ctrl+End on trailing newline)
#   line 5: resources               ← CL2 above this
#   line 6: | where ... keyvaults   ← CONTAINS_Y
#   line 7: | take 5
#
# Adjust these to match your display:
CL1_RUN_X=95
CL1_RUN_Y=100

CL2_RUN_X=95
CL2_RUN_Y=186
CL2_NEWTAB_X=145
CL2_NEWTAB_Y=186

# x position of the word "contains" on line 6
# "| where type == "microsoft.keyvault/vaults" and name " = ~52 chars
# At ~8.4px/char + ~50px gutter ≈ 490px
CONTAINS_X=490
CONTAINS_Y=268

# A safe click target in the editor body (avoid panel/status bar)
EDITOR_X=400
EDITOR_Y=200

xdotool mousemove $EDITOR_X $EDITOR_Y
sleep 0.5

# -- Step 1: Run storage accounts query via "► Run" --
sleep 1

move_mouse_smooth $EDITOR_X $EDITOR_Y $CL1_RUN_X $CL1_RUN_Y 800
click_and_verify $CL1_RUN_X $CL1_RUN_Y "0.003" "1920x1000+0+0" \
    || { echo "Error: CodeLens 1 click produced no visible change" >&2; close_vscode; exit 1; }

sleep 1.5

# -- Step 2: Smooth move back to editor, go to end of file, type key vault query live --
move_mouse_smooth $CL1_RUN_X $CL1_RUN_Y $EDITOR_X $EDITOR_Y 600
xdotool click 1
sleep 0.3
xdotool key ctrl+End
sleep 0.3

# One Enter adds a blank separator (cursor was already on the empty trailing-newline line)
xdotool key Return
sleep 0.3

# Type partial table name, accept completion with Enter — snippet inserts newline + "| " for free
natural_type "resou"
sleep 0.8  # Let autocomplete show "resources"
xdotool key Return  # Accept completion; bARGE snippet inserts "resources\n| "
sleep 0.4

# Cursor is now after "| " on the new line — type partial resource type, accept with Enter
natural_type 'where type == "keyvaul'
sleep 1.2  # Let IntelliSense show "microsoft.keyvault/vaults"
xdotool key Return  # Accept resource type completion
sleep 0.3
natural_type ' and name contains "bARGE"'
xdotool key Escape
sleep 0.1
xdotool key Return
sleep 0.2
natural_type "| take 5"
sleep 0.5

# Dismiss any open autocomplete popup, then scroll back to top so CodeLens positions are valid
xdotool key Escape
sleep 0.3
xdotool key ctrl+Home
sleep 0.3

mkdir -p /tmp/barge-debug
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- /tmp/barge-debug/after-typing.png 2>/dev/null || true

# -- Step 3: Hover "contains" for operator documentation --
move_mouse_smooth $EDITOR_X $EDITOR_Y $CONTAINS_X $CONTAINS_Y 700
sleep 1.5

# Scroll through hover content
for i in {1..4}; do
    xdotool click 5
    sleep 0.4
done

sleep 0.5

# -- Step 4: Run key vault query in new tab via "► Run (New Tab)" --
DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- /tmp/barge-debug/before-cl2.png 2>/dev/null || true
move_mouse_smooth $CONTAINS_X $CONTAINS_Y $CL2_NEWTAB_X $CL2_NEWTAB_Y 700
click_and_verify $CL2_NEWTAB_X $CL2_NEWTAB_Y "0.002" "1920x1000+0+0" \
    || { echo "Error: CodeLens 2 New Tab click produced no change" >&2; close_vscode; exit 1; }

sleep 1.5

stop_recording
close_vscode
