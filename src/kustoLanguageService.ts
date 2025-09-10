import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Enhanced Kusto Language Service Provider for bARGE
 * This is a simplified implementation that prepares for future integration
 * with @kusto/language-service-next when properly configured
 */
export class KustoLanguageServiceProvider implements 
    vscode.CompletionItemProvider,
    vscode.HoverProvider,
    vscode.SignatureHelpProvider,
    vscode.DocumentFormattingEditProvider {
    
    private disposables: vscode.Disposable[] = [];
    private diagnosticCollection: vscode.DiagnosticCollection;
    private schemaData: any = null;
    private completionData: any = null;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('kusto-enhanced');
        this.disposables.push(this.diagnosticCollection);
        this.loadSchemaData();
    }

    /**
     * Load schema data from generated files
     */
    private async loadSchemaData(): Promise<void> {
        try {
            let extensionPath = vscode.extensions.getExtension('palmemanuel.barge-vscode')?.extensionPath;
            
            if (extensionPath) {
                const schemaPath = path.join(extensionPath, 'src', 'schema', 'arg-schema.json');
                const completionPath = path.join(extensionPath, 'src', 'schema', 'completion-data.json');
                
                try {
                    const fs = require('fs');
                    this.schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
                    this.completionData = JSON.parse(fs.readFileSync(completionPath, 'utf8'));
                    console.log('📋 Loaded ARG schema with:', {
                        tables: Object.keys(this.schemaData.tables || {}).length,
                        resourceTypes: Object.keys(this.schemaData.resourceTypes || {}).length,
                        operators: (this.schemaData.operators || []).length,
                        functions: (this.schemaData.functions || []).length,
                        completionTables: (this.completionData.tables || []).length,
                        completionOperators: (this.completionData.operators || []).length
                    });
                } catch (error) {
                    console.error('❌ Could not load generated schema data:', error instanceof Error ? error.message : String(error));
                    console.error('Schema files are required for proper functionality. Please run schema generation.');
                    console.error('Expected files:', schemaPath, completionPath);
                }
            } else {
                console.error('❌ Extension path not found. Schema data cannot be loaded.');
            }
        } catch (error) {
            console.error('❌ Error loading schema data:', error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Enhanced completion provider with better KQL syntax understanding
     */
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);
        const currentWord = this.getCurrentWord(linePrefix);

        const completions: vscode.CompletionItem[] = [];

        // Enhanced KQL operators
        if (this.isAfterPipe(linePrefix) || this.isStartOfQuery(linePrefix)) {
            completions.push(...this.getKQLOperators());
        }

        // Function completions with snippets
        if (this.isInFunctionContext(linePrefix)) {
            completions.push(...this.getKQLFunctions());
        }

        // Enhanced property completions
        if (this.isPropertyContext(linePrefix)) {
            completions.push(...this.getEnhancedProperties());
        }

        // Table completions
        if (this.isStartOfQuery(linePrefix)) {
            completions.push(...this.getARGTables());
        }

        return completions;
    }

    /**
     * Enhanced hover provider with detailed KQL documentation
     */
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const hoverInfo = this.getKQLHoverInfo(word);

        if (hoverInfo) {
            return new vscode.Hover(hoverInfo, wordRange);
        }

        return null;
    }

    /**
     * Signature help for KQL functions
     */
    async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): Promise<vscode.SignatureHelp | null> {
        const line = document.lineAt(position).text;
        const beforeCursor = line.substring(0, position.character);
        
        // Find function call pattern
        const functionMatch = beforeCursor.match(/(\w+)\s*\(\s*([^)]*)$/);
        if (!functionMatch) {
            return null;
        }

        const functionName = functionMatch[1];
        const signature = this.getFunctionSignature(functionName);
        
        if (signature) {
            const signatureHelp = new vscode.SignatureHelp();
            signatureHelp.signatures = [signature];
            signatureHelp.activeSignature = 0;
            
            // Calculate active parameter
            const parameters = functionMatch[2];
            const parameterIndex = (parameters.match(/,/g) || []).length;
            signatureHelp.activeParameter = Math.min(parameterIndex, signature.parameters.length - 1);
            
            return signatureHelp;
        }

        return null;
    }

    /**
     * Document formatting with basic KQL formatting rules
     */
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        const text = document.getText();
        const formatted = this.formatKQL(text, options);
        
        if (formatted !== text) {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
        
        return [];
    }

    private getCurrentWord(linePrefix: string): string {
        const wordMatch = linePrefix.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        return wordMatch ? wordMatch[0] : '';
    }

    private isAfterPipe(linePrefix: string): boolean {
        return /\|\s*[a-zA-Z_]*$/.test(linePrefix);
    }

    private isStartOfQuery(linePrefix: string): boolean {
        const trimmed = linePrefix.trim();
        return trimmed === '' || /^\s*\/\//.test(linePrefix);
    }

    private isInFunctionContext(linePrefix: string): boolean {
        return /[a-zA-Z_][a-zA-Z0-9_]*\s*\($|[=\s]\s*[a-zA-Z_]*$/.test(linePrefix);
    }

    private isPropertyContext(linePrefix: string): boolean {
        return /\b(project|extend|where|summarize\s+by)\s+[a-zA-Z0-9_,.\s]*$/i.test(linePrefix) ||
               /[,\s]\s*[a-zA-Z0-9_]*$/.test(linePrefix);
    }

    private getKQLOperators(): vscode.CompletionItem[] {
        const operators: vscode.CompletionItem[] = [];
        
        // Use schema data only - no fallback
        if (this.completionData?.operators) {
            for (const op of this.completionData.operators) {
                const item = new vscode.CompletionItem(op.label, vscode.CompletionItemKind.Keyword);
                item.detail = op.detail;
                item.insertText = op.insertText;
                item.documentation = new vscode.MarkdownString(op.detail);
                operators.push(item);
            }
        }
        
        return operators;
    }

    /**
     * Get KQL functions from schema data
     */
    private getKQLFunctions(): vscode.CompletionItem[] {
        const functions: vscode.CompletionItem[] = [];
        
        // Use schema data only - no fallback
        if (this.completionData?.functions) {
            for (const fn of this.completionData.functions) {
                const item = new vscode.CompletionItem(fn.label, vscode.CompletionItemKind.Function);
                item.detail = fn.detail;
                item.insertText = new vscode.SnippetString(fn.insertText);
                item.documentation = new vscode.MarkdownString(fn.detail);
                functions.push(item);
            }
        }
        
        return functions;
    }

    /**
     * Get enhanced property completions from schema data
     */
    private getEnhancedProperties(): vscode.CompletionItem[] {
        const properties: vscode.CompletionItem[] = [];
        
        // Use schema data only - no fallback
        if (this.completionData?.properties) {
            for (const prop of this.completionData.properties) {
                const item = new vscode.CompletionItem(prop.label, vscode.CompletionItemKind.Property);
                item.detail = prop.detail;
                item.insertText = prop.insertText;
                item.documentation = new vscode.MarkdownString(prop.detail);
                if (prop.resourceType) {
                    item.filterText = `${prop.label} ${prop.resourceType}`;
                }
                properties.push(item);
            }
        }
        
        return properties;
    }

    /**
     * Get Azure Resource Graph table completions from schema data
     */
    private getARGTables(): vscode.CompletionItem[] {
        const tables: vscode.CompletionItem[] = [];
        
        // Use schema data only - no fallback
        if (this.completionData?.tables) {
            for (const table of this.completionData.tables) {
                const item = new vscode.CompletionItem(table.label, vscode.CompletionItemKind.Class);
                item.detail = table.detail;
                item.insertText = table.insertText;
                item.documentation = new vscode.MarkdownString(table.detail);
                tables.push(item);
            }
        }
        
        return tables;
    }

    private getKQLHoverInfo(word: string): vscode.MarkdownString | null {
        const info = this.getKQLDocumentation(word.toLowerCase());
        if (info) {
            return new vscode.MarkdownString(info);
        }
        return null;
    }

    private getKQLDocumentation(word: string): string | null {
        const lowerWord = word.toLowerCase();
        
        // Check schema data first if available
        if (this.schemaData) {
            // Check operators
            if (this.schemaData.operators) {
                const operator = this.schemaData.operators.find((op: any) => op.name.toLowerCase() === lowerWord);
                if (operator) {
                    return `**${operator.name}** - ${operator.description}\n\n\`${operator.syntax}\``;
                }
            }
            
            // Check functions
            if (this.schemaData.functions) {
                const func = this.schemaData.functions.find((fn: any) => fn.name.toLowerCase() === lowerWord);
                if (func) {
                    return `**${func.name}()** - ${func.description}\n\n\`${func.syntax}\``;
                }
            }
            
            // Check tables
            if (this.schemaData.tables) {
                const table = this.schemaData.tables[lowerWord];
                if (table) {
                    return `**${table.name}** - ${table.description}`;
                }
            }
            
            // Check resource types
            if (this.schemaData.resourceTypes) {
                const resourceType = this.schemaData.resourceTypes[lowerWord];
                if (resourceType) {
                    return `**${resourceType.name}** - ${resourceType.description}\n\nTable: ${resourceType.table}`;
                }
            }
        }
        
        // Fallback to minimal hardcoded documentation for basic KQL syntax only
        const docs: Record<string, string> = {
            'where': '**where** - Filters a table to the subset of rows that satisfy a predicate.\n\n`| where condition`',
            'project': '**project** - Select the columns to include, rename or drop, and insert new computed columns.\n\n`| project column1, column2, newColumn = expression`',
            'extend': '**extend** - Create calculated columns and append them to the result set.\n\n`| extend newColumn = expression`',
            'summarize': '**summarize** - Produce a table that aggregates the content of the input table.\n\n`| summarize aggregation by grouping`',
            'join': '**join** - Merge the rows of two tables to form a new table by matching values of the specified columns from each table.\n\n`| join kind=inner (table) on condition`',
            'union': '**union** - Take the rows from multiple tables and return them in a single table.\n\n`| union table1, table2`',
            'sort': '**sort** - Sort the rows of the input table into order by one or more columns.\n\n`| sort by column asc|desc`',
            'take': '**take** - Return up to the specified number of rows.\n\n`| take numberOfRows`',
            'limit': '**limit** - Return up to the specified number of rows (alias for take).\n\n`| limit numberOfRows`',
            'count': '**count** - Return the number of records in the input record set.\n\n`| count`',
            'distinct': '**distinct** - Produces a table with the distinct combination of the provided columns.\n\n`| distinct column1, column2`'
        };

        return docs[lowerWord] || null;
    }

    private getFunctionSignature(functionName: string): vscode.SignatureInformation | null {
        const signatures: Record<string, { label: string; params: string[]; docs: string }> = {
            'count': {
                label: 'count()',
                params: [],
                docs: 'Returns the number of records in the input record set'
            },
            'sum': {
                label: 'sum(expr)',
                params: ['expr: Expression to sum'],
                docs: 'Returns the sum of all expr values in the group'
            },
            'avg': {
                label: 'avg(expr)',
                params: ['expr: Expression to average'],
                docs: 'Returns the average value of expr across the group'
            },
            'max': {
                label: 'max(expr)',
                params: ['expr: Expression to find maximum'],
                docs: 'Returns the maximum value of expr in the group'
            },
            'min': {
                label: 'min(expr)',
                params: ['expr: Expression to find minimum'],
                docs: 'Returns the minimum value of expr in the group'
            },
            'tostring': {
                label: 'tostring(value)',
                params: ['value: Value to convert'],
                docs: 'Converts the input value to a string representation'
            },
            'contains': {
                label: 'contains(source, search)',
                params: ['source: Source string', 'search: String to search for'],
                docs: 'Returns true if search is found as a substring of source'
            }
        };

        const sig = signatures[functionName.toLowerCase()];
        if (sig) {
            const signature = new vscode.SignatureInformation(sig.label, sig.docs);
            signature.parameters = sig.params.map(p => new vscode.ParameterInformation(p));
            return signature;
        }

        return null;
    }

    private formatKQL(text: string, options: vscode.FormattingOptions): string {
        // Basic KQL formatting - can be enhanced later
        const lines = text.split('\n');
        const formatted: string[] = [];
        
        for (let line of lines) {
            line = line.trim();
            if (line === '') {
                formatted.push('');
                continue;
            }
            
            // Add proper spacing around pipes
            line = line.replace(/\s*\|\s*/g, '\n| ');
            
            // Handle multiline - split on pipes but keep first line without pipe
            const parts = line.split('\n| ');
            if (parts.length > 1) {
                formatted.push(parts[0]);
                for (let i = 1; i < parts.length; i++) {
                    formatted.push('| ' + parts[i]);
                }
            } else {
                formatted.push(line);
            }
        }
        
        return formatted.join('\n');
    }

    /**
     * Update diagnostics for KQL syntax checking
     */
    private async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'kql') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '' || line.startsWith('//')) {
                continue;
            }

            // Check for potential table name typos using schema data
            const tableMatches = line.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*(\||$)/);
            if (tableMatches) {
                const tableName = tableMatches[1];
                if (!this.isValidTableName(tableName)) {
                    const range = new vscode.Range(
                        i,
                        line.indexOf(tableName),
                        i,
                        line.indexOf(tableName) + tableName.length
                    );
                    const suggestions = this.getSimilarTableNames(tableName);
                    const message = suggestions.length > 0 
                        ? `Unknown table '${tableName}'. Did you mean: ${suggestions.join(', ')}?`
                        : `Unknown table '${tableName}'`;
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            // Check for potential operator typos using schema data
            const operatorMatches = line.match(/\|\s*([a-zA-Z]+)/);
            if (operatorMatches) {
                const operator = operatorMatches[1];
                if (!this.isValidOperator(operator)) {
                    const range = new vscode.Range(
                        i,
                        line.indexOf(operator),
                        i,
                        line.indexOf(operator) + operator.length
                    );
                    const suggestions = this.getSimilarOperatorNames(operator);
                    const message = suggestions.length > 0
                        ? `Unknown operator '${operator}'. Did you mean: ${suggestions.join(', ')}?`
                        : `Unknown operator '${operator}'`;
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            // Basic syntax checking
            if (line.includes('|') && !line.match(/^\s*\|/)) {
                // Line contains pipe but doesn't start with pipe - might be malformed
                const pipeIndex = line.indexOf('|');
                const range = new vscode.Range(i, pipeIndex, i, pipeIndex + 1);
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    'Consider starting operator lines with |',
                    vscode.DiagnosticSeverity.Information
                ));
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private isValidTableName(name: string): boolean {
        const lowerName = name.toLowerCase();
        
        // Check schema data first
        if (this.schemaData?.tables) {
            return !!this.schemaData.tables[lowerName];
        }
        
        // Check completion data
        if (this.completionData?.tables) {
            return this.completionData.tables.some((table: any) => 
                table.label.toLowerCase() === lowerName
            );
        }
        
        // No fallback - if schema isn't loaded, return false
        return false;
    }

    private isValidOperator(name: string): boolean {
        const lowerName = name.toLowerCase();
        
        // Check schema data first
        if (this.schemaData?.operators) {
            return this.schemaData.operators.some((op: any) => op.name.toLowerCase() === lowerName);
        }
        
        // Check completion data
        if (this.completionData?.operators) {
            return this.completionData.operators.some((op: any) => 
                op.label.toLowerCase() === lowerName
            );
        }
        
        // No fallback - if schema isn't loaded, return false
        return false;
    }

    private getSimilarTableNames(name: string): string[] {
        const lowerName = name.toLowerCase();
        let tableNames: string[] = [];
        
        // Get table names from schema data only
        if (this.schemaData?.tables) {
            tableNames = Object.keys(this.schemaData.tables);
        } else if (this.completionData?.tables) {
            tableNames = this.completionData.tables.map((table: any) => table.label);
        }
        
        // No fallback - if no schema data, return empty array
        if (tableNames.length === 0) {
            return [];
        }
        
        // Simple similarity check - starts with same letter or contains similar substring
        return tableNames
            .filter(table => 
                table.toLowerCase().startsWith(lowerName[0]) || 
                this.calculateSimilarity(lowerName, table.toLowerCase()) > 0.6
            )
            .slice(0, 3);
    }

    private getSimilarOperatorNames(name: string): string[] {
        const lowerName = name.toLowerCase();
        let operatorNames: string[] = [];
        
        // Get operator names from schema data only
        if (this.schemaData?.operators) {
            operatorNames = this.schemaData.operators.map((op: any) => op.name);
        } else if (this.completionData?.operators) {
            operatorNames = this.completionData.operators.map((op: any) => op.label);
        }
        
        // No fallback - if no schema data, return empty array
        if (operatorNames.length === 0) {
            return [];
        }
        
        return operatorNames
            .filter(op => 
                op.toLowerCase().startsWith(lowerName[0]) || 
                this.calculateSimilarity(lowerName, op.toLowerCase()) > 0.6
            )
            .slice(0, 3);
    }

    private calculateSimilarity(str1: string, str2: string): number {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));

        for (let i = 0; i <= len1; i++) {
            matrix[0][i] = i;
        }
        for (let j = 0; j <= len2; j++) {
            matrix[j][0] = j;
        }

        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + indicator
                );
            }
        }

        return 1 - matrix[len2][len1] / Math.max(len1, len2);
    }

    /**
     * Register all enhanced language features
     */
    public register(context: vscode.ExtensionContext): void {
        const documentSelector: vscode.DocumentSelector = { scheme: 'file', language: 'kql' };
        
        // Register enhanced providers
        this.disposables.push(
            vscode.languages.registerCompletionItemProvider(
                documentSelector,
                this,
                '.', '|', ' ', '=', "'", '"', '(', ','
            ),
            vscode.languages.registerHoverProvider(documentSelector, this),
            vscode.languages.registerSignatureHelpProvider(
                documentSelector,
                this,
                '(', ','
            ),
            vscode.languages.registerDocumentFormattingEditProvider(documentSelector, this)
        );

        // Set up diagnostics
        const updateDiagnostics = (document: vscode.TextDocument) => {
            this.updateDiagnostics(document);
        };

        vscode.workspace.textDocuments.forEach(updateDiagnostics);
        
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
            vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document)),
            vscode.workspace.onDidCloseTextDocument(doc => this.diagnosticCollection.delete(doc.uri))
        );

        // Add all disposables to context
        context.subscriptions.push(...this.disposables);
        
        console.log('Enhanced Kusto Language Service registered for bARGE');
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
