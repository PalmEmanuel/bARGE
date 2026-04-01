#!/usr/bin/env bash
# query-comparison.sh — Record the "Run query and view results" scenario:
# Opens a KQL file and runs the query, showing the results panel.
#
# This script is sourced by record.sh.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${SCRIPT_DIR}/fixtures/query-comparison.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

cat > "${FIXTURE_KQL}" << 'EOF'
Resources
| where type == "microsoft.storage/storageaccounts"
| project name, location, kind, sku
| limit 10
EOF

# Open VS Code with the KQL fixture file
code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --no-sandbox \
    --disable-telemetry \
    "${FIXTURE_KQL}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

wait_for_vscode_window

# Run the query via the command palette
xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+shift+p
sleep 1
xdotool type --clearmodifiers --delay 50 "bARGE: Run Query from File"
sleep 0.5
xdotool key Return
sleep 5

# Allow results to render
sleep 3

close_vscode
