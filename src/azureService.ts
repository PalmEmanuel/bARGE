import { DefaultAzureCredential, TokenCredential } from '@azure/identity';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import * as vscode from 'vscode';
import { AzureSubscription, QueryResult, ColumnDefinition, AuthScope } from './types';

// VS Code credential wrapper that uses built-in Microsoft authentication
class VSCodeCredential implements TokenCredential {
    private currentSession: vscode.AuthenticationSession | null = null;

    async getToken(scopes?: string | string[], options?: any): Promise<{ token: string; expiresOnTimestamp: number } | null> {
        try {
            // Get current session or create new one silently
            const session = await vscode.authentication.getSession(
                'microsoft',
                ['https://management.azure.com/.default'],
                { createIfNone: false, silent: true }
            );

            if (!session) {
                return null;
            }

            this.currentSession = session;

            // Parse token expiration from JWT
            let expiresOnTimestamp = Date.now() + (60 * 60 * 1000); // Default 1 hour
            try {
                const tokenParts = session.accessToken.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    if (payload.exp) {
                        expiresOnTimestamp = payload.exp * 1000;
                    }
                }
            } catch (error) {
                console.warn('Could not parse token expiration:', error);
            }

            return {
                token: session.accessToken,
                expiresOnTimestamp
            };
        } catch (error) {
            console.error('Failed to get token from VS Code authentication:', error);
            return null;
        }
    }

    async forceNewSession(account?: vscode.AuthenticationSessionAccountInformation): Promise<vscode.AuthenticationSession | null> {
        try {
            const session = await vscode.authentication.getSession(
                'microsoft',
                ['https://management.azure.com/.default'],
                {
                    forceNewSession: true,
                    account: account
                }
            );
            this.currentSession = session;
            return session;
        } catch (error) {
            console.error('Failed to force new authentication session:', error);
            return null;
        }
    }

    getCurrentSession(): vscode.AuthenticationSession | null {
        return this.currentSession;
    }
}

export class AzureService {
    private credential: DefaultAzureCredential | VSCodeCredential | null = null;
    private subscriptionClient: SubscriptionClient | null = null;
    private currentScope: AuthScope = { type: 'tenant' }; // Default to tenant scope
    private authenticated = false;
    private currentAccount: string | null = null;

    constructor() { }

    private validateAuthentication(): void {
        if (!this.credential || !this.subscriptionClient) {
            throw new Error('Not authenticated. Please authenticate first.');
        }
    }

    isAuthenticated(): boolean {
        return this.authenticated;
    }

    getCurrentAccount(): string | null {
        return this.currentAccount;
    }

    async authenticate(): Promise<boolean> {
        try {
            // First try VS Code's built-in Microsoft authentication
            const vsCodeCredential = new VSCodeCredential();
            const token = await vsCodeCredential.getToken(['https://management.azure.com/.default']);

            if (token) {
                this.credential = vsCodeCredential;
                this.subscriptionClient = new SubscriptionClient(this.credential as TokenCredential);

                // Test authentication by listing subscriptions
                await this.getSubscriptions();

                const session = vsCodeCredential.getCurrentSession();
                this.authenticated = true;
                this.currentAccount = session?.account.label || null;
                vscode.window.showInformationMessage(`Authenticated to Azure as ${session?.account.label} through VS Code!`);
                return true;
            }

        } catch (error) {
            // Fall back to DefaultAzureCredential (Azure CLI, managed identity, etc.)
            this.credential = new DefaultAzureCredential();
            this.subscriptionClient = new SubscriptionClient(this.credential);

            // Test authentication by listing subscriptions
            await this.getSubscriptions();

            this.authenticated = true;
            vscode.window.showInformationMessage('Authenticated to Azure with existing credentials from Azure CLI, VS Code or environment variables!');
            return true;
        }

        // If we reach here, authentication failed
        vscode.window.showErrorMessage('Failed to authenticate to Azure! Try logging into Azure CLI, or to VS Code with a Microsoft account.');
        return false;
    }

    async authenticateWithVSCode(): Promise<boolean> {
        try {
            // Get all available Microsoft accounts in VS Code
            const accounts = await vscode.authentication.getAccounts('microsoft');

            // Always build picker items starting with DefaultAzureCredential option
            const items: vscode.QuickPickItem[] = [
                {
                    label: '$(azure) Use DefaultAzureCredential',
                    description: 'Azure CLI, Environment vars, VS Code & more...',
                    detail: 'Uses Azure CLI login, environment variables, or VS Code authentication automatically'
                }
            ];

            // Add Microsoft accounts from VS Code if available
            if (accounts.length > 0) {
                items.push(
                    ...accounts.map(account => ({
                        label: `$(vscode) ${account.label}`,
                        description: account.id,
                        detail: 'Microsoft account signed into VS Code'
                    }))
                );
            } else {
                items.push({
                    label: '$(info) No Microsoft accounts found in VS Code',
                    description: 'Sign into VS Code with a Microsoft account to see more options',
                    detail: 'Use the account icon in VS Code to add a Microsoft account'
                });
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select authentication method',
                title: 'bARGE: Choose Azure Authentication'
            });

            if (!selected) {
                return false;
            }

            if (selected.label.startsWith('$(cloud)')) {
                // User selected DefaultAzureCredential
                return await this.authenticate();
            }

            if (selected.label.startsWith('$(info)')) {
                // User clicked on the info item - try to trigger VS Code authentication
                const vsCodeCredential = new VSCodeCredential();
                const session = await vsCodeCredential.forceNewSession();

                if (!session) {
                    vscode.window.showErrorMessage('Please sign into VS Code with a Microsoft account and try again');
                    return false;
                }

                return await this.completeAuthentication(vsCodeCredential, session);
            }

            if (selected.kind === vscode.QuickPickItemKind.Separator) {
                return false; // Separator was selected somehow
            }

            // User selected a specific Microsoft account
            const selectedAccount = accounts.find(account => account.label === selected.label);
            if (!selectedAccount) {
                vscode.window.showErrorMessage('Selected account not found');
                return false;
            }

            // Get session for the selected account
            const vsCodeCredential = new VSCodeCredential();
            const session = await vscode.authentication.getSession(
                'microsoft',
                ['https://management.azure.com/.default'],
                {
                    createIfNone: false,
                    silent: false,
                    account: selectedAccount
                }
            );

            if (!session) {
                vscode.window.showErrorMessage(`Failed to authenticate with account: ${selectedAccount.label}`);
                return false;
            }

            return await this.completeAuthentication(vsCodeCredential, session);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to authenticate: ${errorMessage}`);
            console.error('VS Code authentication failed:', error);
            return false;
        }
    }

    private async completeAuthentication(credential: VSCodeCredential, session: vscode.AuthenticationSession): Promise<boolean> {
        try {
            // Set up our service clients with the VS Code credential
            this.credential = credential;
            this.subscriptionClient = new SubscriptionClient(this.credential as TokenCredential);

            // Test authentication by getting subscriptions
            await this.getSubscriptions();

            this.authenticated = true;
            this.currentAccount = session.account.label;

            vscode.window.showInformationMessage(`Successfully authenticated as ${session.account.label}`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Authentication test failed: ${errorMessage}`);
            return false;
        }
    }

    async getSubscriptions(): Promise<AzureSubscription[]> {
        this.validateAuthentication();

        try {
            const subscriptions: AzureSubscription[] = [];

            for await (const subscription of this.subscriptionClient!.subscriptions.list()) {
                if (subscription.subscriptionId && subscription.displayName) {
                    subscriptions.push({
                        subscriptionId: subscription.subscriptionId,
                        displayName: subscription.displayName,
                        tenantId: subscription.tenantId || ''
                    });
                }
            }

            return subscriptions;
        } catch (error) {
            console.error('Failed to get subscriptions:', error);
            throw new Error(`Failed to get subscriptions: ${error}`);
        }
    }

    async runQuery(query: string, subscriptionIds?: string[]): Promise<QueryResult> {
        console.log('runQuery called with:', { query, subscriptionIds, currentScope: this.currentScope });
        this.validateAuthentication();

        const startTime = Date.now();

        // Use current scope settings
        const effectiveSubscriptions = this.currentScope.type === 'tenant' ? undefined : (subscriptionIds || this.currentScope.subscriptions);

        try {
            const result = await this.runQueryViaRestApi(query, effectiveSubscriptions);
            const executionTime = Date.now() - startTime;
            return {
                ...result,
                executionTimeMs: executionTime
            };
        } catch (error) {
            console.error('Query execution failed:', error);

            // Preserve details if they exist on the original error
            if (error instanceof Error && (error as any).details) {
                const newError = new Error(`Query execution failed: ${error.message}`);
                (newError as any).details = (error as any).details;
                throw newError;
            } else {
                throw new Error(`Query execution failed: ${error}`);
            }
        }
    }

    private async runQueryViaRestApi(query: string, subscriptionIds?: string[]): Promise<QueryResult> {
        // Get access token from credential
        const tokenResponse = await this.credential!.getToken('https://management.azure.com/.default');
        if (!tokenResponse) {
            throw new Error('Failed to get access token');
        }
        const accessToken = tokenResponse.token;

        const requestBody: any = {
            query: query
        };

        // Only add subscriptions if we're in subscription scope
        if (subscriptionIds && subscriptionIds.length > 0) {
            requestBody.subscriptions = subscriptionIds;
        }

        console.log('Making REST API call with:', requestBody);

        const response = await fetch(
            'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            let errorDetails = '';

            try {
                const errorBody = await response.json() as any;

                if (errorBody.error) {
                    const error = errorBody.error;

                    // Use correlation/support message as main error message if available
                    if (error.message && (error.message.includes('correlationId') || error.message.includes('timestamp'))) {
                        errorMessage = error.message;
                    } else if (error.code && error.message) {
                        errorMessage = `${error.code}: ${error.message}`;
                    } else if (error.message) {
                        errorMessage = error.message;
                    } else if (error.code) {
                        errorMessage = error.code;
                    }

                    // Parse all details into separate sections
                    if (error.details && Array.isArray(error.details) && error.details.length > 0) {
                        const detailSections: string[] = [];

                        error.details.forEach((detail: any) => {
                            const detailParts: string[] = [];

                            // Add code if available
                            if (detail.code) {
                                detailParts.push(`Code: ${detail.code}`);
                            }

                            // Add message if available and different from code
                            if (detail.message && detail.message !== detail.code) {
                                detailParts.push(`Message: ${detail.message}`);
                            }

                            // Add location info for parser failures
                            if (detail.line !== undefined) {
                                detailParts.push(`Line: ${detail.line}`);
                            }
                            if (detail.characterPositionInLine !== undefined) {
                                detailParts.push(`Position: ${detail.characterPositionInLine}`);
                            }
                            if (detail.token) {
                                detailParts.push(`Token: "${detail.token}"`);
                            }

                            // Add any other properties we haven't handled
                            Object.keys(detail).forEach(key => {
                                if (!['code', 'message', 'line', 'characterPositionInLine', 'token'].includes(key)) {
                                    detailParts.push(`${key}: ${detail[key]}`);
                                }
                            });

                            if (detailParts.length > 0) {
                                detailSections.push(detailParts.join('\n'));
                            }
                        });

                        if (detailSections.length > 0) {
                            errorDetails = detailSections.join('\n---\n'); // Use separator between sections
                        }
                    }
                }
            } catch (parseError) {
                console.warn('Could not parse error response:', parseError);
            }

            const error = new Error(errorMessage);
            (error as any).details = errorDetails;
            throw error;
        }

        const result = await response.json() as any;
        console.log('REST API response:', result);

        let tableData: any;

        // Handle different response formats
        if (result && result.data && Array.isArray(result.data)) {
            // REST API returns objects in an array, need to convert to table format
            console.log('Converting object array to table format');
            tableData = this.convertObjectArrayToTable(result.data);
        } else if (result && result.data && result.data.columns && result.data.rows) {
            // Already in table format
            tableData = result.data;
        } else if (result && result.columns && result.rows) {
            // Direct table format
            tableData = result;
        } else {
            console.error('Unexpected response format from REST API:', result);
            throw new Error('Unexpected response format from REST API');
        }

        // Extract column definitions
        const columns: ColumnDefinition[] = tableData.columns?.map((col: any) => ({
            name: col.name,
            type: col.type
        })) || [];

        // Extract row data
        const data: any[][] = tableData.rows || [];

        return {
            columns,
            data,
            totalRecords: data.length,
            query,
            timestamp: new Date().toISOString()
        };
    }

    private convertObjectArrayToTable(objects: any[]): any {
        if (!objects || objects.length === 0) {
            return { columns: [], rows: [] };
        }

        // Get all unique property names from all objects
        const allKeys = new Set<string>();
        objects.forEach(obj => {
            Object.keys(obj).forEach(key => allKeys.add(key));
        });

        const columnNames = Array.from(allKeys).sort();

        // Create column definitions
        const columns = columnNames.map(name => ({
            name: name,
            type: 'string' // We'll assume string type for simplicity
        }));

        // Create rows by extracting values in column order
        const rows = objects.map(obj =>
            columnNames.map(colName => obj[colName] || null)
        );

        console.log('Converted to table format:', {
            columnCount: columns.length,
            rowCount: rows.length,
            columns: columns.map(c => c.name)
        });

        return { columns, rows };
    }

    public async setScope(): Promise<void> {
        try {
            const subscriptions = await this.getSubscriptions();

            // Create quick pick items
            const items: vscode.QuickPickItem[] = [
                {
                    label: 'Tenant Scope',
                    description: 'Query across all subscriptions in the tenant',
                    detail: 'Recommended for most queries'
                },
                ...subscriptions.map(sub => ({
                    label: sub.displayName,
                    description: sub.subscriptionId,
                    detail: `Subscription scope`
                }))
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select query scope',
                title: 'bARGE: Set Query Scope'
            });

            if (selected) {
                if (selected.label === 'Tenant Scope') {
                    this.currentScope = { type: 'tenant' };
                    vscode.window.showInformationMessage('Scope set to: Tenant (all subscriptions)');
                } else {
                    const subscription = subscriptions.find(sub => sub.displayName === selected.label);
                    if (subscription) {
                        this.currentScope = {
                            type: 'subscription',
                            subscriptions: [subscription.subscriptionId]
                        };
                        vscode.window.showInformationMessage(`Scope set to: ${selected.label}`);
                    }
                }
                console.log('Scope changed to:', this.currentScope);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to set scope: ${error}`);
        }
    }

    public getCurrentScope(): AuthScope {
        return this.currentScope;
    }
}
