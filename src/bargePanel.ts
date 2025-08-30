import * as vscode from 'vscode';
import { AzureService } from './azureService';
import { WebviewMessage, QueryResponse, AzureSubscription } from './types';

export class BargePanel {
    public static currentPanel: BargePanel | undefined;
    public static readonly viewType = 'bargeExplorer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _azureService: AzureService;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, azureService: AzureService) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        // If we already have a panel, show it.
        if (BargePanel.currentPanel) {
            BargePanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            BargePanel.viewType,
            'bARGE - Azure Resource Graph Explorer',
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

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
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
            case 'authenticate':
                const authSuccess = await this._azureService.authenticate();
                this._panel.webview.postMessage({
                    type: 'authenticationResult',
                    payload: { success: authSuccess }
                });
                break;

            case 'getSubscriptions':
                try {
                    const subscriptions = await this._azureService.getSubscriptions();
                    this._panel.webview.postMessage({
                        type: 'subscriptionsResult',
                        payload: { success: true, subscriptions }
                    });
                } catch (error) {
                    this._panel.webview.postMessage({
                        type: 'subscriptionsResult',
                        payload: { success: false, error: String(error) }
                    });
                }
                break;

            case 'runQuery':
                try {
                    const { query, subscriptions } = message.payload;
                    const result = await this._azureService.runQuery(query, subscriptions);
                    
                    const response: QueryResponse = {
                        success: true,
                        data: result
                    };
                    
                    this._panel.webview.postMessage({
                        type: 'queryResult',
                        payload: response
                    });
                } catch (error) {
                    const response: QueryResponse = {
                        success: false,
                        error: String(error)
                    };
                    
                    this._panel.webview.postMessage({
                        type: 'queryResult',
                        payload: response
                    });
                }
                break;

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

    private async _exportToCsv(queryResult: any, filename: string) {
        try {
            const csvContent = this._convertToCsv(queryResult);
            
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename || 'query-results.csv'),
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
            throw error;
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

    public reveal(column?: vscode.ViewColumn) {
        this._panel.reveal(column);
    }

    public runFileQuery(query: string, source: 'file' | 'selection', fileName?: string) {
        // Send the query to the webview to populate and run
        this._panel.webview.postMessage({
            type: 'runFileQuery',
            payload: {
                query,
                source,
                fileName
            }
        });
        
        // Reveal the panel
        this._panel.reveal();
    }

    public dispose() {
        BargePanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>bARGE - Azure Resource Graph Explorer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            margin-bottom: 20px;
        }

        .auth-section {
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            background-color: var(--vscode-editor-widget-background);
        }

        .query-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .query-controls {
            margin-bottom: 15px;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }

        .query-editor {
            margin-bottom: 15px;
            flex: 0 0 200px;
        }

        .query-editor textarea {
            width: 100%;
            height: 180px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            resize: vertical;
        }

        .results-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .results-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 10px;
        }

        .results-info {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
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

        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: var(--vscode-font-size);
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 6px 8px;
            border-radius: 4px;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }

        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }

        .success {
            color: var(--vscode-terminal-ansiGreen);
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>bARGE - Azure Resource Graph Explorer</h1>
    </div>

    <div class="auth-section">
        <div id="authStatus">
            <button class="btn" onclick="authenticate()">Authenticate with Azure</button>
            <span id="authMessage"></span>
        </div>
        <div id="subscriptionSection" style="display: none; margin-top: 10px;">
            <label for="subscriptionSelect">Subscription:</label>
            <select id="subscriptionSelect" class="select">
                <option value="">Select a subscription...</option>
            </select>
            <button class="btn btn-secondary" onclick="loadSubscriptions()">Refresh</button>
        </div>
    </div>

    <div class="query-section">
        <div class="query-controls">
            <button class="btn" onclick="runQuery()" id="runBtn" disabled>Run Query</button>
            <button class="btn btn-secondary" onclick="exportResults()" id="exportBtn" disabled>Export to CSV</button>
            <span id="queryStatus"></span>
        </div>

        <div class="query-editor">
            <textarea id="queryTextarea" placeholder="Enter your KQL query here...
Example:
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, location, resourceGroup
| limit 100"></textarea>
        </div>

        <div class="results-section">
            <div class="results-header">
                <div class="results-info" id="resultsInfo"></div>
            </div>
            <div class="table-container" id="tableContainer">
                <div class="loading" id="noResults">No results yet. Run a query to see data.</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentResults = null;
        let sortState = { column: null, direction: null };

        // Authentication
        function authenticate() {
            vscode.postMessage({ type: 'authenticate' });
            document.getElementById('authMessage').textContent = 'Authenticating...';
        }

        function loadSubscriptions() {
            vscode.postMessage({ type: 'getSubscriptions' });
        }

        // Query execution
        function runQuery() {
            const query = document.getElementById('queryTextarea').value.trim();
            const subscription = document.getElementById('subscriptionSelect').value;
            
            if (!query) {
                alert('Please enter a query');
                return;
            }
            
            if (!subscription) {
                alert('Please select a subscription');
                return;
            }

            document.getElementById('queryStatus').textContent = 'Running query...';
            document.getElementById('runBtn').disabled = true;
            
            vscode.postMessage({
                type: 'runQuery',
                payload: {
                    query: query,
                    subscriptions: [subscription]
                }
            });
        }

        // Results display
        function displayResults(result) {
            currentResults = result;
            const tableContainer = document.getElementById('tableContainer');
            const resultsInfo = document.getElementById('resultsInfo');
            
            if (!result.columns || !result.data || result.data.length === 0) {
                tableContainer.innerHTML = '<div class="loading">No results found.</div>';
                resultsInfo.textContent = '';
                document.getElementById('exportBtn').disabled = true;
                return;
            }

            resultsInfo.textContent = \`\${result.totalRecords} results • Query executed at \${new Date(result.timestamp).toLocaleString()}\`;
            
            let tableHtml = '<table class="results-table"><thead><tr>';
            
            // Add sortable column headers
            result.columns.forEach((col, index) => {
                const sortClass = sortState.column === index ? 
                    (sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
                tableHtml += \`<th class="\${sortClass}" onclick="sortTable(\${index})">\${col.name} (\${col.type})</th>\`;
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
            document.getElementById('exportBtn').disabled = false;
        }

        // Table sorting
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
                
                // Handle null/undefined values
                if (valA === null || valA === undefined) valA = '';
                if (valB === null || valB === undefined) valB = '';
                
                // Convert to strings for comparison
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                
                if (direction === 'asc') {
                    return valA < valB ? -1 : valA > valB ? 1 : 0;
                } else {
                    return valA > valB ? -1 : valA < valB ? 1 : 0;
                }
            });
        }

        // CSV Export
        function exportResults() {
            if (!currentResults) {
                alert('No results to export');
                return;
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = \`barge-results-\${timestamp}.csv\`;
            
            vscode.postMessage({
                type: 'exportCsv',
                payload: {
                    data: currentResults,
                    filename: filename
                }
            });
        }

        // Message handling
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'authenticationResult':
                    if (message.payload.success) {
                        document.getElementById('authMessage').innerHTML = '<span class="success">✓ Authenticated</span>';
                        document.getElementById('subscriptionSection').style.display = 'block';
                        document.getElementById('runBtn').disabled = false;
                        loadSubscriptions();
                    } else {
                        document.getElementById('authMessage').innerHTML = '<span class="error">Authentication failed</span>';
                    }
                    break;
                    
                case 'subscriptionsResult':
                    const select = document.getElementById('subscriptionSelect');
                    select.innerHTML = '<option value="">Select a subscription...</option>';
                    
                    if (message.payload.success) {
                        message.payload.subscriptions.forEach(sub => {
                            const option = document.createElement('option');
                            option.value = sub.subscriptionId;
                            option.textContent = \`\${sub.displayName} (\${sub.subscriptionId})\`;
                            select.appendChild(option);
                        });
                    } else {
                        select.innerHTML += '<option value="">Error loading subscriptions</option>';
                    }
                    break;
                    
                case 'queryResult':
                    document.getElementById('queryStatus').textContent = '';
                    document.getElementById('runBtn').disabled = false;
                    
                    if (message.payload.success) {
                        displayResults(message.payload.data);
                    } else {
                        document.getElementById('tableContainer').innerHTML = 
                            \`<div class="error">Query failed: \${message.payload.error}</div>\`;
                        document.getElementById('resultsInfo').textContent = '';
                        document.getElementById('exportBtn').disabled = true;
                    }
                    break;
                    
                case 'runFileQuery':
                    // Handle query from file or selection
                    const { query, source, fileName } = message.payload;
                    document.getElementById('queryTextarea').value = query;
                    
                    // Show info about the query source
                    const sourceInfo = source === 'file' ? 'entire file' : 'selection';
                    const fileInfo = fileName ? \` from \${fileName.split('/').pop()}\` : '';
                    document.getElementById('queryStatus').textContent = \`Query loaded from \${sourceInfo}\${fileInfo}\`;
                    
                    // Auto-run if authenticated and subscription selected
                    const subscription = document.getElementById('subscriptionSelect').value;
                    if (subscription && query.trim()) {
                        setTimeout(() => runQuery(), 100); // Small delay to let UI update
                    }
                    break;
            }
        });

        // Auto-authenticate on load if configured
        window.addEventListener('load', () => {
            // Auto-authenticate could be implemented here based on settings
        });
    </script>
</body>
</html>`;
    }
}
