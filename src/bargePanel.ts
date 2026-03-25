import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AzureService } from './azure/azureService';
import { WebviewMessage, QueryResponse, ResolveGuidRequest, ResolveGuidResponse, IdentityInfo } from './types';

export class BargePanel {
    /** All live panels. */
    private static _panels: Set<BargePanel> = new Set();
    /** Per-file target panel — the one that "Run Query" writes to. */
    private static _targetPanels: Map<string, BargePanel> = new Map();
    /** File key of the currently-active editor (undefined when not in a supported file). */
    private static _activeFileKey: string | undefined;
    /** Monotonically increasing counter for stable creation ordering. */
    private static _globalCreationCounter = 0;
    public static readonly viewType = 'bargeResults';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _azureService: AzureService;
    private readonly _extensionUri: vscode.Uri;
    private _sourceFileKey: string;
    private readonly _creationOrder: number;
    private _disposables: vscode.Disposable[] = [];
    private _webviewReady = false;
    private _pendingMessages: any[] = [];

    // ── public static API ──────────────────────────────────────────────

    /**
     * Derive a panel-tracking key from a file name.
     * Returns the basename (e.g. "storage.kql") or "untitled" for no-file contexts.
     */
    public static getFileKey(fileName?: string): string {
        if (!fileName || fileName === '' || fileName.startsWith('Untitled')) {
            return 'untitled';
        }
        // Handle both Unix (/) and Windows (\) path separators
        const lastSep = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
        return lastSep === -1 ? fileName : fileName.substring(lastSep + 1);
    }

    /**
     * Get or create the target panel for a given file.
     * If a target already exists it is revealed; otherwise a new panel is created.
     */
    public static getOrCreateForFile(extensionUri: vscode.Uri, azureService: AzureService, fileKey: string): BargePanel {
        const existing = BargePanel._targetPanels.get(fileKey);
        if (existing) {
            existing._panel.reveal();
            return existing;
        }
        return BargePanel._createPanel(extensionUri, azureService, fileKey);
    }

    /**
     * Create a new panel for a file and promote it to the target for that file.
     */
    public static createNewForFile(extensionUri: vscode.Uri, azureService: AzureService, fileKey: string): BargePanel {
        return BargePanel._createPanel(extensionUri, azureService, fileKey);
    }

    /**
     * Update the active file key (called when the active editor changes).
     * Hides/shows the focus indicator on panel titles accordingly.
     */
    public static setActiveFileKey(fileKey: string | undefined): void {
        if (BargePanel._activeFileKey === fileKey) { return; }
        BargePanel._activeFileKey = fileKey;
        BargePanel._updateAllTitles();
    }

    /**
     * Return the current target panel for a file, if any.
     */
    public static getTargetForFile(fileKey: string): BargePanel | undefined {
        return BargePanel._targetPanels.get(fileKey);
    }

    /**
     * Re-key all panels associated with `oldKey` to `newKey`.
     * Called when a source file is renamed.
     */
    public static handleFileRename(oldKey: string, newKey: string): void {
        if (oldKey === newKey) { return; }

        // Move target mapping
        const target = BargePanel._targetPanels.get(oldKey);
        if (target) {
            BargePanel._targetPanels.delete(oldKey);
            // If the new key already has a target, keep the existing one.
            // Otherwise promote the old target.
            if (!BargePanel._targetPanels.has(newKey)) {
                BargePanel._targetPanels.set(newKey, target);
            }
        }

        // Update every panel's source file key
        for (const panel of BargePanel._panels) {
            if (panel._sourceFileKey === oldKey) {
                panel._sourceFileKey = newKey;
            }
        }

        // Update active file key if it matched the old name
        if (BargePanel._activeFileKey === oldKey) {
            BargePanel._activeFileKey = newKey;
        }

        BargePanel._updateAllTitles();
    }

    // ── internal helpers ───────────────────────────────────────────────

    private static _createPanel(extensionUri: vscode.Uri, azureService: AzureService, fileKey: string): BargePanel {
        BargePanel._globalCreationCounter++;

        const panel = vscode.window.createWebviewPanel(
            BargePanel.viewType,
            'bARGE', // placeholder — _updateAllTitles sets the real title
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons')
                ],
                retainContextWhenHidden: true
            }
        );

        const bargePanel = new BargePanel(panel, extensionUri, azureService, fileKey, BargePanel._globalCreationCounter);
        BargePanel._panels.add(bargePanel);
        BargePanel._targetPanels.set(fileKey, bargePanel);
        BargePanel._updateAllTitles();

        // Move to bottom panel after creation
        vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');

        return bargePanel;
    }

    /**
     * Recompute every panel's title and icon.
     *
     * Title format:  bARGE[: filename][ (N)]
     *   : filename   — shown for file-associated panels (omitted for "untitled")
     *   (N)          — shown when more than one panel exists for the same file
     * Icon:          filled blue circle on the target panel whose file matches the active editor
     */
    private static _updateAllTitles(): void {
        // Group panels by file key, sorted by creation order
        const groups = new Map<string, BargePanel[]>();
        for (const panel of BargePanel._panels) {
            const key = panel._sourceFileKey;
            if (!groups.has(key)) { groups.set(key, []); }
            groups.get(key)!.push(panel);
        }

        for (const [fileKey, panels] of groups) {
            panels.sort((a, b) => a._creationOrder - b._creationOrder);

            const target = BargePanel._targetPanels.get(fileKey);
            const isActiveFile = BargePanel._activeFileKey === fileKey;

            for (let i = 0; i < panels.length; i++) {
                const p = panels[i];
                const isTarget = p === target && isActiveFile;

                const baseName = fileKey === 'untitled'
                    ? 'bARGE'
                    : `bARGE: ${fileKey}`;
                const suffix = panels.length > 1 ? ` (${i + 1})` : '';

                p._panel.title = `${baseName}${suffix}`;

                if (isTarget) {
                    p._panel.iconPath = {
                        light: vscode.Uri.joinPath(p._extensionUri, 'media', 'icons', 'target-light.svg'),
                        dark: vscode.Uri.joinPath(p._extensionUri, 'media', 'icons', 'target-dark.svg')
                    };
                } else {
                    p._panel.iconPath = undefined;
                }
            }
        }
    }

    // ── instance ───────────────────────────────────────────────────────

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        azureService: AzureService,
        sourceFileKey: string,
        creationOrder: number
    ) {
        this._panel = panel;
        this._azureService = azureService;
        this._extensionUri = extensionUri;
        this._sourceFileKey = sourceFileKey;
        this._creationOrder = creationOrder;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                this._handleMessage(message);
            },
            null,
            this._disposables
        );
        // When a bARGE panel gains focus, promote it to target for its file.
        // Only update the active file key if the panel belongs to the already-active
        // file — otherwise clicking a panel for another file would steal the indicator
        // from the file the user is actually editing.
        this._panel.onDidChangeViewState(
            (e) => {
                if (e.webviewPanel.active) {
                    BargePanel._targetPanels.set(this._sourceFileKey, this);

                    if (BargePanel._activeFileKey === this._sourceFileKey || BargePanel._activeFileKey === undefined) {
                        BargePanel._activeFileKey = this._sourceFileKey;
                    }
                    BargePanel._updateAllTitles();
                }
            },
            null,
            this._disposables
        );
    }

    private _postMessage(message: any) {
        if (this._webviewReady) {
            this._panel.webview.postMessage(message);
        } else {
            this._pendingMessages.push(message);
        }
    }

    private _flushPendingMessages() {
        for (const msg of this._pendingMessages) {
            this._panel.webview.postMessage(msg);
        }
        this._pendingMessages = [];
    }

    private async _handleMessage(message: WebviewMessage) {
        if (message.type === 'webviewReady') {
            this._webviewReady = true;
            this._flushPendingMessages();
            return;
        }

        switch (message.type) {
            case 'exportCsv':
                try {
                    const { data, filename } = message.payload;
                    await this._exportToCsv(data, filename);
                } catch (error) {
                    vscode.window.showErrorMessage(`CSV export failed: ${error}`);
                }
                break;
            case 'resolveGuids':
                try {
                    const request: ResolveGuidRequest = message.payload;
                    
                    // Use streaming callback to send partial results as they come in
                    const resolvedData = await this._azureService.resolveIdentityGuids(
                        request.guids,
                        (partialResults: IdentityInfo[]) => {
                            // Send partial results immediately to webview
                            console.log('Sending partial results:', partialResults);
                            const partialResponse: ResolveGuidResponse = {
                                columnIndex: request.columnIndex,
                                resolvedData: partialResults,
                                responseTarget: request.responseTarget,
                                cellPosition: request.cellPosition,
                                selectedCells: request.selectedCells,
                                isPartial: true
                            };
                            
                            this._panel.webview.postMessage({
                                type: 'guidResolved',
                                payload: partialResponse
                            });
                        }
                    );
                                        
                    // Send final complete response
                    const response: ResolveGuidResponse = {
                        columnIndex: request.columnIndex,
                        resolvedData: resolvedData,
                        responseTarget: request.responseTarget,
                        cellPosition: request.cellPosition,
                        selectedCells: request.selectedCells,
                        isPartial: false
                    };
                    
                    console.log('Sending response back to webview:', response);
                    this._panel.webview.postMessage({
                        type: 'guidResolved',
                        payload: response
                    });
                } catch (error) {
                    console.error('GUID resolution error:', error);
                    vscode.window.showErrorMessage(`GUID resolution failed: ${error}`);
                    
                    // Create detailed error response for webview
                    const errorResponse: ResolveGuidResponse = {
                        columnIndex: message.payload?.columnIndex || 0,
                        resolvedData: (message.payload?.guids || []).map((guid: string) => ({
                            id: guid,
                            error: error instanceof Error ? error.message : String(error),
                            errorDetails: {
                                type: error instanceof Error ? error.constructor.name : 'Unknown',
                                message: error instanceof Error ? error.message : String(error),
                                stack: error instanceof Error ? error.stack : undefined,
                                timestamp: new Date().toISOString()
                            }
                        })),
                        responseTarget: message.payload?.responseTarget,
                        cellPosition: message.payload?.cellPosition
                    };
                    
                    this._panel.webview.postMessage({
                        type: 'guidResolved',
                        payload: errorResponse
                    });
                }
                break;
            case 'showConfirmation':
                try {
                    const { message: confirmMessage, confirmationType } = message.payload;
                    const result = await vscode.window.showWarningMessage(
                        confirmMessage,
                        { modal: true },
                        'Yes',
                        'No'
                    );
                    
                    // Send result back to webview
                    this._panel.webview.postMessage({
                        type: 'confirmationResult',
                        payload: {
                            confirmed: result === 'Yes',
                            confirmationType: confirmationType
                        }
                    });
                } catch (error) {
                    console.error('Confirmation dialog error:', error);
                    // Send failure result
                    this._panel.webview.postMessage({
                        type: 'confirmationResult',
                        payload: {
                            confirmed: false,
                            confirmationType: message.payload?.confirmationType
                        }
                    });
                }
                break;
        }
    }

    public async runQuery(query: string, source: 'file' | 'selection', fileName?: string) {
        try {
            // Show loading indicator
            this._postMessage({
                type: 'queryStart'
            });

            this._panel.reveal();

            const result = await this._azureService.runQuery(query, undefined, (progress) => {
                // Send pagination progress to webview overlay
                this._postMessage({
                    type: 'queryProgress',
                    payload: progress
                });
            });

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

            this._postMessage({
                type: 'queryResult',
                payload: response
            });

        } catch (error) {
            let errorMessage = 'Unknown error occurred';
            let errorDetails = '';
            let rawError: any = null;

            if (error instanceof Error) {
                errorMessage = error.message;
                
                // Extract details if available from our custom error parsing
                if ((error as any).details) {
                    errorDetails = (error as any).details;
                } else {
                    // Check for common Azure error patterns if no details were parsed
                    if (error.message.includes('400')) {
                        errorMessage = 'Bad Request - Invalid query syntax or parameters';
                        errorDetails = error.message;
                    } else if (error.message.includes('401')) {
                        errorMessage = 'Unauthorized - Please check your Azure authentication';
                        errorDetails = 'Try running "az login" or check your Azure credentials';
                    } else if (error.message.includes('403')) {
                        errorMessage = 'Forbidden - Insufficient permissions';
                        errorDetails = 'You may not have permission to query the selected subscriptions or resources';
                    } else if (error.message.includes('404')) {
                        errorMessage = 'Not Found - Resource or subscription not found';
                        errorDetails = error.message;
                    } else if (error.message.includes('429')) {
                        errorMessage = 'Rate Limited - Too many requests';
                        errorDetails = 'Please wait a moment before running another query';
                    } else if (error.message.includes('500')) {
                        errorMessage = 'Server Error - Azure service error';
                        errorDetails = error.message;
                    }
                }

                // Extract raw error if available
                if ((error as any).rawError) {
                    rawError = (error as any).rawError;
                }
            } else {
                errorMessage = String(error);
            }

            const response: QueryResponse = {
                success: false,
                error: errorMessage,
                errorDetails: errorDetails,
                rawError: rawError
            };

            this._postMessage({
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
        BargePanel._panels.delete(this);

        // If this was the target for its file, promote the most recently created survivor
        if (BargePanel._targetPanels.get(this._sourceFileKey) === this) {
            BargePanel._targetPanels.delete(this._sourceFileKey);

            let fallback: BargePanel | undefined;
            for (const p of BargePanel._panels) {
                if (p._sourceFileKey === this._sourceFileKey) {
                    if (!fallback || p._creationOrder > fallback._creationOrder) {
                        fallback = p;
                    }
                }
            }
            if (fallback) {
                BargePanel._targetPanels.set(this._sourceFileKey, fallback);
            }
        }

        BargePanel._updateAllTitles();

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
        // Generate a nonce for script security
        const nonce = crypto.randomBytes(16).toString('base64');

        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'webview', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Get URIs for resources
        const webviewUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'webview')
        );

        const webviewBundleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'webview-bundle.js')
        );

        const codiconsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );

        // Replace placeholders
        html = html.replace(/{{NONCE}}/g, nonce);
        html = html.replace(/{{WEBVIEW_URI}}/g, webviewUri.toString());
        html = html.replace(/{{WEBVIEW_BUNDLE_URI}}/g, webviewBundleUri.toString());
        html = html.replace(/{{CODICONS_URI}}/g, codiconsUri.toString());

        return html;
    }
}