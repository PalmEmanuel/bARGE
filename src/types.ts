/**
 * Type definitions for bARGE extension
 */

export interface QueryResult {
    columns: ColumnDefinition[];
    data: any[][];
    totalRecords: number;
    query: string;
    timestamp: string;
    executionTimeMs?: number;
}

export interface ColumnDefinition {
    name: string;
    type: string;
}

export interface AzureSubscription {
    subscriptionId: string;
    displayName: string;
    tenantId: string;
}

export interface QueryRequest {
    query: string;
    subscriptions?: string[];
    managementGroups?: string[];
}

export interface QueryResponse {
    success: boolean;
    data?: QueryResult;
    error?: string;
}

export interface AuthScope {
    type: 'tenant' | 'subscription';
    subscriptions?: string[];
}

export interface WebviewMessage {
    type: 'runQuery' | 'exportCsv' | 'authenticate' | 'getSubscriptions' | 'runFileQuery';
    payload?: any;
}

export interface FileQueryRequest {
    query: string;
    source: 'file' | 'selection';
    fileName?: string;
}
