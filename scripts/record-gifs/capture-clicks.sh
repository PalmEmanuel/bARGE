#!/usr/bin/env bash
# capture-clicks.sh — Interactively record a scenario by clicking through VS Code.
#
# Opens VS Code with the bARGE extension in a clean profile (identical to CI),
# with a fixture workspace and .kql file open. You click through the actions
# you want. Each click is recorded relative to the VS Code window and scaled
# to CI coordinates (1920x1080). On Ctrl+C, a ready-to-run scenario .sh is written.
#
# Usage:
#   ./scripts/record-gifs/capture-clicks.sh <scenario-name>
#   Example: ./scripts/record-gifs/capture-clicks.sh sign-in
#
# Requirements: python3 + pynput (pip3 install pynput --user)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCENARIO_NAME="${1:-scenario}"
SCENARIO_OUT="${SCRIPT_DIR}/scenarios/${SCENARIO_NAME}.sh"

CAPTURE_USER_DATA="/tmp/barge-capture/user-data"
CAPTURE_EXTENSIONS="/tmp/barge-capture/extensions"
FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${FIXTURE_WORKSPACE}/example.kql"

CI_WIDTH=1920
CI_HEIGHT=1080

cleanup() {
    osascript -e 'tell application "System Events" to tell process "Code" to keystroke "q" using {command down}' 2>/dev/null || true
    sleep 1
}
trap cleanup EXIT

# --- Build VSIX if needed ---
VSIX=$(find "${REPO_ROOT}" -maxdepth 1 -name "*.vsix" | sort | tail -1)
if [[ -z "${VSIX}" ]]; then
    echo "No VSIX found, building..."
    cd "${REPO_ROOT}" && vsce package --no-yarn > /dev/null 2>&1
    VSIX=$(find "${REPO_ROOT}" -maxdepth 1 -name "*.vsix" | sort | tail -1)
fi
echo "Using VSIX: ${VSIX}"

# --- Set up clean profile (mirrors CI install_extension) ---
rm -rf /tmp/barge-capture
mkdir -p "${CAPTURE_USER_DATA}/User" "${CAPTURE_EXTENSIONS}" "${FIXTURE_WORKSPACE}"

cat > "${CAPTURE_USER_DATA}/User/settings.json" << 'EOF'
{
    "security.workspace.trust.enabled": false,
    "workbench.startupEditor": "none",
    "workbench.sideBar.location": "right",
    "workbench.activityBar.location": "hidden",
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "barge.hideLoginMessages": true,
    "git.openRepositoryInParentFolders": "never",
    "git.autoRepositoryDetection": false,
    "editor.minimap.enabled": false
}
EOF

# Create fixture .kql file
cat > "${FIXTURE_KQL}" << 'EOF'
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, location, resourceGroup
| limit 10
EOF

# Install extension into clean profile
code \
    --user-data-dir "${CAPTURE_USER_DATA}" \
    --extensions-dir "${CAPTURE_EXTENSIONS}" \
    --install-extension "${VSIX}" \
    --force \
    > /dev/null 2>&1

echo "Extension installed. Opening VS Code..."

# --- Open VS Code with workspace + kql file (mirrors scenario scripts) ---
code \
    --user-data-dir "${CAPTURE_USER_DATA}" \
    --extensions-dir "${CAPTURE_EXTENSIONS}" \
    --disable-telemetry \
    --disable-extension github.copilot-chat \
    "${FIXTURE_WORKSPACE}" "${FIXTURE_KQL}" &
VSCODE_PID=$!

# --- Wait for VS Code to fully open ---
echo "Waiting for VS Code to load (8s)..."
sleep 8

# Find the largest Code window (main window, not helper popups)
WIN_BOUNDS=$(osascript << 'APPLESCRIPT' 2>/dev/null || true
tell application "System Events"
    set bestBounds to ""
    set bestArea to 0
    repeat with proc in (every process whose name is "Code")
        try
            repeat with w in (windows of proc)
                try
                    set pos to position of w
                    set sz to size of w
                    set area to (item 1 of sz) * (item 2 of sz)
                    if area > bestArea and (item 1 of sz) > 800 then
                        set bestArea to area
                        set bestBounds to ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)
                    end if
                end try
            end repeat
        end try
    end repeat
    return bestBounds
end tell
APPLESCRIPT
)

if [[ -z "${WIN_BOUNDS}" ]]; then
    echo "Error: VS Code window not found" >&2
    exit 1
fi

# Maximize VS Code and close the secondary sidebar (Chat), then re-fetch bounds
osascript << 'APPLESCRIPT' 2>/dev/null || true
tell application "System Events"
    tell process "Code"
        set frontmost to true
        -- Zoom (maximize) the main window
        if (count of windows) > 0 then
            tell window 1 to if value of attribute "AXZoomed" is false then
                perform action "AXZoom"
            end if
        end if
    end tell
end tell
APPLESCRIPT
sleep 0.5
# Wait for Copilot Chat to finish loading before closing it,
# otherwise it reopens after we dismiss it.
sleep 4
# Close secondary sidebar (Chat): Cmd+Alt+B on macOS
osascript -e 'tell application "System Events" to tell process "Code" to set frontmost to true' 2>/dev/null || true
osascript -e 'tell application "System Events" to tell process "Code" to keystroke "b" using {option down, command down}' 2>/dev/null || true
# Open Explorer: Cmd+Shift+E
osascript -e 'tell application "System Events" to tell process "Code" to keystroke "e" using {shift down, command down}' 2>/dev/null || true
sleep 0.5

# Re-fetch bounds — pick the largest Code window by area
WIN_BOUNDS=$(osascript << 'APPLESCRIPT' 2>/dev/null || true
tell application "System Events"
    set bestBounds to ""
    set bestArea to 0
    repeat with proc in (every process whose name is "Code")
        try
            repeat with w in (windows of proc)
                try
                    set pos to position of w
                    set sz to size of w
                    set area to (item 1 of sz) * (item 2 of sz)
                    if area > bestArea then
                        set bestArea to area
                        set bestBounds to ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)
                    end if
                end try
            end repeat
        end try
    end repeat
    return bestBounds
end tell
APPLESCRIPT
)

WIN_X=$(echo "${WIN_BOUNDS}" | cut -d',' -f1 | tr -d ' ')
WIN_Y=$(echo "${WIN_BOUNDS}" | cut -d',' -f2 | tr -d ' ')
WIN_W=$(echo "${WIN_BOUNDS}" | cut -d',' -f3 | tr -d ' ')
WIN_H=$(echo "${WIN_BOUNDS}" | cut -d',' -f4 | tr -d ' ')
echo "VS Code window (maximized): ${WIN_X},${WIN_Y}  ${WIN_W}x${WIN_H}"
echo ""
echo "======================================"
echo " Click through your scenario actions."
echo " Press Ctrl+C when done."
echo "======================================"
echo ""

# --- Capture clicks and output scenario ---
python3 - "${WIN_X}" "${WIN_Y}" "${WIN_W}" "${WIN_H}" \
           "${CI_WIDTH}" "${CI_HEIGHT}" \
           "${SCENARIO_NAME}" "${SCENARIO_OUT}" << 'PYEOF'
import sys, os, signal, subprocess
win_x, win_y, win_w, win_h = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
ci_w, ci_h = int(sys.argv[5]), int(sys.argv[6])
scenario_name, scenario_out = sys.argv[7], sys.argv[8]

from pynput import mouse

clicks = []
click_count = [0]

def on_click(x, y, button, pressed):
    if not pressed or button.name != 'left':
        return
    n = click_count[0]
    click_count[0] += 1
    rel_x = (x - win_x) / win_w
    rel_y = (y - win_y) / win_h
    ci_x = int(rel_x * ci_w)
    ci_y = int(rel_y * ci_h)
    print(f"  [{n+1}] screen=({x},{y})  CI=({ci_x},{ci_y})")
    img = f"/tmp/barge-capture/click-{n+1:02d}.png"
    subprocess.run(['screencapture', '-x', img], capture_output=True)
    clicks.append({'n': n+1, 'ci_x': ci_x, 'ci_y': ci_y})

def write_scenario():
    lines = [
        '#!/usr/bin/env bash',
        f'# {scenario_name}.sh — Generated by capture-clicks.sh',
        '# Review sleeps and add move_mouse_smooth calls for hover effects.',
        '#',
        '# Sourced by record.sh after start_recording. All helpers are available.',
        '',
        'FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"',
        'FIXTURE_KQL="${FIXTURE_WORKSPACE}/example.kql"',
        'mkdir -p "${FIXTURE_WORKSPACE}"',
        '',
        "cat > \"${FIXTURE_KQL}\" << 'EOF'",
        'Resources',
        '| where type == \'microsoft.compute/virtualmachines\'',
        '| project name, location, resourceGroup',
        '| limit 10',
        'EOF',
        '',
        'code \\',
        '    --user-data-dir "${VSCODE_USER_DATA_DIR}" \\',
        '    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \\',
        '    --disable-gpu --use-gl=swiftshader --no-sandbox --disable-telemetry --disable-extension github.copilot-chat \\',
        '    "${FIXTURE_WORKSPACE}" "${FIXTURE_KQL}" \\',
        '    > /dev/null 2>&1 &',
        'VSCODE_PID=$!',
        '',
        '# Waits for window, sets layout, pauses 0.5s before actions.',
        'wait_for_vscode_window',
        '',
        '# --- Scenario actions ---',
        '',
    ]
    for c in clicks:
        lines.append(f"xdotool mousemove {c['ci_x']} {c['ci_y']}")
        lines.append(f"xdotool click 1")
        lines.append(f"sleep 1")
        lines.append('')
    lines += ['close_vscode', '']
    with open(scenario_out, 'w') as f:
        f.write('\n'.join(lines))
    os.chmod(scenario_out, 0o755)

def on_done(sig, frame):
    print(f"\n {len(clicks)} clicks recorded.")
    write_scenario()
    print(f" Scenario written to:\n  {scenario_out}")
    print(" Screenshots in /tmp/barge-capture/click-*.png")
    sys.exit(0)

signal.signal(signal.SIGINT, on_done)
print(" Listening (Ctrl+C to finish)...\n")
with mouse.Listener(on_click=on_click) as listener:
    listener.join()
PYEOF
