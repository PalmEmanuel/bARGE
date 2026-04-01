#!/usr/bin/env bash
# query-details.sh — Record the "Run query and view row details" scenario:
# Opens a KQL file, runs the query, and expands row details in the results panel.
#
# This script is sourced by record.sh.

FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
FIXTURE_KQL="${SCRIPT_DIR}/fixtures/query-details.kql"
mkdir -p "${FIXTURE_WORKSPACE}"

cat > "${FIXTURE_KQL}" << 'EOF'
Resources
| where type == "microsoft.storage/storageaccounts"
| project name, location, kind, sku
| limit 5
EOF

# Open VS Code with the KQL fixture file
code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu \
    --disable-telemetry \
    "${FIXTURE_KQL}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

sleep 5

# Run the query via the command palette
xdotool search --onlyvisible --name "Visual Studio Code" key --clearmodifiers ctrl+shift+p
sleep 1
xdotool type --clearmodifiers --delay 50 "bARGE: Run Query from Current File"
sleep 0.5
xdotool key Return
sleep 5

# Let results render and then click the first row to show details
sleep 3

kill "${VSCODE_PID}" 2>/dev/null || true
wait "${VSCODE_PID}" 2>/dev/null || true
