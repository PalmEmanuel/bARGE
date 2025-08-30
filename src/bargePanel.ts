import * as vscode from 'vscode';
import { AzureService } from './azureService';
import { WebviewMessage, QueryResponse } from './types';

export class BargePanel {
    public static currentPanel: BargePanel | undefined;
    public static readonly viewType = 'bargeResults';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _azureService: AzureService;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, azureService: AzureService) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (BargePanel.currentPanel) {
            BargePanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            BargePanel.viewType,
            'bARGE Results',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );

        BargePanel.currentPanel = new BargePanel(panel, extensionUri, azureService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, azureService: AzureService) {
        this._panel = panel;
        this._azureService = azureService;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    private async _handleMessage(message: WebviewMessage) {
        switch (message.type) {
            case 'exportCsv':
                try {
                    const { data, filename } = message.payload;
                    await this._exportToCsv(data, filename);
                } catch (error) {
                    vscode.window.showErrorMessage(`CSV export failed: ${error}`);
                }
                break;
        }
    }

    public async runQuery(query: string, source: 'file' | 'selection', fileName?: string) {
        try {
            const result = await this._azureService.runQuery(query);
            
            if (result && result.columns) {
                result.columns = result.columns.map((col: any) => ({
                    ...col,
                    name: col.name.split(' (')[0]
                }));
            }
            
            const response: QueryResponse = {
                success: true,
                data: result
            };
            
            this._panel.webview.postMessage({
                type: 'queryResult',
                payload: response
            });
            
            this._panel.reveal();
            
        } catch (error) {
            const response: QueryResponse = {
                success: false,
                error: String(error)
            };
            
            this._panel.webview.postMessage({
                type: 'queryResult',
                payload: response
            });
            
            this._panel.reveal();
        }
    }

    private async _exportToCsv(queryResult: any, filename: string) {
        try {
            const csvContent = this._convertToCsv(queryResult);
            
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

    private _convertToCsv(queryResult: any): string {
        if (!queryResult.columns || !queryResult.data) {
            throw new Error('Invalid query result data');
        }

        const headers = queryResult.columns.map((col: any) => col.name).join(',');
        const rows = queryResult.data.map((row: any[]) => 
            row.map(cell => 
                typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
                    ? `"${cell.replace(/"/g, '""')}"` 
                    : String(cell || '')
            ).join(',')
        );

        return [headers, ...rows].join('\n');
    }

    public dispose() {
        BargePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
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
            padding: 15px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
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
            padding: 6px 12px;
            border-radius: 4px;
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
            border-radius: 4px;
        }
        .results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
        }
        .results-table th {
            background-color: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border);
            padding: 8px;
            text-align: left;
            position: sticky;
            top: 0;
            cursor: pointer;
            user-select: none;
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
            padding: 6px 8px;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .results-table tr:nth-child(even) {
            background-color: var(--vscode-editor-widget-background);
        }
        .no-results {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 4px;
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <div id="resultsInfo" class="results-info">No results yet. Run a query from a .kql file to see results here.</div>
        <button id="exportBtn" class="export-btn" onclick="exportToCsv()" style="display: none;">Export CSV</button>
    </div>
    
    <div id="tableContainer" class="table-container">
        <div class="no-results">No results to display</div>
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
            
            result.columns.forEach((col, index) => {
                const sortClass = sortState.column === index ? 
                    (sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
                tableHtml += \`<th class="\${sortClass}" onclick="sortTable(\${index})" title="\${col.name}">\${col.name}</th>\`;
            });
            
            tableHtml += '</tr></thead><tbody>';
            
            result.data.forEach(row => {
                tableHtml += '<tr>';
                row.forEach(cell => {
                    const cellValue = cell !== null && cell !== undefined ? String(cell) : '';
                    tableHtml += \`<td title="\${cellValue}">\${cellValue}</td>\`;
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            tableContainer.innerHTML = tableHtml;
        }

        function sortTable(columnIndex) {
            if (!currentResults || !currentResults.data) return;
            
            let direction = 'asc';
            if (sortState.column === columnIndex && sortState.direction === 'asc') {
                direction = 'desc';
            }
            
            sortState = { column: columnIndex, direction };
            
            const sortedData = [...currentResults.data].sort((a, b) => {
                const aVal = a[columnIndex];
                const bVal = b[columnIndex];
                
                if (aVal == null && bVal == null) return 0;
                if (aVal == null) return direction === 'asc' ? -1 : 1;
                if (bVal == null) return direction === 'asc' ? 1 : -1;
                
                const aNum = Number(aVal);
                const bNum = Number(bVal);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return direction === 'asc' ? aNum - bNum : bNum - aNum;
                }
                
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                
                if (direction === 'asc') {
                    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
                } else {
                    return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
                }
            });
            
            const sortedResult = { ...currentResults, data: sortedData };
            displayResults(sortedResult);
        }

        function exportToCsv() {
            if (currentResults) {
                vscode.postMessage({ 
                    type: 'exportCsv', 
                    payload: { 
                        data: currentResults, 
                        filename: \`barge-results-\${new Date().toISOString().replace(/[:.]/g, '-')}.csv\`
                    } 
                });
            }
        }

        function displayError(error) {
            const tableContainer = document.getElementById('tableContainer');
            const resultsInfo = document.getElementById('resultsInfo');
            const exportBtn = document.getElementById('exportBtn');
            
            tableContainer.innerHTML = \`<div class="error">Error: \${error}</div>\`;
            resultsInfo.textContent = 'Query failed';
            exportBtn.style.display = 'none';
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'queryResult':
                    if (message.payload.success) {
                        displayResults(message.payload.data);
                    } else {
                        displayError(message.payload.error);
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}