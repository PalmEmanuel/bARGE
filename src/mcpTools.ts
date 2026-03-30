import * as vscode from 'vscode';
import { BargePanel } from './bargePanel';

interface ListTablesInput {
    // No required parameters
}

interface GetTableDataInput {
    tableId: string;
    maxRows?: number;
}

/**
 * Register bARGE Language Model Tools so that GitHub Copilot can query
 * the tables that are currently open in result panels.
 */
export function registerMcpTools(context: vscode.ExtensionContext): void {
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

                const limit = typeof maxRows === 'number' && maxRows > 0 ? maxRows : result.data.length;
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
        })
    );
}
