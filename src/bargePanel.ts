import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AzureService } from './azure/azureService';
import { WebviewMessage, QueryResponse, ResolveGuidRequest, ResolveGuidResponse, IdentityInfo } from './types';

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
            'bARGE - boosted Azure Resource Graph Explorer',
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
        // Generate a nonce for Content Security Policy
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

        // Replace placeholders
        html = html.replace(/{{NONCE}}/g, nonce);
        html = html.replace(/{{WEBVIEW_URI}}/g, webviewUri.toString());
        html = html.replace(/{{WEBVIEW_BUNDLE_URI}}/g, webviewBundleUri.toString());

        return html;
    }
}