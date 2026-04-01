#!/usr/bin/env bash
# diagnose-macos.sh — Find the bARGE status bar item position on macOS.
#
# Opens VS Code with the bARGE extension in a clean profile, scans the status
# bar right-to-left clicking at each position, and confirms which x coordinate
# opens the quick pick (via screenshot diff).
#
# Output: prints the confirmed x offset from the right edge of the VS Code
# window, which can be used to calibrate CI coordinates.
#
# Prerequisites: VS Code (code), ImageMagick (convert), osascript (built-in)
# Accessibility access must be granted to Terminal/iTerm in System Settings.
#
# Usage: ./scripts/record-gifs/diagnose-macos.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DIAG_USER_DATA="/tmp/barge-diag/user-data"
DIAG_EXTENSIONS="/tmp/barge-diag/extensions"
DIAG_WORKSPACE="/tmp/barge-diag/workspace"

cleanup() {
    echo "Cleaning up..."
    osascript -e 'tell application "Code" to quit' 2>/dev/null || true
    sleep 1
}
trap cleanup EXIT

# --- Build VSIX if needed ---
VSIX=$(find "${REPO_ROOT}" -maxdepth 1 -name "*.vsix" | sort | tail -1)
if [[ -z "${VSIX}" ]]; then
    echo "No VSIX found, building..."
    cd "${REPO_ROOT}" && npm run package > /dev/null 2>&1
    VSIX=$(find "${REPO_ROOT}" -maxdepth 1 -name "*.vsix" | sort | tail -1)
fi
echo "Using VSIX: ${VSIX}"

# --- Pre-seed settings ---
mkdir -p "${DIAG_USER_DATA}/User" "${DIAG_EXTENSIONS}" "${DIAG_WORKSPACE}"
cat > "${DIAG_USER_DATA}/User/settings.json" << 'EOF'
{
    "security.workspace.trust.enabled": false,
    "workbench.startupEditor": "none",
    "workbench.sideBar.location": "right",
    "workbench.activityBar.location": "hidden",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "barge.hideLoginMessages": true,
    "git.openRepositoryInParentFolders": "never",
    "git.autoRepositoryDetection": false
}
EOF

# --- Install extension ---
code \
    --user-data-dir "${DIAG_USER_DATA}" \
    --extensions-dir "${DIAG_EXTENSIONS}" \
    --install-extension "${VSIX}" \
    --force > /dev/null 2>&1

# --- Open VS Code ---
echo "Opening VS Code..."
code \
    --user-data-dir "${DIAG_USER_DATA}" \
    --extensions-dir "${DIAG_EXTENSIONS}" \
    --disable-telemetry \
    "${DIAG_WORKSPACE}" &
VSCODE_PID=$!

# Wait for VS Code window
echo "Waiting for VS Code window..."
for i in $(seq 1 30); do
    if osascript -e 'tell application "Code" to return (count of windows)' 2>/dev/null | grep -q "^[1-9]"; then
        break
    fi
    sleep 1
done
sleep 4  # Let UI fully render

# --- Get window bounds ---
BOUNDS=$(osascript << 'APPLESCRIPT'
tell application "Code"
    activate
    set b to bounds of front window
    return (item 1 of b) & "," & (item 2 of b) & "," & (item 3 of b) & "," & (item 4 of b)
end tell
APPLESCRIPT
)
WIN_LEFT=$(echo "$BOUNDS" | cut -d',' -f1 | tr -d ' ')
WIN_TOP=$(echo "$BOUNDS" | cut -d',' -f2 | tr -d ' ')
WIN_RIGHT=$(echo "$BOUNDS" | cut -d',' -f3 | tr -d ' ')
WIN_BOTTOM=$(echo "$BOUNDS" | cut -d',' -f4 | tr -d ' ')
WIN_WIDTH=$((WIN_RIGHT - WIN_LEFT))
WIN_HEIGHT=$((WIN_BOTTOM - WIN_TOP))

echo "VS Code window: ${WIN_LEFT},${WIN_TOP} → ${WIN_RIGHT},${WIN_BOTTOM} (${WIN_WIDTH}×${WIN_HEIGHT})"

# Status bar is 22px tall at the very bottom of the window
STATUS_Y=$((WIN_BOTTOM - 11))
echo "Scanning status bar at y=${STATUS_Y}..."

# --- Screenshot diff helpers ---
screen_changed() {
    local before="$1" after="$2" threshold="${3:-0.003}"
    local stddev
    stddev=$(convert "$before" "$after" -compose Difference -composite \
        -colorspace gray -format "%[fx:standard_deviation]" info: 2>/dev/null || echo "0")
    echo "  diff stddev=${stddev}"
    awk "BEGIN{exit !(${stddev:-0} > ${threshold})}"
}

osa_click() {
    local x="$1" y="$2"
    osascript -e "tell application \"System Events\" to click at {${x}, ${y}}" 2>/dev/null || true
}

osa_escape() {
    osascript -e 'tell application "System Events" to key code 53' 2>/dev/null || true
}

# --- Scan right-to-left across status bar ---
STEP=40
FOUND_X=""
FOUND_OFFSET=""

for offset in $(seq 50 $STEP 500); do
    x=$((WIN_RIGHT - offset))
    before="/tmp/barge-diag-before-${offset}.png"
    after="/tmp/barge-diag-after-${offset}.png"

    screencapture -x -R "${WIN_LEFT},${WIN_TOP},${WIN_WIDTH},${WIN_HEIGHT}" "$before" 2>/dev/null

    echo "Clicking x=${x} (offset ${offset}px from right)..."
    osa_click "$x" "$STATUS_Y"
    sleep 0.6

    screencapture -x -R "${WIN_LEFT},${WIN_TOP},${WIN_WIDTH},${WIN_HEIGHT}" "$after" 2>/dev/null

    if screen_changed "$before" "$after"; then
        echo ""
        echo "✅ bARGE status bar item found!"
        echo "   Screen x:      ${x}"
        echo "   Window offset: ${offset}px from right edge"
        echo "   Window width:  ${WIN_WIDTH}px"
        echo "   Right edge %:  $(awk "BEGIN{printf \"%.1f\", ${offset} * 100 / ${WIN_WIDTH}}")% from right"
        FOUND_X=$x
        FOUND_OFFSET=$offset
        osa_escape
        sleep 0.3
        break
    fi

    osa_escape
    sleep 0.3
    rm -f "$before" "$after"
done

if [[ -z "${FOUND_X}" ]]; then
    echo ""
    echo "❌ bARGE status bar item not found in scan range."
    echo "   Check Accessibility access for Terminal in System Settings → Privacy."
    exit 1
fi

# --- Quick pick item positions ---
echo ""
echo "Checking quick pick item positions..."
sleep 0.5

# Click bARGE again to open quick pick
before_qp="/tmp/barge-diag-qp-before.png"
after_qp="/tmp/barge-diag-qp-after.png"
screencapture -x -R "${WIN_LEFT},${WIN_TOP},${WIN_WIDTH},${WIN_HEIGHT}" "$before_qp" 2>/dev/null
osa_click "$FOUND_X" "$STATUS_Y"
sleep 0.8
screencapture -x -R "${WIN_LEFT},${WIN_TOP},${WIN_WIDTH},${WIN_HEIGHT}" "$after_qp" 2>/dev/null

# Save the quick pick screenshot for visual inspection
QP_SCREENSHOT="/tmp/barge-diag-quickpick.png"
cp "$after_qp" "$QP_SCREENSHOT"
echo "Quick pick screenshot saved to: ${QP_SCREENSHOT}"
echo "(Open it to visually confirm item positions)"
open "$QP_SCREENSHOT"

osa_escape

echo ""
echo "=== CI Calibration ==="
echo "At 1920×1080 (CI), apply the same relative offset:"
echo "  bARGE x ≈ \$((DISPLAY_WIDTH - ${FOUND_OFFSET}))"
echo "  Suggested: $((1920 - FOUND_OFFSET))"
echo ""
echo "Update click_status_bar() in record.sh if the CI scan range needs adjusting."
