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

export interface QueryResponse {
    success: boolean;
    data?: QueryResult;
    error?: string;
    errorDetails?: string;
    rawError?: any; // Raw error response for detailed debugging
}

export interface AuthScope {
    type: 'tenant' | 'subscription';
    subscriptions?: string[];
}

export interface WebviewMessage {
    type: 'runQuery' | 'exportCsv' | 'authenticate' | 'getSubscriptions' | 'runFileQuery' | 'resolveGuids' | 'showError' | 'showConfirmation';
    payload?: any;
}

/**
 * Types for GUID resolution functionality
 */
export interface IdentityInfo {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    objectType?: 'user' | 'group' | 'servicePrincipal' | 'application';
    error?: string;
    errorDetails?: {
        type: string;
        message: string;
        stack?: string;
        timestamp: string;
        objectType?: string;
        allErrors?: Array<{
            objectType: string;
            message?: string;
            timestamp: string;
        }>;
        fullApiResponse?: any;
    };
}

export interface ResolveGuidRequest {
    columnIndex: number;
    columnName: string;
    guids: string[];
    resolveType: 'identity';
    responseTarget?: string;
    cellPosition?: {row: number, col: number};
    selectedCells?: {row: number, col: number}[];
}

export interface ResolveGuidResponse {
    columnIndex: number;
    resolvedData: IdentityInfo[];
    responseTarget?: string;
    cellPosition?: {row: number, col: number};
    selectedCells?: {row: number, col: number}[];
    isPartial?: boolean;
}
