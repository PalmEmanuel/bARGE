import * as vscode from 'vscode';
import { BargePanel } from './bargePanel';
import { AzureService } from './azure/azureService';

interface ListTablesInput {
    // No required parameters
}

interface GetTableDataInput {
    tableId: string;
    maxRows?: number;
    ignoreFilters?: boolean;
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
    
    // Default maximum number of rows to return when fetching table data via get_barge_table_data tool
    const DEFAULT_MAX_ROWS = 100;

    context.subscriptions.push(
        vscode.lm.registerTool<ListTablesInput>('list_barge_tables', {
            prepareInvocation(_options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Listing** bARGE tables (tabs)...`)
                };
            },
            invoke(_options, _token) {
                const tables = BargePanel.getAllPanelsInfo();
                return new vscode.LanguageModelToolResult([
                    vscode.LanguageModelDataPart.text(
                        `**Listed** ${tables.length} bARGE table${tables.length !== 1 ? 's' : ''}.`,
                        'text/markdown'
                    ),
                    new vscode.LanguageModelTextPart(JSON.stringify(tables, null, 2))
                ]);
            }
        }),

        vscode.lm.registerTool<GetTableDataInput>('get_barge_table_data', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Reading** bARGE table data (max ${options.input.maxRows ?? DEFAULT_MAX_ROWS} rows)${options.input.ignoreFilters ? ', ignoring active filters' : ''}...`)
                };
            },
            invoke(options, _token) {
                const { tableId, maxRows, ignoreFilters } = options.input;
                const result = ignoreFilters
                    ? BargePanel.getPanelRawResult(tableId)
                    : BargePanel.getPanelResult(tableId);
                if (!result) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }

                const limit = typeof maxRows === 'number' && maxRows > 0 ? maxRows : DEFAULT_MAX_ROWS;
                const truncated = result.data.length > limit;
                const output = {
                    tableId,
                    query: result.query,
                    timestamp: result.timestamp,
                    executionTimeMs: result.executionTimeMs,
                    totalRecords: result.totalRecords,
                    columns: result.columns,
                    ignoreFilters: !!ignoreFilters,
                    rowCount: result.data.length,
                    returnedRows: Math.min(limit, result.data.length),
                    truncated,
                    data: result.data.slice(0, limit)
                };
                return new vscode.LanguageModelToolResult([
                    vscode.LanguageModelDataPart.text(
                        `**Read** ${output.returnedRows} row${output.returnedRows !== 1 ? 's' : ''} of bARGE table data${ignoreFilters ? ', ignoring' : ' with'} active filters.`,
                        'text/markdown'
                    ),
                    new vscode.LanguageModelTextPart(JSON.stringify(output, null, 2))
                ]);
            }
        }),

        vscode.lm.registerTool<SelectRowsInput>('select_barge_rows', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Selecting** ${options.input.rowIndices.length} row${options.input.rowIndices.length !== 1 ? 's' : ''} in the table...`)
                };
            },
            invoke(options, _token) {
                const { tableId, rowIndices } = options.input;
                // This posts a selectRows message to the webview, which triggers the same logic as a user click (comparison view, etc.)
                const found = BargePanel.selectRows(tableId, rowIndices);
                if (!found) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            JSON.stringify({ error: `No result table found with id: ${tableId}` })
                        )
                    ]);
                }
                return new vscode.LanguageModelToolResult([
                    vscode.LanguageModelDataPart.text(
                        `**Selected** ${rowIndices.length} row${rowIndices.length !== 1 ? 's' : ''} in the table.`,
                        'text/markdown'
                    ),
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, selectedRows: rowIndices.length })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<SelectCellsInput>('select_barge_cells', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Selecting** ${options.input.cells.length} cell${options.input.cells.length !== 1 ? 's' : ''} in the table...`)
                };
            },
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
                    vscode.LanguageModelDataPart.text(
                        `**Selected** ${cells.length} cell${cells.length !== 1 ? 's' : ''} in the table.`,
                        'text/markdown'
                    ),
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, selectedCells: cells.length })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<RunQueryInput>('run_barge_query', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Querying** ARG using bARGE:\n\n\`\`\`\n${options.input.query}\n\`\`\``)
                };
            },
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
                                JSON.stringify({
                                    success: false,
                                    tableId: panel.getPanelId(),
                                    requestedQuery: query,
                                    message: 'Query execution failed. Check the bARGE results panel for details.'
                                })
                            )
                        ]);
                    }

                    const result = BargePanel.getPanelResult(panel.getPanelId());
                    if (!result) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({
                                    success: false,
                                    tableId: panel.getPanelId(),
                                    requestedQuery: query,
                                    message: 'Query execution did not produce any stored result.'
                                })
                            )
                        ]);
                    }

                    if (result.query !== query) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({
                                    success: false,
                                    tableId: panel.getPanelId(),
                                    requestedQuery: query,
                                    message: 'No fresh result found for the requested query. The panel may contain results from a previous query.'
                                })
                            )
                        ]);
                    }

                    return new vscode.LanguageModelToolResult([
                        vscode.LanguageModelDataPart.text(
                            `**Queried** ARG using bARGE\n\n\`\`\`\n${options.input.query}\n\`\`\``,
                            'text/markdown'
                        ),
                        new vscode.LanguageModelTextPart(JSON.stringify({
                            success: true,
                            tableId: panel.getPanelId(),
                            requestedQuery: query,
                            executedQuery: result.query,
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

        vscode.lm.registerTool<SortTableInput>('sort_barge_table', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Sorting** column '${options.input.column}' in ${options.input.direction} order...`)
                };
            },
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
                    vscode.LanguageModelDataPart.text(
                        `**Sorted** column '${column}' ${sortDir}.`,
                        'text/markdown'
                    ),
                    new vscode.LanguageModelTextPart(
                        JSON.stringify({ success: true, tableId, column, direction: sortDir })
                    )
                ]);
            }
        }),

        vscode.lm.registerTool<FilterTableInput>('filter_barge_table', {
            prepareInvocation(options, _token) {
                return {
                    invocationMessage: new vscode.MarkdownString(`**Filtering** table on ${options.input.filters.map(f => f.column).join(', ')}...`)
                };
            },
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

                // Validate all column names exist and are not object/array types
                const columnMap = new Map(result.columns.map(c => [c.name, c.type]));
                for (const filter of filters) {
                    const colType = columnMap.get(filter.column);
                    if (!colType) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({
                                    error: `Column '${filter.column}' not found. Available columns: ${Array.from(columnMap.keys()).join(', ')}`
                                })
                            )
                        ]);
                    }
                    if (colType === 'object' || colType === 'array') {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({
                                    error: `Filtering on column '${filter.column}' of type '${colType}' is not supported. Only primitive columns can be filtered.`
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
                    vscode.LanguageModelDataPart.text(
                        `**Filtered** table\n\n${options.input.filters.map(f => f.column).join(', ')}.`,
                        'text/markdown'
                    ),
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
