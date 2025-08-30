import * as vscode from 'vscode';
import { QueryResult } from './types';

export class ResultsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'barge.resultsView';
    
    private _view?: vscode.WebviewView;
    private _currentResults?: QueryResult;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'exportCsv':
                    this._exportToCsv();
                    break;
            }
        });
    }

    public updateResults(results: QueryResult) {
        this._currentResults = results;
        
        // Set context to show the view
        vscode.commands.executeCommand('setContext', 'barge.hasResults', true);
        
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateResults',
                payload: results
            });
        }
    }

    private async _exportToCsv() {
        if (!this._currentResults) {
            vscode.window.showErrorMessage('No results to export');
            return;
        }

        try {
            const csvContent = this._convertToCsv(this._currentResults);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `barge-results-${timestamp}.csv`;
            
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                filters: {
                    'CSV Files': ['csv'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, 'utf8'));
                vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`CSV export failed: ${error}`);
        }
    }

    private _convertToCsv(queryResult: QueryResult): string {
        if (!queryResult.columns || !queryResult.data) {
            throw new Error('Invalid query result data');
        }

        const headers = queryResult.columns.map(col => col.name).join(',');
        const rows = queryResult.data.map(row => 
            row.map(cell => 
                typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
                    ? `"${cell.replace(/"/g, '""')}"` 
                    : String(cell || '')
            ).join(',')
        );

        return [headers, ...rows].join('\n');
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>bARGE Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }

        .results-info {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }

        .export-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.9em;
        }

        .export-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .table-container {
            flex: 1;
            overflow: auto;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 2px;
        }

        .results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85em;
        }

        .results-table th {
            background-color: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border);
            padding: 6px 8px;
            text-align: left;
            position: sticky;
            top: 0;
            cursor: pointer;
            user-select: none;
            font-weight: bold;
        }

        .results-table th:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .results-table th.sorted-asc::after {
            content: ' ↑';
        }

        .results-table th.sorted-desc::after {
            content: ' ↓';
        }

        .results-table td {
            border: 1px solid var(--vscode-widget-border);
            padding: 4px 6px;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .results-table tr:nth-child(even) {
            background-color: var(--vscode-editor-widget-background);
        }

        .no-results {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="results-header">
        <div class="results-info" id="resultsInfo">No results yet</div>
        <button class="export-btn" onclick="exportResults()" id="exportBtn" style="display: none;">Export CSV</button>
    </div>
    
    <div class="table-container" id="tableContainer">
        <div class="no-results">No results yet. Run a query to see data.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentResults = null;
        let sortState = { column: null, direction: null };

        function displayResults(result) {
            currentResults = result;
            const tableContainer = document.getElementById('tableContainer');
            const resultsInfo = document.getElementById('resultsInfo');
            const exportBtn = document.getElementById('exportBtn');
            
            if (!result.columns || !result.data || result.data.length === 0) {
                tableContainer.innerHTML = '<div class="no-results">No results found.</div>';
                resultsInfo.textContent = 'No results';
                exportBtn.style.display = 'none';
                return;
            }

            const executionTimeText = result.executionTimeMs ? 
                \` • \${result.executionTimeMs}ms\` : '';
            resultsInfo.textContent = \`\${result.totalRecords} results\${executionTimeText} • \${new Date(result.timestamp).toLocaleString()}\`;
            exportBtn.style.display = 'block';
            
            let tableHtml = '<table class="results-table"><thead><tr>';
            
            // Add sortable column headers (without type information)
            result.columns.forEach((col, index) => {
                const sortClass = sortState.column === index ? 
                    (sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
                tableHtml += \`<th class="\${sortClass}" onclick="sortTable(\${index})" title="\${col.name}">\${col.name}</th>\`;
            });
            
            tableHtml += '</tr></thead><tbody>';
            
            // Add data rows
            const dataToShow = sortState.column !== null ? getSortedData(result) : result.data;
            dataToShow.forEach(row => {
                tableHtml += '<tr>';
                row.forEach(cell => {
                    const cellValue = cell === null || cell === undefined ? '' : String(cell);
                    tableHtml += \`<td title="\${cellValue}">\${cellValue}</td>\`;
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            tableContainer.innerHTML = tableHtml;
        }

        function sortTable(columnIndex) {
            if (sortState.column === columnIndex) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.column = columnIndex;
                sortState.direction = 'asc';
            }
            
            if (currentResults) {
                displayResults(currentResults);
            }
        }

        function getSortedData(result) {
            const data = [...result.data];
            const columnIndex = sortState.column;
            const direction = sortState.direction;
            
            return data.sort((a, b) => {
                let valA = a[columnIndex];
                let valB = b[columnIndex];
                
                if (valA === null || valA === undefined) valA = '';
                if (valB === null || valB === undefined) valB = '';
                
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                
                if (direction === 'asc') {
                    return valA < valB ? -1 : valA > valB ? 1 : 0;
                } else {
                    return valA > valB ? -1 : valA < valB ? 1 : 0;
                }
            });
        }

        function exportResults() {
            vscode.postMessage({ type: 'exportCsv' });
        }

        // Message handling
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateResults':
                    displayResults(message.payload);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
