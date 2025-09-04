import { DefaultAzureCredential, TokenCredential } from '@azure/identity';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import * as vscode from 'vscode';
import { AzureSubscription, QueryResult, ColumnDefinition, AuthScope } from '../types';
import { VSCodeCredential } from './vsCodeCredential';

export class AzureService {
    private credential: DefaultAzureCredential | VSCodeCredential | null = null;
    private subscriptionClient: SubscriptionClient | null = null;
    private currentScope: AuthScope = { type: 'tenant' }; // Default to tenant scope
    private authenticated = false;
    private currentAccount: string | null = null;
    private static readonly ARM_RESOURCE_DEFAULT_SCOPE = 'https://management.azure.com/.default';

    constructor() { }

    private validateAuthentication(): void {
        if (!this.credential || !this.subscriptionClient) {
            throw new Error('Not authenticated, please sign in first!');
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
            // Always build picker items starting with DefaultAzureCredential option
            const defaultCredentialOption = '$(azure) Use DefaultAzureCredential';
            const vsCodeOption = '$(vscode) Use VS Code Accounts';
            const vsCodeOtherOption = '$(vscode) Use Other VS Code Account';

            const accounts = await vscode.authentication.getAccounts('microsoft');

            // Create quick pick items
            const items: vscode.QuickPickItem[] = [
                {
                    label: defaultCredentialOption,
                    description: 'Azure CLI, Environment vars, VS Code & more...',
                    detail: 'Uses Azure CLI login, environment variables, VS Code, managed identity and more...'
                }
            ];

            if (accounts.length > 0) {
                for (const account of accounts) {
                    let signedIn = false;
                    try {
                        const session = await vscode.authentication.getSession(
                            'microsoft',
                            [AzureService.ARM_RESOURCE_DEFAULT_SCOPE],
                            {
                                account: account,
                                silent: true
                            }
                        );

                        if (session) {
                            signedIn = true;
                        }
                    } catch (error) {
                        // Ignore errors here, we'll just show as not signed in
                    }
                    items.push({
                        label: `$(vscode) ${account.label}`,
                        description: signedIn ? 'Signed in' : 'Requires Consent',
                        detail: 'Microsoft account in VS Code'
                    });
                }
            }


            items.push({
                label: '',
                kind: vscode.QuickPickItemKind.Separator
            });
            items.push({
                label: accounts.length > 0 ? vsCodeOtherOption : vsCodeOption,
                detail: 'Sign into Microsoft accounts in VS Code'
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select authentication method',
                title: 'Choose Azure Authentication method'
            });

            if (!selected) {
                return false;
            }

            if (selected.label === defaultCredentialOption) {
                // User selected DefaultAzureCredential
                console.log('Authentication method selected: DefaultAzureCredential');
                return await this.authenticateWithDefaultCredential();
            } else if (selected.label.startsWith('$(vscode)')) {
                // User selected VS Code authentication
                const trimmedLabel = selected.label.replace('$(vscode) ', '');
                console.log('Authentication method selected:', trimmedLabel);
                const selectedAccount = accounts.find(acc => trimmedLabel === acc.label);
                return await this.authenticateWithVSCode(selectedAccount);
            } else if (selected.label === vsCodeOtherOption) {
                // User selected VS Code authentication without an account
                console.log('Authentication method selected: VS Code Accounts (no specific account)');
                return await this.authenticateWithVSCode(undefined);
            } else {
                return false;
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to authenticate: ${errorMessage}`);
            console.error('Authentication failed:', error);
            return false;
        }
    }

    async authenticateWithDefaultCredential(): Promise<boolean> {
        try {
            // Fall back to DefaultAzureCredential (Azure CLI, managed identity, etc.)
            this.credential = new DefaultAzureCredential();
            this.subscriptionClient = new SubscriptionClient(this.credential);
            // Get token to verify authentication and get identity
            const token = await this.credential.getToken([AzureService.ARM_RESOURCE_DEFAULT_SCOPE]);

            if (token) {
                this.subscriptionClient = new SubscriptionClient(this.credential as TokenCredential);

                // Test authentication by listing subscriptions
                await this.getSubscriptions();

                this.authenticated = true;
                // Parse JWT to get identity claim
                try {
                    const jwt = token.token.split('.')[1];
                    const payload = JSON.parse(atob(jwt));
                    // Try different identity claims in order of preference
                    this.currentAccount = payload.upn || payload.unique_name || payload.email || payload.name || payload.oid || 'Unknown User';
                } catch (jwtError) {
                    console.warn('Could not parse identity from JWT:', jwtError);
                    this.currentAccount = 'Unknown User';
                }
                vscode.window.showInformationMessage(`Signed in as ${this.currentAccount} from [existing login](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest)!`);
                return true;
            }

        } catch (error) {
            vscode.window.showErrorMessage('Failed to authenticate! Try logging into Azure CLI, or to VS Code with a Microsoft account.');
            return false;
        }

        // If we reach here, authentication failed
        vscode.window.showErrorMessage('Failed to authenticate! Try logging into Azure CLI, or to VS Code with a Microsoft account.');
        return false;
    }

    private async authenticateWithVSCode(account: vscode.AuthenticationSessionAccountInformation | undefined): Promise<boolean> {
        try {
            const session = await vscode.authentication.getSession(
                'microsoft',
                [AzureService.ARM_RESOURCE_DEFAULT_SCOPE],
                {
                    account: account ? account : undefined,
                    createIfNone: true,
                    clearSessionPreference: account ? false : true
                }
            );

            if (!session) {
                vscode.window.showErrorMessage(`Failed to authenticate with VS Code!`);
                return false;
            }

            // Set up our service clients with the VS Code credential
            this.credential = new VSCodeCredential(session);

            this.subscriptionClient = new SubscriptionClient(this.credential as TokenCredential);

            // Test authentication by getting subscriptions
            await this.getSubscriptions();

            this.authenticated = true;
            this.currentAccount = session.account.label;

            vscode.window.showInformationMessage(`Signed in as ${session.account.label} from VS Code!`);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to authenticate with VS Code: ${error}`);
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
        const tokenResponse = await this.credential!.getToken(AzureService.ARM_RESOURCE_DEFAULT_SCOPE);
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
