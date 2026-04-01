#!/usr/bin/env bash
# resolve-ids.sh — Record the "Run query returning resource IDs" scenario:
# Opens a KQL file with a query that returns resource IDs and runs the query.
#
# This script is sourced by record.sh.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${SCRIPT_DIR}/fixtures/resolve-ids.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

cat > "${FIXTURE_KQL}" << 'EOF'
ResourceContainers
| where type == "microsoft.management/managementgroups"
   or type == "microsoft.resources/subscriptions"
| project name, type, id
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

# Run the query
xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+shift+p
sleep 1
xdotool type --clearmodifiers --delay 50 "bARGE: Run Query from File"
sleep 0.5
xdotool key Return
sleep 5

# Allow results to render
sleep 3

close_vscode
