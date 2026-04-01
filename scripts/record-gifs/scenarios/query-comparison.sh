#!/usr/bin/env bash
# query-comparison.sh — Record the "Run query and compare rows" scenario:
# Opens a KQL file, runs the query, selects two rows for comparison.
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

# Allow results to render
sleep 3

kill "${VSCODE_PID}" 2>/dev/null || true
wait "${VSCODE_PID}" 2>/dev/null || true
