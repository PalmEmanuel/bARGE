import * as vscode from 'vscode';
import { BargePanel } from './bargePanel';
import { AzureService } from './azure/azureService';

interface ListTablesInput {
    // No required parameters
}

interface GetTableDataInput {
    tableId: string;
    maxRows?: number;
}

interface SelectRowsInput {
    tableId: string;
    rowIndices: number[];
}

interface SelectCellsInput {
    tableId: string;
    cells: { row: number; column: number }[];
}

interface RunQueryInput {
    query: string;
    /** Optional tableId to run the query in an existing panel. When omitted a new panel is created. */
    tableId?: string;
}

interface SortTableInput {
    tableId: string;
    column: string;
    direction?: 'asc' | 'desc';
}

interface FilterTableInput {
    tableId: string;
    filters: { column: string; values: string[] }[];
}

/**
 * Register bARGE Language Model Tools so that GitHub Copilot can query
 * the tables that are currently open in result panels.
 */
export function registerMcpTools(
    context: vscode.ExtensionContext,
    azureService: AzureService
): void {
    context.subscriptions.push(
        vscode.lm.registerTool<ListTablesInput>('barge_list_tables', {
            invoke(_options, _token) {
                const tables = BargePanel.getAllPanelsInfo();
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(tables, null, 2))
                ]);
            }
        }),

        vscode.lm.registerTool<GetTableDataInput>('barge_get_table_data', {
            invoke(options, _token) {
                const { tableId, maxRows } = options.input;
                const result = BargePanel.getPanelResult(tableId);
                if (!result) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }

                const DEFAULT_MAX_ROWS = 500;
                const limit = typeof maxRows === 'number' && maxRows > 0 ? maxRows : DEFAULT_MAX_ROWS;
                const truncated = result.data.length > limit;
                const output = {
                    tableId,
                    query: result.query,
                    timestamp: result.timestamp,
                    executionTimeMs: result.executionTimeMs,
                    totalRecords: result.totalRecords,
                    columns: result.columns,
                    rowCount: result.data.length,
                    returnedRows: Math.min(limit, result.data.length),
                    truncated,
                    data: result.data.slice(0, limit)
                };
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(output, null, 2))
                ]);
            }
        }),

        vscode.lm.registerTool<SelectRowsInput>('barge_select_rows', {
            invoke(options, _token) {
                const { tableId, rowIndices } = options.input;
                const found = BargePanel.selectRows(tableId, rowIndices);
                if (!found) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, selectedRows: rowIndices.length })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<SelectCellsInput>('barge_select_cells', {
            invoke(options, _token) {
                const { tableId, cells } = options.input;
                const found = BargePanel.selectCells(tableId, cells);
                if (!found) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, selectedCells: cells.length })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<RunQueryInput>('barge_run_query', {
            async invoke(options, _token) {
                const { query, tableId } = options.input;

                if (!query || query.trim().length === 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: 'query must be a non-empty string' })
                        )
                    ]);
                }

                if (!azureService.isAuthenticated()) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: 'Not authenticated. Please sign in first using the bARGE: Sign In command.' })
                        )
                    ]);
                }

                try {
                    // Determine the target panel
                    let panel: BargePanel;
                    if (tableId) {
                        const existing = BargePanel.getTargetByTableId(tableId);
                        if (!existing) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ error: `No result table found with id: ${tableId}` })
                                )
                            ]);
                        }
                        panel = existing;
                    } else {
                        const fileKey = 'copilot';
                        panel = BargePanel.getOrCreateForFile(context.extensionUri, azureService, fileKey);
                    }

                    const success = await panel.runQuery(query, 'selection');

                    if (!success) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ success: false, tableId: panel.getPanelId(), message: 'Query execution failed. Check the bARGE results panel for details.' })
                            )
                        ]);
                    }

                    const result = BargePanel.getPanelResult(panel.getPanelId());
                    if (!result) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ success: false, tableId: panel.getPanelId(), message: 'Query execution did not produce any stored result.' })
                            )
                        ]);
                    }

                    if (result.query !== query) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ success: false, tableId: panel.getPanelId(), message: 'No fresh result found for the requested query. The panel may contain results from a previous query.' })
                            )
                        ]);
                    }

                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(JSON.stringify({
                            success: true,
                            tableId: panel.getPanelId(),
                            query: result.query,
                            timestamp: result.timestamp,
                            executionTimeMs: result.executionTimeMs,
                            totalRecords: result.totalRecords,
                            columns: result.columns,
                            rowCount: result.data.length
                        }, null, 2))
                    ]);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const prefix = 'Query execution failed:';
                    const errorMessage = message.trimStart().startsWith(prefix)
                        ? message
                        : `${prefix} ${message}`;
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: errorMessage })
                        )
                    ]);
                }
            }
        }),

        vscode.lm.registerTool<SortTableInput>('barge_sort_table', {
            invoke(options, _token) {
                const { tableId, column, direction } = options.input;
                const result = BargePanel.getPanelResult(tableId);
                if (!result) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }

                const colIndex = result.columns.findIndex(c => c.name === column);
                if (colIndex === -1) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({
                                error: `Column '${column}' not found. Available columns: ${result.columns.map(c => c.name).join(', ')}`
                            })
                        )
                    ]);
                }

                const sortDir = direction === 'desc' ? 'desc' : 'asc';
                const found = BargePanel.sortTable(tableId, column, sortDir);
                if (!found) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, column, direction: sortDir })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<FilterTableInput>('barge_filter_table', {
            invoke(options, _token) {
                const { tableId, filters } = options.input;
                const result = BargePanel.getPanelResult(tableId);
                if (!result) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }

                // Validate all column names exist
                const columnNames = result.columns.map(c => c.name);
                for (const filter of filters) {
                    if (!columnNames.includes(filter.column)) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({
                                    error: `Column '${filter.column}' not found. Available columns: ${columnNames.join(', ')}`
                                })
                            )
                        ]);
                    }
                }

                const found = BargePanel.filterTable(tableId, filters);
                if (!found) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({
                            success: true,
                            tableId,
                            appliedFilters: filters.map(f => ({ column: f.column, valueCount: f.values.length }))
                        })
                    )
                ]);
            }
        })
    );
}
