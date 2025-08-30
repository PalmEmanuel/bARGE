import { DefaultAzureCredential, InteractiveBrowserCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import * as vscode from 'vscode';
import { AzureSubscription, QueryResult, ColumnDefinition } from './types';

export class AzureService {
    private credential: DefaultAzureCredential | InteractiveBrowserCredential | null = null;
    private resourceGraphClient: ResourceGraphClient | null = null;
    private subscriptionClient: SubscriptionClient | null = null;

    constructor() {}

    private validateAuthentication(): void {
        if (!this.credential || !this.resourceGraphClient || !this.subscriptionClient) {
            throw new Error('Not authenticated. Please authenticate first.');
        }
    }

    async authenticate(): Promise<boolean> {
        try {
            // Try DefaultAzureCredential first (works with Azure CLI, visual studio code etc.)
            this.credential = new DefaultAzureCredential();
            
            // Test the credential by trying to get subscriptions
            this.subscriptionClient = new SubscriptionClient(this.credential);
            this.resourceGraphClient = new ResourceGraphClient(this.credential);
            
            // Test authentication by listing subscriptions
            await this.getSubscriptions();
            
            vscode.window.showInformationMessage('Successfully authenticated with Azure');
            return true;
        } catch (error) {
            console.log('DefaultAzureCredential failed, trying InteractiveBrowserCredential');
            
            try {
                // Fallback to interactive browser authentication
                this.credential = new InteractiveBrowserCredential({
                    clientId: '04b07795-8ddb-461a-bbee-02f9e1bf7b46', // Azure CLI client ID
                });
                
                this.subscriptionClient = new SubscriptionClient(this.credential);
                this.resourceGraphClient = new ResourceGraphClient(this.credential);
                
                // Test authentication
                await this.getSubscriptions();
                
                vscode.window.showInformationMessage('Successfully authenticated with Azure via browser');
                return true;
            } catch (browserError) {
                console.error('Authentication failed:', browserError);
                vscode.window.showErrorMessage(`Azure authentication failed: ${browserError}`);
                return false;
            }
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

    async runQuery(query: string, subscriptionIds: string[]): Promise<QueryResult> {
        console.log('runQuery called with:', { query, subscriptionIds });
        this.validateAuthentication();

        try {
            // Try the REST API approach first to avoid AbortSignal issues
            return await this.runQueryViaRestApi(query, subscriptionIds);
        } catch (restError) {
            console.log('REST API failed, trying SDK approach:', restError);
            
            // Fallback to SDK approach
            try {
                return await this.runQueryViaSdk(query, subscriptionIds);
            } catch (sdkError) {
                console.error('Both REST API and SDK failed');
                console.error('REST Error:', restError);
                console.error('SDK Error:', sdkError);
                throw new Error(`Query execution failed. REST API: ${restError}. SDK: ${sdkError}`);
            }
        }
    }

    private async runQueryViaRestApi(query: string, subscriptionIds: string[]): Promise<QueryResult> {
        console.log('Trying REST API approach...');
        
        // Get access token from credential
        const tokenResponse = await this.credential!.getToken('https://management.azure.com/.default');
        const accessToken = tokenResponse.token;
        
        const requestBody = {
            query: query,
            subscriptions: subscriptionIds
        };

        console.log('Making REST API call with:', requestBody);

        const response = await fetch(
            'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
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
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

    private async runQueryViaSdk(query: string, subscriptionIds: string[]): Promise<QueryResult> {
        console.log('Trying SDK approach...');
        
        // Use the simplest possible API call format
        const queryRequest = {
            query: query,
            subscriptions: subscriptionIds
        };

        console.log('About to call resourceGraphClient.resources with:', queryRequest);

        // Call the API without any additional options to avoid AbortSignal issues
        const result = await this.resourceGraphClient!.resources(queryRequest);
        
        console.log('Raw result from Azure SDK:', result);
        
        // The response format should be: { data: { columns: [...], rows: [[...]] } }
        let tableData;
        if (result && result.data) {
            tableData = result.data;
        } else if (result && (result as any).columns && (result as any).rows) {
            tableData = result;
        } else {
            console.error('Unexpected response format:', result);
            throw new Error('Unexpected response format from Azure Resource Graph');
        }

        console.log('Processed table data:', tableData);
        
        // Extract column definitions
        const columns: ColumnDefinition[] = (tableData as any).columns?.map((col: any) => ({
            name: col.name,
            type: col.type
        })) || [];

        // Extract row data
        const data: any[][] = (tableData as any).rows || [];

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

    isAuthenticated(): boolean {
        return this.credential !== null && 
               this.resourceGraphClient !== null && 
               this.subscriptionClient !== null;
    }
}
