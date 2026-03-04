import * as vscode from 'vscode';

/**
 * Provides "Run Query" CodeLens buttons above each query block in KQL files.
 * A query block is defined as contiguous non-empty lines separated by blank lines.
 */
export class BargeCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    /**
     * Notify that code lenses need to be recomputed (e.g. after config change).
     */
    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('barge');
        if (!config.get<boolean>('enableRunQueryCodeLens', true)) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        const blocks = this.getQueryBlocks(document);

        for (const block of blocks) {
            const queryText = document.getText(block).trim();
            if (!queryText) {
                continue;
            }

            const lens = new vscode.CodeLens(block, {
                title: '► Run Query',
                command: 'barge.runQueryFromCodeLens',
                arguments: [queryText, document.fileName],
                tooltip: 'Run this query in bARGE'
            });
            lenses.push(lens);
        }

        return lenses;
    }

    /**
     * Find all query blocks in the document.
     * A block is a contiguous range of non-empty lines, separated by blank lines.
     */
    private getQueryBlocks(document: vscode.TextDocument): vscode.Range[] {
        const blocks: vscode.Range[] = [];
        const totalLines = document.lineCount;
        let blockStart = -1;

        for (let i = 0; i < totalLines; i++) {
            const lineText = document.lineAt(i).text.trim();

            if (lineText !== '') {
                // Start of a new block
                if (blockStart === -1) {
                    blockStart = i;
                }
            } else {
                // Empty line — close current block if one is open
                if (blockStart !== -1) {
                    const startPos = new vscode.Position(blockStart, 0);
                    const endPos = document.lineAt(i - 1).range.end;
                    blocks.push(new vscode.Range(startPos, endPos));
                    blockStart = -1;
                }
            }
        }

        // Close final block if it reaches the end of the document
        if (blockStart !== -1) {
            const startPos = new vscode.Position(blockStart, 0);
            const endPos = document.lineAt(totalLines - 1).range.end;
            blocks.push(new vscode.Range(startPos, endPos));
        }

        return blocks;
    }
}
