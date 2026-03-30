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
    type: 'runQuery' | 'exportCsv' | 'authenticate' | 'getSubscriptions' | 'runFileQuery' | 'resolveGuids' | 'showError' | 'showConfirmation' | 'webviewReady' | 'selectRows' | 'selectCells';
    payload?: any;
}

/**
 * Summary info about a single bARGE result panel, used by the MCP tools.
 */
export interface PanelInfo {
    /** Stable unique identifier: "<sourceFile>:<creationOrder>" */
    tableId: string;
    /** File name key (basename) the panel is associated with, e.g. "storage.kql" or "untitled" */
    sourceFile: string;
    /**
     * True when this is the panel that the next "Run Query" action would target,
     * i.e. the panel marked with the blue dot in the tab bar.
     */
    isCurrentTarget: boolean;
    /** Whether the panel has at least one completed query result stored. */
    hasData: boolean;
    /** The KQL query text from the last successful run. */
    query?: string;
    /** ISO-8601 timestamp of the last successful run. */
    timestamp?: string;
    /** Number of data rows returned. */
    rowCount?: number;
    /** Number of columns in the result. */
    columnCount?: number;
    /** Column definitions from the last result. */
    columns?: ColumnDefinition[];
    /** Total record count as reported by Azure Resource Graph. */
    totalRecords?: number;
    /** Wall-clock query execution time in milliseconds. */
    executionTimeMs?: number;
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
