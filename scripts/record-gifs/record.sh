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
    # Open the Explorer sidebar so it's visible on the right from the first frame.
    xdotool key --clearmodifiers ctrl+shift+e 2>/dev/null || true
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
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "barge.hideLoginMessages": true,
    "git.openRepositoryInParentFolders": "never",
    "git.autoRepositoryDetection": false
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
