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
    errorDetails?: string;
    rawError?: any; // Raw error response for detailed debugging
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

/**
 * Kusto Language Service types for enhanced KQL features
 */
export interface Schema {
    clusterType: 'Engine' | 'ClusterManager' | 'DataManagement';
    cluster: {
        connectionString: string;
        databases: Database[];
    };
    database?: Database;
    globalScalarParameters?: ScalarParameter[];
    globalTabularParameters?: TabularParameter[];
}

export interface Database {
    name: string;
    alternateName?: string;
    majorVersion: number;
    minorVersion: number;
    entityGroups: EntityGroup[];
    tables: Table[];
    functions: Function[];
}

export interface Table {
    name: string;
    entityType: TableEntityType;
    docstring?: string;
    columns: Column[];
}

export interface Column {
    name: string;
    type: string;
    docstring?: string;
    examples?: string[];
}

export interface Function {
    name: string;
    body: string;
    docstring?: string;
    inputParameters: InputParameter[];
}

export interface EntityGroup {
    name: string;
    members: string[];
}

export interface ScalarParameter {
    name: string;
    type: string;
    cslType?: string;
    docstring?: string;
    cslDefaultValue?: string;
    examples?: string[];
}

export interface TabularParameter {
    name: string;
    columns: Column[];
    docstring?: string;
}

export interface InputParameter extends ScalarParameter {
    columns?: ScalarParameter[];
}

export type TableEntityType = 'Table' | 'MaterializedView' | 'ExternalTable';

/**
 * Namespace for show schema command results
 */
export namespace showSchema {
    export interface Column {
        readonly Name: string;
        readonly Type: string;
        readonly CslType: string;
        readonly DocString?: string;
        readonly Examples?: readonly string[];
    }

    export interface Table {
        readonly Name: string;
        readonly EntityType: TableEntityType;
        readonly OrderedColumns: readonly Column[];
        readonly DocString?: string;
    }

    export interface Tables {
        readonly [tableName: string]: Table;
    }

    export interface Database {
        readonly Name: string;
        readonly Tables: Tables;
        readonly ExternalTables: Tables;
        readonly MaterializedViews: Tables;
        readonly EntityGroups: Readonly<Record<string, readonly string[]>>;
        readonly MajorVersion: number;
        readonly MinorVersion: number;
        readonly Functions: Functions;
        readonly DatabaseAccessMode: string;
    }

    export interface Functions {
        readonly [functionName: string]: Function;
    }

    export interface Function {
        readonly Name: string;
        readonly InputParameters: readonly InputParameter[];
        readonly Body: string;
        readonly Folder: string;
        readonly DocString: string;
        readonly FunctionKind: string;
        readonly OutputColumns: readonly any[];
    }

    export interface Databases {
        readonly [dbName: string]: Database;
    }

    export interface Result {
        readonly Plugins: readonly unknown[];
        readonly Databases: Databases;
    }
}
