import * as vscode from 'vscode';
import { AzureService } from './azureService';
import { WebviewMessage, QueryResponse } from './types';

export class BargePanel {
    public static currentPanel: BargePanel | undefined;
    public static readonly viewType = 'bargeResults';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _azureService: AzureService;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, azureService: AzureService) {
        if (BargePanel.currentPanel) {
            // Don't force repositioning - just reveal where it currently is
            BargePanel.currentPanel._panel.reveal();
            return;
        }

        // Create panel in bottom area by default
        const panel = vscode.window.createWebviewPanel(
            BargePanel.viewType,
            'bARGE - basic Azure Resource Graph Explorer',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );

        BargePanel.currentPanel = new BargePanel(panel, extensionUri, azureService);
        
        // Move to bottom panel after creation
        vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, azureService: AzureService) {
        this._panel = panel;
        this._azureService = azureService;
        this._extensionUri = extensionUri;
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
            // Show loading indicator
            this._panel.webview.postMessage({
                type: 'queryStart'
            });
            
            this._panel.reveal();
            
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
        const loadingGifUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'loadingbarge.gif')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>bARGE - basic Azure Resource Graph Explorer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .table-container {
            flex: 1;
            overflow: auto;
            margin: 15px 15px 0 15px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            min-height: 200px;
        }
        .footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-top: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-editor-background);
            flex-shrink: 0;
            min-height: 40px;
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
        .results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
            table-layout: fixed;
        }
        .results-table th {
            background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
            border: 1px solid var(--vscode-widget-border);
            padding: 8px;
            text-align: left;
            position: sticky;
            top: -1px;
            cursor: pointer;
            user-select: none;
            z-index: 10;
            min-width: 60px;
            resize: horizontal;
            overflow: hidden;
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
        .results-table th.dragging {
            opacity: 0.5;
            background-color: var(--vscode-list-activeSelectionBackground);
        }
        .results-table th.drag-over {
            border-left: 3px solid var(--vscode-focusBorder);
        }
        .resize-handle {
            position: absolute;
            top: 0;
            right: 0;
            width: 5px;
            height: 100%;
            cursor: col-resize;
            background: transparent;
            z-index: 11;
        }
        .resize-handle:hover {
            background-color: var(--vscode-focusBorder);
        }
        .results-table td {
            border: 1px solid var(--vscode-widget-border);
            padding: 6px 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            user-select: none;
            position: relative;
        }
        .results-table td:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .results-table td.selected {
            background-color: var(--vscode-list-activeSelectionBackground) !important;
            color: var(--vscode-list-activeSelectionForeground);
        }
        .results-table td[title] {
            /* Ensure tooltips are properly displayed */
            white-space: nowrap;
        }
        /* JSON content styling */
        .results-table td .json-content {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
            color: var(--vscode-textPreformat-foreground);
        }
        
        /* Custom tooltip styling */
        .custom-tooltip {
            position: absolute;
            background: var(--vscode-editorHoverWidget-background);
            border: 1px solid var(--vscode-editorHoverWidget-border);
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 0.9em;
            color: var(--vscode-editorHoverWidget-foreground);
            z-index: 1000;
            max-width: 400px;
            max-height: 300px;
            overflow: auto;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease-in-out;
        }
        
        .custom-tooltip.interactive {
            pointer-events: auto;
            user-select: text;
            -webkit-user-select: text;
            -moz-user-select: text;
            -ms-user-select: text;
        }
        
        .custom-tooltip.show {
            opacity: 1;
        }
        
        .custom-tooltip.json {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
        }
        
        /* Custom context menu styling */
        .custom-context-menu {
            position: absolute;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 2000;
            min-width: 160px;
            padding: 4px 0;
            font-size: 0.9em;
        }
        
        .context-menu-item {
            padding: 8px 16px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        
        .context-menu-item.disabled {
            color: var(--vscode-disabledForeground);
            cursor: default;
        }
        
        .context-menu-item.disabled:hover {
            background: transparent;
            color: var(--vscode-disabledForeground);
        }
        
        /* Loading indicator styling */
        .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(var(--vscode-editor-background-rgb, 30, 30, 30), 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            backdrop-filter: blur(2px);
        }
        
        .loading-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            color: var(--vscode-foreground);
            font-size: 0.9em;
            text-align: center;
        }
        
        .loading-animation {
            width: 128px;
            height: 128px;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .loading-animation img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        
        .loading-message {
            font-weight: 500;
            max-width: 200px;
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
            margin: 15px;
        }
    </style>
</head>
<body>
    <div id="tableContainer" class="table-container">
        <div class="no-results">No results to display</div>
    </div>
    
    <div class="footer">
        <div id="resultsInfo" class="results-info">No results yet. Run a query from a .kql file to see results here.</div>
        <button id="exportBtn" class="export-btn" onclick="exportToCsv()" style="display: none;">Export CSV</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const loadingGifUri = '${loadingGifUri}';
        let currentResults = null;
        let sortState = { column: null, direction: null };

        function escapeHtml(text) {
            if (typeof text !== 'string') {
                text = String(text);
            }
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatCellValue(cell) {
            if (cell === null || cell === undefined) {
                return { displayValue: '<em style="color: var(--vscode-descriptionForeground);">null</em>', tooltipValue: 'null' };
            }
            
            if (typeof cell === 'object') {
                try {
                    // Format JSON with proper indentation for tooltip
                    const jsonString = JSON.stringify(cell, null, 2);
                    
                    // Create a compact display version for the cell
                    const compactJson = JSON.stringify(cell);
                    
                    // Truncate display if too long
                    const maxDisplayLength = 100;
                    let displayValue = compactJson.length > maxDisplayLength 
                        ? compactJson.substring(0, maxDisplayLength) + '...' 
                        : compactJson;
                    
                    // Add JSON styling
                    displayValue = '<span class="json-content">' + escapeHtml(displayValue) + '</span>';
                    
                    return {
                        displayValue: displayValue,
                        tooltipValue: jsonString
                    };
                } catch (error) {
                    // If JSON.stringify fails, fall back to string conversion
                    const stringValue = String(cell);
                    return {
                        displayValue: escapeHtml(stringValue),
                        tooltipValue: stringValue
                    };
                }
            }
            
            // For non-object values, use as-is
            const stringValue = String(cell);
            return {
                displayValue: escapeHtml(stringValue),
                tooltipValue: stringValue
            };
        }

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
                ' • ' + result.executionTimeMs + 'ms' : '';
            resultsInfo.textContent = result.totalRecords + ' results' + executionTimeText + ' • ' + new Date(result.timestamp).toLocaleString();
            exportBtn.style.display = 'block';
            
            let tableHtml = '<table class="results-table"><thead><tr>';
            
            result.columns.forEach((col, index) => {
                const sortClass = sortState.column === index ? 
                    (sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
                tableHtml += '<th class="' + sortClass + '" ' +
                    'draggable="true" ' +
                    'data-col-index="' + index + '" ' +
                    'onclick="handleHeaderClick(event, ' + index + ')" ' +
                    'ondragstart="handleDragStart(event, ' + index + ')"' +
                    'ondragover="handleDragOver(event)"' +
                    'ondrop="handleDrop(event, ' + index + ')"' +
                    'ondragend="handleDragEnd(event)"' +
                    'style="width: ' + (col.width || 'auto') + ';"' +
                    'title="' + col.name + '">' +
                    '<span class="header-text">' + col.name + '</span>' +
                    '<div class="resize-handle" onmousedown="startResize(event, ' + index + ')"></div>' +
                '</th>';
            });
            
            tableHtml += '</tr></thead><tbody>';
            
            result.data.forEach((row, rowIndex) => {
                tableHtml += '<tr>';
                row.forEach((cell, cellIndex) => {
                    const { displayValue, tooltipValue } = formatCellValue(cell);
                    // Store tooltip data as data attribute - tooltipValue is already safe
                    tableHtml += '<td data-tooltip="' + tooltipValue.replace(/"/g, '&quot;') + '" ' +
                        'onclick="selectCell(this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                        'onmousedown="startCellDrag(event, this, ' + rowIndex + ', ' + cellIndex + ')"' +
                        'onmouseenter="handleCellDragEnter(event, this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                        'onmouseleave="hideCustomTooltipDelayed()" ' +
                        'data-row="' + rowIndex + '" ' +
                        'data-col="' + cellIndex + '">' + displayValue + '</td>';
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            tableContainer.innerHTML = tableHtml;
            
            // Add context menu event listener to the table
            const table = tableContainer.querySelector('.results-table');
            if (table) {
                table.addEventListener('contextmenu', handleTableContextMenu);
            }
        }

        // Loading indicator functionality
        const loadingMessages = [
            "Finding Azure treasures...",
            "Sailing the cloudy seas...",
            "Mapping uncharted resources…",
            "Charting resource providers...",
            "Plundering key vaults...",
            "Investigating secrets...",
            "Exploring landing zones...",
            "Following effective routes...",
            "Opening route maps...",
            "Digging for hidden properties...",
            "Navigating configuration drift..."
        ];

        function getRandomLoadingMessage() {
            return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
        }

        function showLoadingIndicator() {
            const tableContainer = document.getElementById('tableContainer');
            if (!tableContainer) return;
            
            // Remove any existing loading overlay
            hideLoadingIndicator();
            
            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.id = 'loadingOverlay';
            
            const randomMessage = getRandomLoadingMessage();
            
            loadingOverlay.innerHTML = 
                '<div class="loading-content">' +
                    '<div class="loading-animation">' +
                        '<img src="' + loadingGifUri + '" alt="Loading..." />' +
                    '</div>' +
                    '<div class="loading-message">' + randomMessage + '</div>' +
                '</div>';
            
            tableContainer.style.position = 'relative';
            tableContainer.appendChild(loadingOverlay);
        }

        function hideLoadingIndicator() {
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.remove();
            }
        }

        // Custom tooltip functionality
        let customTooltip = null;
        let tooltipTimeout = null;
        let hideTooltipTimeout = null;

        function createTooltip() {
            if (!customTooltip) {
                customTooltip = document.createElement('div');
                customTooltip.className = 'custom-tooltip';
                
                // Add mouse events to tooltip for interactivity
                customTooltip.addEventListener('mouseenter', function() {
                    // Cancel any pending hide when mouse enters tooltip
                    if (hideTooltipTimeout) {
                        clearTimeout(hideTooltipTimeout);
                        hideTooltipTimeout = null;
                    }
                });
                
                customTooltip.addEventListener('mouseleave', function(e) {
                    // Don't hide tooltip if mouse is moving to the context menu
                    // Check if the related target (where mouse is going) is the context menu
                    if (contextMenuVisible && customContextMenu && 
                        (customContextMenu.contains(e.relatedTarget) || e.relatedTarget === customContextMenu)) {
                        return;
                    }
                    
                    // Hide tooltip when mouse leaves tooltip
                    hideCustomTooltipDelayed();
                });
                
                // Custom context menu for tooltip with just Copy option
                customTooltip.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Only show context menu if there's text selected in the tooltip
                    const selection = window.getSelection();
                    if (selection && selection.toString().length > 0) {
                        showTooltipContextMenu(e);
                    }
                });
                
                document.body.appendChild(customTooltip);
            }
            return customTooltip;
        }

        function showCustomTooltip(event, element) {
            // Don't show tooltip if context menu is visible
            if (contextMenuVisible) {
                return;
            }
            
            const tooltip = createTooltip();
            const tooltipText = element.getAttribute('data-tooltip');
            
            if (!tooltipText || tooltipText.trim() === '') {
                // Don't show tooltip if content is empty
                hideCustomTooltip();
                return;
            }
            
            // Clear any existing timeouts
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
            if (hideTooltipTimeout) {
                clearTimeout(hideTooltipTimeout);
                hideTooltipTimeout = null;
            }
            
            tooltip.textContent = tooltipText;
            
            // Add JSON class if content looks like JSON
            if (tooltipText.trim().startsWith('{') || tooltipText.trim().startsWith('[')) {
                tooltip.classList.add('json');
            } else {
                tooltip.classList.remove('json');
            }
            
            // Position tooltip anchored to the cell, not cursor
            positionTooltipToCell(element, tooltip);
            
            // Show tooltip immediately
            tooltip.classList.add('show');
            
            // Check if tooltip has scrollable content (vertical or horizontal) and make it interactive
            setTimeout(() => {
                const hasVerticalScroll = tooltip.scrollHeight > tooltip.clientHeight;
                const hasHorizontalScroll = tooltip.scrollWidth > tooltip.clientWidth;
                
                if (hasVerticalScroll || hasHorizontalScroll) {
                    tooltip.classList.add('interactive');
                } else {
                    tooltip.classList.remove('interactive');
                }
            }, 0);
        }

        function positionTooltipToCell(cellElement, tooltip) {
            // Get cell dimensions and position
            const cellRect = cellElement.getBoundingClientRect();
            const offset = 2; // Smaller offset for tighter positioning
            
            // Get viewport dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Set initial position to measure tooltip dimensions
            tooltip.style.left = '0px';
            tooltip.style.top = '0px';
            tooltip.style.visibility = 'hidden';
            tooltip.style.display = 'block';
            
            // Get tooltip dimensions after it's rendered
            const tooltipRect = tooltip.getBoundingClientRect();
            const tooltipWidth = tooltipRect.width;
            const tooltipHeight = tooltipRect.height;
            
            // Reset visibility
            tooltip.style.visibility = 'visible';
            
            // Calculate primary anchor point: right 10% of cell horizontally, top of cell vertically
            const rightAnchorX = cellRect.left + (cellRect.width * 0.90);
            const anchorY = cellRect.top;
            
            // Try positioning tooltip's top-left corner at the right anchor point first
            let left = rightAnchorX + offset;
            let top = anchorY;
            
            // Check if tooltip would go off-screen to the right
            if (left + tooltipWidth > viewportWidth - offset) {
                // Position to the left using left 10% anchor point
                const leftAnchorX = cellRect.left + (cellRect.width * 0.1);
                left = leftAnchorX - tooltipWidth - offset;
            }
            
            // Final fallback: ensure tooltip doesn't go off-screen to the left
            if (left < offset) {
                left = offset;
            }
            
            // Adjust vertical position if tooltip would go off-screen
            if (top < offset) {
                top = offset;
            } else if (top + tooltipHeight > viewportHeight - offset) {
                top = viewportHeight - tooltipHeight - offset;
            }
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        }

        function hideCustomTooltip() {
            if (customTooltip) {
                customTooltip.classList.remove('show');
                customTooltip.classList.remove('interactive');
                
                // Remove tooltip after transition
                tooltipTimeout = setTimeout(() => {
                    if (customTooltip && !customTooltip.classList.contains('show')) {
                        customTooltip.textContent = '';
                    }
                }, 150); // Match transition duration
            }
        }
        
        function hideCustomTooltipDelayed() {
            // Don't hide tooltip if context menu is visible
            if (contextMenuVisible) {
                return;
            }
            
            // Add a small delay to allow mouse to move from cell to tooltip
            hideTooltipTimeout = setTimeout(() => {
                hideCustomTooltip();
            }, 100);
        }

        // Tooltip context menu functionality
        let tooltipContextMenu = null;
        let storedTooltipSelection = null; // Store the selection text when right-clicking
        
        function showTooltipContextMenu(event) {
            // Store the current selection before any menu operations
            const selection = window.getSelection();
            storedTooltipSelection = selection && selection.toString().length > 0 ? selection.toString() : null;
            
            // Hide any existing context menus
            hideContextMenu();
            hideTooltipContextMenu();
            
            const tooltipMenu = createTooltipContextMenu();
            positionContextMenu(event, tooltipMenu);
            
            // Set the context menu as visible
            contextMenuVisible = true;
            
            // Add event listeners to hide menu when clicking outside or pressing Escape
            setTimeout(() => {
                document.addEventListener('click', hideTooltipContextMenu, { once: true });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        hideTooltipContextMenu();
                    }
                }, { once: true });
            }, 0);
        }

        function createTooltipContextMenu() {
            // Remove existing tooltip menu if any
            if (tooltipContextMenu) {
                document.body.removeChild(tooltipContextMenu);
            }
            
            tooltipContextMenu = document.createElement('div');
            tooltipContextMenu.className = 'custom-context-menu';
            
            // Prevent clicks on the menu itself from closing it
            tooltipContextMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            // Handle mouse leave from context menu
            tooltipContextMenu.addEventListener('mouseleave', (e) => {
                // If mouse is going back to tooltip, don't hide anything
                if (customTooltip && customTooltip.contains(e.relatedTarget)) {
                    return;
                }
                
                // If mouse is going somewhere else, hide the tooltip after a short delay
                setTimeout(() => {
                    if (!contextMenuVisible) {
                        hideCustomTooltipDelayed();
                    }
                }, 50);
            });
            
            // Copy option for selected text in tooltip
            const copyItem = document.createElement('div');
            copyItem.className = 'context-menu-item';
            copyItem.innerHTML = '<span>Copy</span>';
            copyItem.addEventListener('click', () => {
                copyTooltipSelection();
                hideTooltipContextMenu();
            });
            
            tooltipContextMenu.appendChild(copyItem);
            document.body.appendChild(tooltipContextMenu);
            
            return tooltipContextMenu;
        }

        function hideTooltipContextMenu() {
            if (tooltipContextMenu) {
                document.body.removeChild(tooltipContextMenu);
                tooltipContextMenu = null;
            }
            // Reset context menu visibility flag
            contextMenuVisible = false;
        }

        function copyTooltipSelection() {
            // Use the stored selection from when the context menu was opened
            const selectedText = storedTooltipSelection;
            
            if (selectedText && selectedText.length > 0) {
                // Copy to clipboard
                navigator.clipboard.writeText(selectedText).then(() => {
                    // Clear the stored selection
                    storedTooltipSelection = null;
                    // Hide the tooltip context menu since we've completed the action
                    hideTooltipContextMenu();
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = selectedText;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    // Clear stored selection and hide menu
                    storedTooltipSelection = null;
                    hideTooltipContextMenu();
                });
            }
        }

        // Cell selection functionality
        let selectedCells = new Set();
        let isSelecting = false;
        let selectionStart = null;
        let isDragging = false;
        let dragStartCell = null;
        let dragCurrentCell = null;

        function selectCell(cellElement, row, col) {
            // Don't handle click if we just finished a drag operation
            if (isDragging) {
                return;
            }
            
            if (event.ctrlKey || event.metaKey) {
                // Ctrl/Cmd click for multi-select
                toggleCellSelection(cellElement, row, col);
            } else if (event.shiftKey && selectionStart) {
                // Shift click for range selection
                selectRange(selectionStart.row, selectionStart.col, row, col);
            } else {
                // Regular click - clear previous selection and select this cell
                clearSelection();
                toggleCellSelection(cellElement, row, col);
                selectionStart = { row, col };
            }
        }

        function toggleCellSelection(cellElement, row, col) {
            const cellKey = row + '-' + col;
            if (selectedCells.has(cellKey)) {
                selectedCells.delete(cellKey);
                cellElement.classList.remove('selected');
            } else {
                selectedCells.add(cellKey);
                cellElement.classList.add('selected');
            }
        }

        function selectRange(startRow, startCol, endRow, endCol) {
            clearSelection();
            
            const minRow = Math.min(startRow, endRow);
            const maxRow = Math.max(startRow, endRow);
            const minCol = Math.min(startCol, endCol);
            const maxCol = Math.max(startCol, endCol);
            
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    const cellElement = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
                    if (cellElement) {
                        const cellKey = r + '-' + c;
                        selectedCells.add(cellKey);
                        cellElement.classList.add('selected');
                    }
                }
            }
        }

        function clearSelection() {
            selectedCells.clear();
            document.querySelectorAll('.results-table td.selected').forEach(cell => {
                cell.classList.remove('selected');
            });
        }

        // Drag selection functionality
        function startCellDrag(event, cellElement, row, col) {
            // Don't start drag if it's a right-click (we want context menu)
            if (event.button === 2) {
                return;
            }
            
            // Prevent text selection during drag
            event.preventDefault();
            document.body.style.userSelect = 'none';
            
            isDragging = true;
            dragStartCell = { row, col, element: cellElement };
            dragCurrentCell = { row, col, element: cellElement };
            
            // Clear previous selection if not using Ctrl/Cmd
            if (!event.ctrlKey && !event.metaKey) {
                clearSelection();
            }
            
            // Select the starting cell
            toggleCellSelection(cellElement, row, col);
            selectionStart = { row, col };
            
            // Add document-level mouse up listener to end drag
            document.addEventListener('mouseup', endCellDrag, { once: true });
            
            // Prevent the default click handler from firing
            event.stopPropagation();
        }

        function handleCellDragEnter(event, cellElement, row, col) {
            // Only handle tooltip if we're not dragging
            if (!isDragging) {
                showCustomTooltip(event, cellElement);
                return;
            }
            
            // Handle drag selection
            if (isDragging && dragStartCell) {
                dragCurrentCell = { row, col, element: cellElement };
                
                // Clear current selection (but keep Ctrl/Cmd behavior)
                if (!event.ctrlKey && !event.metaKey) {
                    clearSelection();
                }
                
                // Select range from start to current cell
                selectRange(dragStartCell.row, dragStartCell.col, row, col);
            }
        }

        function endCellDrag(event) {
            if (isDragging) {
                isDragging = false;
                dragStartCell = null;
                dragCurrentCell = null;
                
                // Re-enable text selection
                document.body.style.userSelect = '';
            }
        }

        // Custom context menu functionality
        let customContextMenu = null;
        let rightClickedCell = null; // Track the cell that was right-clicked
        let contextMenuVisible = false; // Track if context menu is showing

        function handleTableContextMenu(event) {
            event.preventDefault();
            
            // Find the cell that was right-clicked
            const target = event.target.closest('td');
            
            if (!target) return;
            
            // Get row and column from data attributes
            const rowAttr = target.getAttribute('data-row');
            const colAttr = target.getAttribute('data-col');
            
            if (rowAttr === null || colAttr === null) return;
            
            const row = parseInt(rowAttr);
            const col = parseInt(colAttr);
            
            if (isNaN(row) || isNaN(col)) return;
            
            // Store the right-clicked cell info
            rightClickedCell = {
                element: target,
                row: row,
                col: col
            };
            
            // Smart selection logic
            const cellKey = row + '-' + col;
            const isRightClickedCellSelected = selectedCells.has(cellKey);
            
            if (selectedCells.size <= 1) {
                // If we have 0 or 1 cells selected, select the right-clicked cell
                selectCell(target, row, col);
            } else if (selectedCells.size > 1 && !isRightClickedCellSelected) {
                // If we have multiple cells selected but right-clicked outside the selection,
                // clear selection and select just the right-clicked cell
                clearSelection();
                selectCell(target, row, col);
            }
            // If multiple cells selected and right-clicked on one of them, keep current selection
            
            // Hide tooltip and its context menu when showing cell context menu
            hideCustomTooltip();
            hideTooltipContextMenu();
            
            // Hide any existing cell context menu
            if (customContextMenu) {
                document.body.removeChild(customContextMenu);
                customContextMenu = null;
            }
            
            // Create context menu
            const contextMenu = createContextMenu();
            
            // Position and show context menu
            positionContextMenu(event, contextMenu);
            
            // Set flag that context menu is visible
            contextMenuVisible = true;
            
            // Add click outside listener to close menu
            setTimeout(() => {
                document.addEventListener('click', hideContextMenu, { once: true });
                document.addEventListener('keydown', handleContextMenuKeydown, { once: true });
            }, 0);
        }
        
        function handleContextMenuKeydown(event) {
            if (event.key === 'Escape') {
                hideContextMenu();
            }
        }

        function createContextMenu() {
            if (customContextMenu) {
                document.body.removeChild(customContextMenu);
            }
            
            customContextMenu = document.createElement('div');
            customContextMenu.className = 'custom-context-menu';
            
            // Prevent clicks on the menu itself from closing it
            customContextMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            // Check if we have a valid right-clicked cell
            let hasValidRightClick = false;
            let hasJsonCell = false;
            let rightClickedCellKey = null;
            let cellIsNull = false;
            
            if (rightClickedCell && currentResults && currentResults.data) {
                const { row, col } = rightClickedCell;
                
                if (currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                    const cellValue = currentResults.data[row][col];
                    cellIsNull = cellValue === null || cellValue === undefined;
                    hasValidRightClick = !cellIsNull; // Only valid if not null
                    rightClickedCellKey = row + '-' + col;
                    if (typeof cellValue === 'object' && cellValue !== null) {
                        hasJsonCell = true;
                    }
                }
            }
            
            // Check if right-clicked cell is part of current selection
            const hasSelection = selectedCells.size > 0;
            const rightClickedSelectedCell = hasSelection && rightClickedCellKey && selectedCells.has(rightClickedCellKey);
            
            // Check if any selected cells contain JSON (for formatted copy option)
            let hasSelectedJsonCells = false;
            if (hasSelection) {
                selectedCells.forEach(cellKey => {
                    const [row, col] = cellKey.split('-').map(Number);
                    if (currentResults && currentResults.data && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                        const cellValue = currentResults.data[row][col];
                        if (typeof cellValue === 'object' && cellValue !== null) {
                            hasSelectedJsonCells = true;
                        }
                    }
                });
            }
            
            // Copy single cell option (disabled if cell is null OR if multiple cells are selected)
            let copyItem = null;
            const hasMultipleSelected = rightClickedSelectedCell && hasSelection && selectedCells.size > 1;
            
            // Only show single cell copy if we don't have multiple cells selected
            if (!hasMultipleSelected) {
                copyItem = document.createElement('div');
                copyItem.className = 'context-menu-item ' + (hasValidRightClick ? '' : 'disabled');
                copyItem.innerHTML = '<span>Copy</span>';
                copyItem.addEventListener('click', () => {
                    if (hasValidRightClick) {
                        copyRightClickedCell();
                        hideContextMenu();
                    }
                });
            }
            
            // Copy selection option (only if right-clicked on a selected cell and there are multiple selected)
            let copySelectionItem = null;
            if (rightClickedSelectedCell && hasSelection && selectedCells.size > 1) {
                copySelectionItem = document.createElement('div');
                copySelectionItem.className = 'context-menu-item';
                copySelectionItem.innerHTML = '<span>Copy Selection (' + selectedCells.size + ' cells)</span>';
                copySelectionItem.addEventListener('click', () => {
                    copySelectedCells();
                    hideContextMenu();
                });
            }
            
            // Copy with headers option (only if right-clicked on a selected cell with multiple selections)
            let copyWithHeadersItem = null;
            if (rightClickedSelectedCell && hasSelection && selectedCells.size > 1) {
                copyWithHeadersItem = document.createElement('div');
                copyWithHeadersItem.className = 'context-menu-item';
                copyWithHeadersItem.innerHTML = '<span>Copy Selection with Headers</span>';
                copyWithHeadersItem.addEventListener('click', () => {
                    copySelectedCellsWithHeaders();
                    hideContextMenu();
                });
            }
            
            // Copy formatted option for single cell (only show if right-clicked cell contains JSON AND not in multi-selection context)
            let copyFormattedItem = null;
            if (hasJsonCell && !(rightClickedSelectedCell && selectedCells.size > 1)) {
                copyFormattedItem = document.createElement('div');
                copyFormattedItem.className = 'context-menu-item';
                copyFormattedItem.innerHTML = '<span>Copy Formatted</span>';
                copyFormattedItem.addEventListener('click', () => {
                    copyRightClickedCellFormatted();
                    hideContextMenu();
                });
            }
            
            // Copy selection formatted option - REMOVED per user request
            // Don't show formatted option for multi-cell selections
            let copySelectionFormattedItem = null;
            
            // Add all menu items
            if (copyItem) {
                customContextMenu.appendChild(copyItem);
            }
            if (copySelectionItem) {
                customContextMenu.appendChild(copySelectionItem);
            }
            if (copyWithHeadersItem) {
                customContextMenu.appendChild(copyWithHeadersItem);
            }
            if (copyFormattedItem) {
                customContextMenu.appendChild(copyFormattedItem);
            }
            if (copySelectionFormattedItem) {
                customContextMenu.appendChild(copySelectionFormattedItem);
            }
            
            document.body.appendChild(customContextMenu);
            return customContextMenu;
        }

        function positionContextMenu(event, menu) {
            const mouseX = event.clientX;
            const mouseY = event.clientY;
            
            // Get viewport dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Set initial position to measure menu dimensions
            menu.style.left = '0px';
            menu.style.top = '0px';
            menu.style.visibility = 'hidden';
            menu.style.display = 'block';
            
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;
            
            // Calculate position
            let left = mouseX;
            let top = mouseY;
            
            // Adjust if menu would go off-screen
            if (left + menuWidth > viewportWidth) {
                left = mouseX - menuWidth;
            }
            
            if (top + menuHeight > viewportHeight) {
                top = mouseY - menuHeight;
            }
            
            // Ensure menu doesn't go off-screen
            left = Math.max(0, left);
            top = Math.max(0, top);
            
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
            menu.style.visibility = 'visible';
        }

        function hideContextMenu() {
            if (customContextMenu) {
                document.body.removeChild(customContextMenu);
                customContextMenu = null;
            }
            // Reset the right-clicked cell when menu is actually hidden
            rightClickedCell = null;
            // Reset context menu visibility flag
            contextMenuVisible = false;
            // Remove any lingering event listeners
            document.removeEventListener('keydown', handleContextMenuKeydown);
        }

        function copySelectedCellsWithHeaders() {
            if (selectedCells.size === 0) return;
            
            // Get all selected cells with their positions
            const cellData = [];
            selectedCells.forEach(cellKey => {
                const [row, col] = cellKey.split('-').map(Number);
                if (currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                    cellData.push({
                        row,
                        col,
                        value: currentResults.data[row][col] || ''
                    });
                }
            });
            
            if (cellData.length === 0) return;
            
            // Sort by row then by column
            cellData.sort((a, b) => a.row - b.row || a.col - b.col);
            
            // Get unique columns and their headers
            const uniqueCols = [...new Set(cellData.map(cell => cell.col))].sort((a, b) => a - b);
            const headers = uniqueCols.map(colIndex => {
                return currentResults && currentResults.columns[colIndex] 
                    ? currentResults.columns[colIndex].name 
                    : 'Column ' + colIndex;
            });
            
            // Group by rows
            const rowGroups = {};
            cellData.forEach(cell => {
                if (!rowGroups[cell.row]) {
                    rowGroups[cell.row] = {};
                }
                // Format the cell value for copying
                let copyValue = cell.value;
                if (typeof copyValue === 'object' && copyValue !== null) {
                    copyValue = JSON.stringify(copyValue);
                }
                rowGroups[cell.row][cell.col] = copyValue || '';
            });
            
            // Create header row
            const headerRow = headers.join('\\t');
            
            // Create data rows
            const rows = Object.keys(rowGroups).sort((a, b) => Number(a) - Number(b));
            const dataRows = rows.map(rowIndex => {
                const row = rowGroups[rowIndex];
                return uniqueCols.map(colIndex => String(row[colIndex] || '')).join('\\t');
            });
            
            // Combine header and data
            const copyText = [headerRow, ...dataRows].join('\\n');
            
            // Copy to clipboard
            navigator.clipboard.writeText(copyText).then(() => {
                showCopyFeedback('with headers');
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                fallbackCopyTextToClipboard(copyText);
            });
        }

        function copySelectedCellsFormatted() {
            if (selectedCells.size === 0) return;
            
            // Get all selected cells with their positions
            const cellData = [];
            selectedCells.forEach(cellKey => {
                const [row, col] = cellKey.split('-').map(Number);
                if (currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                    cellData.push({
                        row,
                        col,
                        value: currentResults.data[row][col] || ''
                    });
                }
            });
            
            if (cellData.length === 0) return;
            
            // Sort by row then by column
            cellData.sort((a, b) => a.row - b.row || a.col - b.col);
            
            // Format cells for copying - use formatted JSON for objects, regular text for others
            const formattedCells = cellData.map(cell => {
                let copyValue = cell.value;
                if (typeof copyValue === 'object' && copyValue !== null) {
                    // Use formatted JSON (like in tooltip) for objects
                    try {
                        copyValue = JSON.stringify(copyValue, null, 2);
                    } catch (error) {
                        copyValue = String(copyValue);
                    }
                } else {
                    copyValue = String(copyValue || '');
                }
                return copyValue;
            });
            
            // Join with newlines for multi-cell selection, or just return single cell
            const copyText = formattedCells.join('\\n\\n');
            
            // Copy to clipboard
            navigator.clipboard.writeText(copyText).then(() => {
                showCopyFeedback('formatted');
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                fallbackCopyTextToClipboard(copyText);
            });
        }

        function copyRightClickedCell() {
            if (!rightClickedCell || !currentResults || !currentResults.data ||
                isNaN(rightClickedCell.row) || isNaN(rightClickedCell.col) ||
                rightClickedCell.row < 0 || rightClickedCell.col < 0 ||
                rightClickedCell.row >= currentResults.data.length ||
                rightClickedCell.col >= (currentResults.data[rightClickedCell.row] || []).length) {
                return;
            }
            
            const cellValue = currentResults.data[rightClickedCell.row][rightClickedCell.col];
            let copyValue = cellValue;
            
            // Format the cell value for copying
            if (typeof copyValue === 'object' && copyValue !== null) {
                copyValue = JSON.stringify(copyValue);
            } else {
                copyValue = String(copyValue || '');
            }
            
            // Copy to clipboard
            navigator.clipboard.writeText(copyValue).then(() => {
                showCopyFeedback('');
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                fallbackCopyTextToClipboard(copyValue);
            });
        }

        function copyRightClickedCellFormatted() {
            if (!rightClickedCell || !currentResults || !currentResults.data ||
                isNaN(rightClickedCell.row) || isNaN(rightClickedCell.col) ||
                rightClickedCell.row < 0 || rightClickedCell.col < 0 ||
                rightClickedCell.row >= currentResults.data.length ||
                rightClickedCell.col >= (currentResults.data[rightClickedCell.row] || []).length) {
                return;
            }
            
            const cellValue = currentResults.data[rightClickedCell.row][rightClickedCell.col];
            let copyValue = cellValue;
            
            // Format the cell value for copying
            if (typeof copyValue === 'object' && copyValue !== null) {
                // Use formatted JSON (like in tooltip) for objects
                try {
                    copyValue = JSON.stringify(copyValue, null, 2);
                } catch (error) {
                    copyValue = String(copyValue);
                }
            } else {
                copyValue = String(copyValue || '');
            }
            
            // Copy to clipboard
            navigator.clipboard.writeText(copyValue).then(() => {
                showCopyFeedback('formatted');
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                fallbackCopyTextToClipboard(copyValue);
            });
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
                        filename: 'barge-results-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv'
                    } 
                });
            }
        }

        function selectRange(startRow, startCol, endRow, endCol) {
            clearSelection();
            
            const minRow = Math.min(startRow, endRow);
            const maxRow = Math.max(startRow, endRow);
            const minCol = Math.min(startCol, endCol);
            const maxCol = Math.max(startCol, endCol);
            
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    const cellElement = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
                    if (cellElement) {
                        const cellKey = r + '-' + c;
                        selectedCells.add(cellKey);
                        cellElement.classList.add('selected');
                    }
                }
            }
        }

        function clearSelection() {
            selectedCells.clear();
            document.querySelectorAll('.results-table td.selected').forEach(cell => {
                cell.classList.remove('selected');
            });
        }

        // Drag selection functionality
        function startCellDrag(event, cellElement, row, col) {
            // Don't start drag if it's a right-click (we want context menu)
            if (event.button === 2) {
                return;
            }
            
            // Prevent text selection during drag
            event.preventDefault();
            document.body.style.userSelect = 'none';
            
            isDragging = true;
            dragStartCell = { row, col, element: cellElement };
            dragCurrentCell = { row, col, element: cellElement };
            
            // Clear previous selection if not using Ctrl/Cmd
            if (!event.ctrlKey && !event.metaKey) {
                clearSelection();
            }
            
            // Select the starting cell
            toggleCellSelection(cellElement, row, col);
            selectionStart = { row, col };
            
            // Add document-level mouse up listener to end drag
            document.addEventListener('mouseup', endCellDrag, { once: true });
            
            // Prevent the default click handler from firing
            event.stopPropagation();
        }

        function handleCellDragEnter(event, cellElement, row, col) {
            // Only handle tooltip if we're not dragging
            if (!isDragging) {
                showCustomTooltip(event, cellElement);
                return;
            }
            
            // Handle drag selection
            if (isDragging && dragStartCell) {
                dragCurrentCell = { row, col, element: cellElement };
                
                // Clear current selection (but keep Ctrl/Cmd behavior)
                if (!event.ctrlKey && !event.metaKey) {
                    clearSelection();
                }
                
                // Select range from start to current cell
                selectRange(dragStartCell.row, dragStartCell.col, row, col);
            }
        }

        function endCellDrag(event) {
            if (isDragging) {
                isDragging = false;
                dragStartCell = null;
                dragCurrentCell = null;
                
                // Re-enable text selection
                document.body.style.userSelect = '';
            }
        }

        // Add keyboard support for cell selection
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                clearSelection();
                hideContextMenu(); // Also hide context menu on Escape
            } else if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
                // Ctrl/Cmd+A to select all cells
                event.preventDefault();
                selectAllCells();
            } else if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
                // Ctrl/Cmd+C to copy selected cells
                event.preventDefault();
                copySelectedCells();
            }
        });

        function copySelectedCells() {
            if (selectedCells.size === 0) return;
            
            // Get all selected cells with their positions
            const cellData = [];
            selectedCells.forEach(cellKey => {
                const [row, col] = cellKey.split('-').map(Number);
                const cellElement = document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]');
                if (cellElement && currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                    cellData.push({
                        row,
                        col,
                        value: currentResults.data[row][col] || ''
                    });
                }
            });
            
            if (cellData.length === 0) return;
            
            // Sort by row then by column
            cellData.sort((a, b) => a.row - b.row || a.col - b.col);
            
            // Group by rows and create tab-separated text
            const rowGroups = {};
            cellData.forEach(cell => {
                if (!rowGroups[cell.row]) {
                    rowGroups[cell.row] = {};
                }
                // Format the cell value for copying (use raw value for objects, formatted for display)
                let copyValue = cell.value;
                if (typeof copyValue === 'object' && copyValue !== null) {
                    copyValue = JSON.stringify(copyValue);
                }
                rowGroups[cell.row][cell.col] = copyValue || '';
            });
            
            // Convert to tab-separated format
            const rows = Object.keys(rowGroups).sort((a, b) => Number(a) - Number(b));
            const copyText = rows.map(rowIndex => {
                const row = rowGroups[rowIndex];
                const cols = Object.keys(row).sort((a, b) => Number(a) - Number(b));
                
                // If it's a single row selection, just join the values with tabs
                if (rows.length === 1) {
                    return cols.map(colIndex => String(row[colIndex] || '')).join('\\t');
                }
                
                // For multiple rows, we need to handle gaps in column selection
                const minCol = Math.min(...cols.map(Number));
                const maxCol = Math.max(...cols.map(Number));
                const rowData = [];
                
                for (let i = minCol; i <= maxCol; i++) {
                    rowData.push(String(row[i] || ''));
                }
                
                return rowData.join('\\t');
            }).join('\\n');
            
            // Copy to clipboard
            navigator.clipboard.writeText(copyText).then(() => {
                // Visual feedback that copy was successful
                showCopyFeedback();
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                // Fallback for older browsers
                fallbackCopyTextToClipboard(copyText);
            });
        }
        
        function fallbackCopyTextToClipboard(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
                showCopyFeedback();
            } catch (err) {
                console.error('Fallback copy failed:', err);
            }
            
            document.body.removeChild(textArea);
        }
        
        function showCopyFeedback(type = '') {
            // Create temporary visual feedback
            const feedback = document.createElement('div');
            const cellCount = selectedCells.size;
            const typeText = type ? ' ' + type : '';
            feedback.textContent = 'Copied ' + cellCount + ' cell' + (cellCount === 1 ? '' : 's') + typeText;
            feedback.style.position = 'fixed';
            feedback.style.top = '10px';
            feedback.style.right = '10px';
            feedback.style.background = 'var(--vscode-notifications-background)';
            feedback.style.color = 'var(--vscode-notifications-foreground)';
            feedback.style.padding = '8px 12px';
            feedback.style.borderRadius = '4px';
            feedback.style.border = '1px solid var(--vscode-notifications-border)';
            feedback.style.fontSize = '0.9em';
            feedback.style.zIndex = '1000';
            feedback.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            
            document.body.appendChild(feedback);
            
            // Remove after 2 seconds
            setTimeout(() => {
                if (feedback.parentNode) {
                    document.body.removeChild(feedback);
                }
            }, 2000);
        }

        function selectAllCells() {
            clearSelection();
            document.querySelectorAll('.results-table td[data-row]').forEach(cell => {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                const cellKey = row + '-' + col;
                selectedCells.add(cellKey);
                cell.classList.add('selected');
            });
        }

        // Column resizing functionality
        let isResizing = false;
        let currentResizeColumn = null;
        let startX = 0;
        let startWidth = 0;

        function startResize(event, columnIndex) {
            event.stopPropagation();
            event.preventDefault();
            
            isResizing = true;
            currentResizeColumn = columnIndex;
            startX = event.clientX;
            
            const th = event.target.closest('th');
            startWidth = th.offsetWidth;
            
            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', stopResize);
            
            // Prevent text selection during resize
            document.body.style.userSelect = 'none';
        }

        function handleResize(event) {
            if (!isResizing || currentResizeColumn === null) return;
            
            const diff = event.clientX - startX;
            const newWidth = Math.max(60, startWidth + diff); // Minimum width of 60px
            
            const th = document.querySelector('th[data-col-index="' + currentResizeColumn + '"]');
            if (th) {
                th.style.width = newWidth + 'px';
                
                // Store the width in our data
                if (currentResults && currentResults.columns[currentResizeColumn]) {
                    currentResults.columns[currentResizeColumn].width = newWidth + 'px';
                }
            }
        }

        function stopResize() {
            isResizing = false;
            currentResizeColumn = null;
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.userSelect = '';
        }

        // Column drag and drop functionality
        let draggedColumn = null;

        function handleHeaderClick(event, columnIndex) {
            // Only sort if we're not clicking on the resize handle
            if (!event.target.classList.contains('resize-handle')) {
                sortTable(columnIndex);
            }
        }

        function handleDragStart(event, columnIndex) {
            // Don't start drag if we're on the resize handle
            if (event.target.classList.contains('resize-handle')) {
                event.preventDefault();
                return;
            }
            
            draggedColumn = columnIndex;
            event.target.classList.add('dragging');
            
            // Set drag data
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/html', event.target.outerHTML);
        }

        function handleDragOver(event) {
            if (draggedColumn === null) return;
            
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            
            const th = event.target.closest('th');
            if (th && th !== event.target.closest('table').querySelector('.dragging')) {
                // Remove previous drag-over classes
                document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                th.classList.add('drag-over');
            }
        }

        function handleDrop(event, targetColumnIndex) {
            event.preventDefault();
            
            if (draggedColumn === null || draggedColumn === targetColumnIndex) {
                return;
            }
            
            // Reorder the columns in our data
            reorderColumn(draggedColumn, targetColumnIndex);
            
            // Clear drag states
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }

        function handleDragEnd(event) {
            event.target.classList.remove('dragging');
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            draggedColumn = null;
        }

        function reorderColumn(fromIndex, toIndex) {
            if (!currentResults || !currentResults.columns || !currentResults.data) return;
            
            // Reorder columns metadata
            const columns = [...currentResults.columns];
            const [movedColumn] = columns.splice(fromIndex, 1);
            columns.splice(toIndex, 0, movedColumn);
            
            // Reorder data
            const data = currentResults.data.map(row => {
                const newRow = [...row];
                const [movedCell] = newRow.splice(fromIndex, 1);
                newRow.splice(toIndex, 0, movedCell);
                return newRow;
            });
            
            // Update our current results
            currentResults = {
                ...currentResults,
                columns,
                data
            };
            
            // Update sort state if needed
            if (sortState.column !== null) {
                if (sortState.column === fromIndex) {
                    sortState.column = toIndex;
                } else if (fromIndex < toIndex && sortState.column > fromIndex && sortState.column <= toIndex) {
                    sortState.column--;
                } else if (fromIndex > toIndex && sortState.column >= toIndex && sortState.column < fromIndex) {
                    sortState.column++;
                }
            }
            
            // Clear selection since column indices have changed
            clearSelection();
            
            // Re-render the table
            displayResults(currentResults);
        }

        function displayError(error) {
            const tableContainer = document.getElementById('tableContainer');
            const resultsInfo = document.getElementById('resultsInfo');
            const exportBtn = document.getElementById('exportBtn');
            
            tableContainer.innerHTML = '<div class="error">Error: ' + error + '</div>';
            resultsInfo.textContent = 'Query failed';
            exportBtn.style.display = 'none';
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'queryStart':
                    showLoadingIndicator();
                    break;
                case 'queryResult':
                    hideLoadingIndicator();
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