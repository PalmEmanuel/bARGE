#!/usr/bin/env bash
# record.sh — Record VS Code extension scenarios and convert them to GIFs
# for the bARGE README.
#
# Usage:
#   ./record.sh [scenario]
#
# If [scenario] is omitted, all scenarios in the scenarios/ directory are run.
#
# Dependencies: Xvfb, xdotool, ffmpeg, code (VS Code)
#
# Output: media/readme/gifs/<scenario>.gif

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCENARIOS_DIR="${SCRIPT_DIR}/scenarios"
GIF_OUTPUT_DIR="${REPO_ROOT}/media/readme/gifs"

DISPLAY_NUM="${DISPLAY_NUM:-99}"
DISPLAY_WIDTH="${DISPLAY_WIDTH:-1920}"
DISPLAY_HEIGHT="${DISPLAY_HEIGHT:-1080}"
GIF_FPS="${GIF_FPS:-10}"
GIF_WIDTH="${GIF_WIDTH:-1920}"

VSCODE_USER_DATA_DIR="/tmp/barge-gif-recording/user-data"
VSCODE_EXTENSIONS_DIR="/tmp/barge-gif-recording/extensions"

cleanup() {
    if [[ -n "${FFMPEG_PID:-}" ]]; then
        kill -INT "${FFMPEG_PID}" 2>/dev/null || true
        wait "${FFMPEG_PID}" 2>/dev/null || true
    fi
    if [[ -n "${XVFB_PID:-}" ]]; then
        kill "${XVFB_PID}" 2>/dev/null || true
    fi
    if [[ -n "${VSCODE_PID:-}" ]]; then
        kill "${VSCODE_PID}" 2>/dev/null || true
    fi
    rm -f "/tmp/barge-recording-$$.mkv"
    rm -f "/tmp/barge-palette-$$.png"
}

trap cleanup EXIT

start_display() {
    Xvfb ":${DISPLAY_NUM}" -screen 0 "${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x24" &
    XVFB_PID=$!
    export DISPLAY=":${DISPLAY_NUM}"
    sleep 1
    # Use Quintom Snow cursor theme so pointer looks like a standard desktop cursor
    export XCURSOR_THEME="Quintom_Snow"
    export XCURSOR_SIZE=24
    xrdb -merge <<< "Xcursor.theme: Quintom_Snow
Xcursor.size: 24" 2>/dev/null || true
    # GTK settings so VS Code / Electron also picks up the cursor theme
    mkdir -p "${HOME}/.config/gtk-3.0"
    cat > "${HOME}/.config/gtk-3.0/settings.ini" <<'EOF'
[Settings]
gtk-cursor-theme-name=Quintom_Snow
gtk-cursor-theme-size=24
EOF
}

start_recording() {
    local output_file="$1"
    RECORDING_START_MS=$(date +%s%3N)
    ffmpeg -y \
        -f x11grab \
        -video_size "${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}" \
        -framerate 30 \
        -i ":${DISPLAY_NUM}" \
        -c:v libx264 \
        -preset ultrafast \
        "${output_file}" \
        > /dev/null 2>&1 &
    FFMPEG_PID=$!
}

stop_recording() {
    if [[ -n "${FFMPEG_PID:-}" ]]; then
        kill -INT "${FFMPEG_PID}" 2>/dev/null || true
        wait "${FFMPEG_PID}" 2>/dev/null || true
        unset FFMPEG_PID
    fi
}

# Returns 0 if the screen changed significantly between two screenshot files.
# Usage: screen_changed before.png after.png [threshold]
screen_changed() {
    local before="$1" after="$2" threshold="${3:-0.005}"
    local stddev
    stddev=$(convert "$before" "$after" -compose Difference -composite \
        -colorspace gray -format "%[fx:standard_deviation]" info: 2>/dev/null || echo "0")
    echo "  screen diff stddev=${stddev} (threshold=${threshold})"
    awk "BEGIN{exit !(${stddev:-0} > ${threshold})}"
}

# Clicks at (x,y) and verifies the screen changed within 0.5s.
# Returns 0 on confirmed change, 1 if nothing changed.
# Usage: click_and_verify x y [threshold]
click_and_verify() {
    local x="$1" y="$2" threshold="${3:-0.005}"
    local before="/tmp/barge-click-before-$$.png"
    local after="/tmp/barge-click-after-$$.png"
    DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- "$before" 2>/dev/null || true
    xdotool mousemove "$x" "$y"
    xdotool click 1
    sleep 0.5
    DISPLAY=":${DISPLAY_NUM}" xwd -root -silent 2>/dev/null | convert xwd:- "$after" 2>/dev/null || true
    if screen_changed "$before" "$after" "$threshold"; then
        rm -f "$before" "$after"
        return 0
    fi
    rm -f "$before" "$after"
    return 1
}

# Scans the status bar right-to-left to find and click the bARGE status bar item.
# Verifies screen changes after each attempt; retries with next x on failure.
# On success, exports BARGE_STATUS_BAR_X with the confirmed x coordinate.
click_status_bar() {
    local y=$((DISPLAY_HEIGHT - 11))
    local x
    for x in 1300 1340 1380 1260 1420 1220 1460 1180 1500 1550 1600 1650; do
        echo "Trying status bar click at x=${x}, y=${y}..."
        if click_and_verify "$x" "$y"; then
            echo "Status bar click confirmed at x=${x}"
            BARGE_STATUS_BAR_X=$x
            return 0
        fi
        xdotool key --clearmodifiers Escape 2>/dev/null || true
        sleep 0.3
    done
    echo "Error: could not find bARGE status bar item" >&2
    return 1
}

# Moves the mouse smoothly from (x1,y1) to (x2,y2) over duration_ms milliseconds.
# Usage: move_mouse_smooth x1 y1 x2 y2 [duration_ms]
move_mouse_smooth() {
    local x1="$1" y1="$2" x2="$3" y2="$4" duration_ms="${5:-1000}"
    local steps=10
    local i cx cy
    for i in $(seq 1 $steps); do
        cx=$(awk "BEGIN{printf \"%d\", ${x1} + (${x2} - ${x1}) * ${i} / ${steps}}")
        cy=$(awk "BEGIN{printf \"%d\", ${y1} + (${y2} - ${y1}) * ${i} / ${steps}}")
        xdotool mousemove "$cx" "$cy"
        sleep "$(awk "BEGIN{printf \"%.3f\", ${duration_ms} / 1000.0 / ${steps}}")"
    done
}

wait_for_vscode_window() {
    local timeout=30
    local elapsed=0
    until xdotool search --onlyvisible --name "Visual Studio Code" >/dev/null 2>&1; do
        if [[ $elapsed -ge $timeout ]]; then
            echo "Timed out waiting for VS Code window after ${timeout}s" >&2
            return 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    local wid
    wid=$(xdotool search --onlyvisible --name "Visual Studio Code" | head -1)
    if [[ -n "${wid}" ]]; then
        xdotool windowmove "${wid}" 0 0
        xdotool windowsize "${wid}" "${DISPLAY_WIDTH}" "${DISPLAY_HEIGHT}"
    fi
    # Give VS Code time to paint its UI after the window is visible.
    sleep 4
    # Open Explorer in the primary sidebar (right) and close secondary sidebar
    # (Chat panel on the left). Sent twice with a delay to prevent Copilot
    # from re-opening the panel after extension activation.
    xdotool key --clearmodifiers ctrl+shift+e 2>/dev/null || true
    xdotool key --clearmodifiers ctrl+alt+b 2>/dev/null || true
    sleep 2
    xdotool key --clearmodifiers ctrl+alt+b 2>/dev/null || true
    sleep 0.5
    # Calculate how long since recording started so convert_to_gif can trim
    # exactly to this point, ensuring the GIF begins with VS Code fully loaded.
    local now_ms
    now_ms=$(date +%s%3N)
    VSCODE_BOOT_SECONDS=$(awk "BEGIN{printf \"%.1f\", (${now_ms} - ${RECORDING_START_MS:-0}) / 1000.0}")
    echo "VS Code ready after ${VSCODE_BOOT_SECONDS}s (will trim GIF to this point)"
    # Pause 0.5s after the trim point before scenario actions begin,
    # so the GIF opens with a brief moment of VS Code idle/loaded.
    sleep 0.5
}

close_vscode() {
    xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+q 2>/dev/null || true
    local elapsed=0
    while xdotool search --onlyvisible --name "Visual Studio Code" >/dev/null 2>&1; do
        if [[ $elapsed -ge 10 ]]; then
            ${VSCODE_PID:+kill "${VSCODE_PID}"} 2>/dev/null || true
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    wait "${VSCODE_PID:-}" 2>/dev/null || true
    unset VSCODE_PID
}

convert_to_gif() {
    local input_file="$1"
    local output_file="$2"
    # Trim the boot period detected by wait_for_vscode_window (default 3s if unset)
    local skip="${VSCODE_BOOT_SECONDS:-3}"
    local palette_file="/tmp/barge-palette-$$.png"

    # Two-pass GIF encoding for best colour quality
    ffmpeg -y \
        -ss "${skip}" \
        -i "${input_file}" \
        -vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
        "${palette_file}" \
        > /dev/null 2>&1

    ffmpeg -y \
        -ss "${skip}" \
        -i "${input_file}" \
        -i "${palette_file}" \
        -lavfi "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
        "${output_file}" \
        > /dev/null 2>&1

    rm -f "${palette_file}"
}

install_extension() {
    local vsix_path
    # Find the most recently modified VSIX in the repo root
    vsix_path="$(find "${REPO_ROOT}" -maxdepth 1 -name "*.vsix" -printf '%T@ %p\n' \
        | sort -rn | head -1 | cut -d' ' -f2-)"

    if [[ -z "${vsix_path}" ]]; then
        echo "No .vsix found in repo root. Create one with 'vsce package --no-yarn' from the repo root, then re-run this script." >&2
        exit 1
    fi

    echo "Installing extension from: ${vsix_path}"
    mkdir -p "${VSCODE_USER_DATA_DIR}/User" "${VSCODE_EXTENSIONS_DIR}"
    # Disable workspace trust prompt, distracting UI, and bARGE login notifications
    cat > "${VSCODE_USER_DATA_DIR}/User/settings.json" << 'EOF'
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
    "editor.minimap.enabled": false,
    "workbench.auxiliaryBar.hidden": true
}
EOF
    code \
        --user-data-dir "${VSCODE_USER_DATA_DIR}" \
        --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
        --no-sandbox \
        --install-extension "${vsix_path}" \
        --force \
        > /dev/null 2>&1
}

run_scenario() {
    local scenario_name="$1"
    local scenario_script="${SCENARIOS_DIR}/${scenario_name}.sh"

    if [[ ! -f "${scenario_script}" ]]; then
        echo "Scenario not found: ${scenario_script}" >&2
        exit 1
    fi

    local raw_recording="/tmp/barge-recording-$$.mkv"
    local gif_output="${GIF_OUTPUT_DIR}/${scenario_name}.gif"
    VSCODE_BOOT_SECONDS=3  # reset; wait_for_vscode_window will update this

    echo "Recording scenario: ${scenario_name}"

    start_recording "${raw_recording}"

    # shellcheck source=/dev/null
    source "${scenario_script}"

    stop_recording

    echo "Converting to GIF: ${gif_output}"
    mkdir -p "${GIF_OUTPUT_DIR}"
    convert_to_gif "${raw_recording}" "${gif_output}"
    rm -f "${raw_recording}"

    echo "Done: ${gif_output}"
}

main() {
    local scenario="${1:-}"

    echo "Setting up virtual display..."
    start_display

    echo "Installing extension..."
    install_extension

    if [[ -n "${scenario}" ]]; then
        run_scenario "${scenario}"
    else
        for script in "${SCENARIOS_DIR}"/*.sh; do
            scenario_name="$(basename "${script}" .sh)"
            run_scenario "${scenario_name}"
        done
    fi
}

main "$@"
