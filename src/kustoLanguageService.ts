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
    private isHovering: boolean = false;
    private currentHoverWord: string = '';
    private cachedExamples: Map<string, any[]> = new Map();

    // Getter for schema access
    private get schema(): any {
        return this.schemaData;
    }

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

                try {
                    const fs = require('fs');
                    this.schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
                    console.log('📋 Loaded ARG schema with:', {
                        tables: Object.keys(this.schemaData.tables || {}).length,
                        resourceTypes: Object.keys(this.schemaData.resourceTypes || {}).length,
                        operators: (this.schemaData.operators || []).length,
                        functions: (this.schemaData.functions || []).length
                    });
                } catch (error) {
                    console.error('❌ Could not load generated schema data:', error instanceof Error ? error.message : String(error));
                    console.error('Schema files are required for proper functionality. Please run schema generation.');
                    console.error('Expected files:', schemaPath);
                }
            } else {
                console.error('❌ Extension path not found. Schema data cannot be loaded.');
            }
        } catch (error) {
            console.error('❌ Error loading schema data:', error instanceof Error ? error.message : String(error));
        }
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);
        const currentWord = this.getCurrentWord(linePrefix);

        // Get contextual suggestions based on sophisticated analysis
        const suggestions = this.getContextualSuggestions(linePrefix, currentWord);

        return suggestions;
    }

    /**
     * Get contextual completion suggestions based on sophisticated KQL syntax analysis
     */
    private getContextualSuggestions(linePrefix: string, currentWord: string): vscode.CompletionItem[] {
        const suggestions: vscode.CompletionItem[] = [];
        const lowerCurrentWord = currentWord.toLowerCase();

        // At start of line or after pipe - suggest tables and operators
        if (this.isStartOfStatement(linePrefix)) {
            suggestions.push(...this.filterCompletionItems(this.getARGTables(), lowerCurrentWord));
            suggestions.push(...this.filterCompletionItems(this.getKQLOperators(), lowerCurrentWord));
        }

        // After pipe - suggest operators
        else if (this.isAfterPipe(linePrefix)) {
            suggestions.push(...this.filterCompletionItems(this.getKQLOperators(), lowerCurrentWord));
        }

        // In function context - suggest functions
        else if (this.isInFunctionContext(linePrefix)) {
            suggestions.push(...this.filterCompletionItems(this.getKQLFunctions(), lowerCurrentWord));
        }

        // After 'type ==' or 'type =~' - suggest resource types
        else if (this.isResourceTypeContext(linePrefix)) {
            suggestions.push(...this.filterCompletionItems(this.getResourceTypes(), lowerCurrentWord));
        }

        // In project, extend, where, or summarize by context - suggest properties and functions
        else if (this.isPropertyContext(linePrefix)) {
            suggestions.push(...this.getCommonColumns(lowerCurrentWord));
            suggestions.push(...this.filterCompletionItems(this.getKQLFunctions(), lowerCurrentWord));
            suggestions.push(...this.filterCompletionItems(this.getResourceTypes(), lowerCurrentWord));
        }

        // Default: suggest common operators and functions
        else {
            suggestions.push(...this.filterCompletionItems(this.getKQLOperators(), lowerCurrentWord));
            suggestions.push(...this.filterCompletionItems(this.getKQLFunctions(), lowerCurrentWord));

            // Add common column names
            suggestions.push(...this.getCommonColumns(lowerCurrentWord));
        }

        return suggestions;
    }

    /**
     * Check if we're at the start of a statement
     */
    private isStartOfStatement(linePrefix: string): boolean {
        const trimmed = linePrefix.trim();
        // Empty line or comment
        if (trimmed === '' || /^\s*\/\//.test(linePrefix)) {
            return true;
        }
        // Single word at start of line (likely a table name being typed)
        if (/^\s*[a-zA-Z_][a-zA-Z0-9_]*$/.test(linePrefix)) {
            return true;
        }
        return false;
    }

    /**
     * Check if we're in a resource type context (after type == or type =~)
     */
    private isResourceTypeContext(linePrefix: string): boolean {
        return /\btype\s*(==|=~)\s*['"]*[a-zA-Z0-9./]*$/i.test(linePrefix);
    }

    /**
     * Filter completion items based on current word
     */
    private filterCompletionItems(items: vscode.CompletionItem[], filter: string): vscode.CompletionItem[] {
        if (!filter) {
            return items;
        }

        return items.filter(item => {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            return label.toLowerCase().includes(filter) ||
                (item.detail && item.detail.toLowerCase().includes(filter));
        });
    }

    /**
     * Get common column completions
     */
    private getCommonColumns(filter: string): vscode.CompletionItem[] {
        const commonColumns = [
            { label: 'id', detail: 'Resource ID', insertText: 'id' },
            { label: 'name', detail: 'Resource name', insertText: 'name' },
            { label: 'type', detail: 'Resource type', insertText: 'type' },
            { label: 'location', detail: 'Resource location', insertText: 'location' },
            { label: 'resourceGroup', detail: 'Resource group', insertText: 'resourceGroup' },
            { label: 'subscriptionId', detail: 'Subscription ID', insertText: 'subscriptionId' },
            { label: 'tags', detail: 'Resource tags', insertText: 'tags' },
            { label: 'properties', detail: 'Resource properties', insertText: 'properties' },
            { label: 'sku', detail: 'Resource SKU', insertText: 'sku' },
            { label: 'kind', detail: 'Resource kind', insertText: 'kind' }
        ];

        const items: vscode.CompletionItem[] = [];
        for (const column of commonColumns) {
            if (!filter || column.label.toLowerCase().includes(filter) ||
                column.detail.toLowerCase().includes(filter)) {
                const item = new vscode.CompletionItem(column.label, vscode.CompletionItemKind.Property);
                item.detail = column.detail;
                item.insertText = column.insertText;
                item.sortText = `4_${column.label}`;
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Get resource type completions from schema data
     */
    private getResourceTypes(): vscode.CompletionItem[] {
        const resourceTypes: vscode.CompletionItem[] = [];

        // Use schema data instead of completion data
        if (this.schema?.resourceTypes) {
            for (const rt of Object.keys(this.schema.resourceTypes)) {
                const item = new vscode.CompletionItem(rt, vscode.CompletionItemKind.Value);
                item.detail = `Resource Type - ${rt}`;
                item.insertText = `'${rt}'`;
                item.sortText = `5_${rt}`;
                resourceTypes.push(item);
            }
        }

        return resourceTypes;
    }

    /**
     * Enhanced hover provider with detailed KQL documentation
     */
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        // Use enhanced word range detection to handle operators like !contains, mv-apply
        const enhancedWordInfo = this.getEnhancedWordRange(document, position);
        if (!enhancedWordInfo) {
            // Reset hover state when not on a word
            this.resetHoverState();
            return null;
        }

        const word = enhancedWordInfo.text;
        const wordRange = enhancedWordInfo.range;

        // Reset hover state if we're hovering over a different word
        if (this.currentHoverWord !== word.toLowerCase()) {
            this.resetHoverState();
        }

        // Get the line text to check for context (like parentheses)
        const lineText = document.lineAt(position).text;
        const wordStart = wordRange.start.character;
        const wordEnd = wordRange.end.character;
        const textAfterWord = lineText.substring(wordEnd).trim();

        const hoverInfo = this.getKQLHoverInfo(word, textAfterWord);

        if (hoverInfo) {
            return new vscode.Hover(hoverInfo, wordRange);
        }

        return null;
    }

    /**
     * Reset hover state for new hover sessions
     */
    private resetHoverState(): void {
        this.isHovering = false;
        this.currentHoverWord = '';
        this.cachedExamples.clear();
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

    /**
     * Enhanced word range detection that handles KQL operators with special characters
     * Supports patterns like:
     * - !contains, !has, !startswith (exclamation prefix)
     * - mv-apply, mv-expand (hyphen separator)
     * - project-away, project-keep (hyphen separator)
     */
    private getEnhancedWordRange(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range; text: string } | null {
        const line = document.lineAt(position);
        const lineText = line.text;
        const charIndex = position.character;

        // If cursor is beyond line length, return null
        if (charIndex > lineText.length) {
            return null;
        }

        // Find the start and end of the word/operator
        let start = charIndex;
        let end = charIndex;

        // If cursor is on a special character, adjust start position
        const currentChar = charIndex < lineText.length ? lineText[charIndex] : '';
        if (currentChar === '!' && charIndex < lineText.length - 1 && this.isValidWordChar(lineText[charIndex + 1])) {
            // Cursor is on ! and next char is a valid word char, so we're at the start of !contains or similar
            // Don't adjust start, let the backward loop handle it
        } else if (!this.isValidWordChar(currentChar) && currentChar !== '!' && currentChar !== '-') {
            // If cursor is not on a word character, try to find the nearest word
            // Move backward first to see if we're just after a word
            if (charIndex > 0 && (this.isValidWordChar(lineText[charIndex - 1]) || lineText[charIndex - 1] === '!' || lineText[charIndex - 1] === '-')) {
                start = charIndex - 1;
                end = charIndex - 1;
            } else {
                return null;
            }
        }

        // Move backward to find the start of the word/operator
        while (start > 0) {
            const char = lineText[start - 1];
            if (this.isValidWordChar(char)) {
                start--;
            } else if (char === '!') {
                // Special case: include ! prefix for operators like !contains, !has
                start--;
                break;
            } else if (char === '-' && start > 0) {
                // Check if this might be part of a compound operator like mv-apply
                const prevChar = lineText[start - 2];
                if (prevChar && this.isValidWordChar(prevChar)) {
                    start--;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        // Move forward to find the end of the word/operator
        while (end < lineText.length) {
            const char = lineText[end];
            if (this.isValidWordChar(char)) {
                end++;
            } else if (char === '-' && end < lineText.length - 1) {
                // Check if this might be part of a compound operator like mv-apply
                const nextChar = lineText[end + 1];
                if (nextChar && this.isValidWordChar(nextChar)) {
                    end++;
                } else {
                    break;
                }
            } else if (char === '~') {
                // Include ~ suffix for operators like contains~, in~
                end++;
                break; // ~ is always at the end, so we can break after including it
            } else {
                break;
            }
        }

        // If we didn't find a valid word, return null
        if (start >= end) {
            return null;
        }

        const wordText = lineText.substring(start, end);

        // Validate that we have a meaningful word/operator
        if (!wordText || !this.isValidKQLWord(wordText)) {
            return null;
        }

        const range = new vscode.Range(
            new vscode.Position(position.line, start),
            new vscode.Position(position.line, end)
        );

        return { range, text: wordText };
    }

    /**
     * Check if a character is valid for KQL words (letters, numbers, underscore)
     */
    private isValidWordChar(char: string): boolean {
        return /[a-zA-Z0-9_]/.test(char);
    }

    /**
     * Validate that a word is a potential KQL word/operator
     */
    private isValidKQLWord(word: string): boolean {
        // Must contain at least one letter
        if (!/[a-zA-Z]/.test(word)) {
            return false;
        }

        // Valid patterns:
        // - Regular words: project, where, contains
        // - Exclamation operators: !contains, !has
        // - Hyphenated operators: mv-apply, project-away
        // - Case-insensitive operators: contains~, in~
        // - Combined: !contains~, !in~
        return /^(!?[a-zA-Z][a-zA-Z0-9_]*(-[a-zA-Z][a-zA-Z0-9_]*)*~?)$/.test(word);
    }

    /**
     * Enhanced getCurrentWord that handles KQL operators with special characters
     * like !contains, mv-apply, project-away
     */
    private getCurrentWord(linePrefix: string): string {
        // Enhanced pattern to match KQL words/operators with special characters
        // Matches patterns like: word, !word, word-word, !word-word, word~, !word~, !word-word~
        const enhancedWordMatch = linePrefix.match(/(!?[a-zA-Z_][a-zA-Z0-9_]*(-[a-zA-Z_][a-zA-Z0-9_]*)*~?)$/);
        if (enhancedWordMatch) {
            return enhancedWordMatch[0];
        }

        // Fallback to original pattern for simple words
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

        // Use schema data for keywords
        if (this.schema?.keywords) {
            for (const kw of this.schema.keywords) {
                const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
                item.detail = `Keyword - ${kw.category}`;
                item.insertText = kw.name;

                // Use getKQLDocumentation for consistent documentation formatting
                const documentation = this.getKQLDocumentation(kw.name);
                if (documentation) {
                    item.documentation = new vscode.MarkdownString(documentation);
                } else {
                    item.documentation = new vscode.MarkdownString(kw.category);
                }

                item.sortText = `2_${kw.name}`;
                item.filterText = kw.name;
                operators.push(item);
            }
        }

        // Use schema data for operators
        if (this.schema?.operators) {
            for (const op of this.schema.operators) {
                const item = new vscode.CompletionItem(op.name, vscode.CompletionItemKind.Function);
                item.detail = `Operator - ${op.category}`;
                item.insertText = op.name;

                // Use getKQLDocumentation for consistent documentation formatting
                const documentation = this.getKQLDocumentation(op.name);
                if (documentation) {
                    item.documentation = new vscode.MarkdownString(documentation);
                } else {
                    item.documentation = new vscode.MarkdownString(op.category);
                }

                item.sortText = `2_${op.name}`;
                item.filterText = op.name;
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

        // Use schema data instead of completion data
        if (this.schema?.functions) {
            for (const fn of this.schema.functions) {
                const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
                item.detail = `Function - ${fn.category}`;

                // Create snippet for function parameters if available
                if (fn.documentation?.parametersTable) {
                    // Extract parameter names for snippet (simplified)
                    const paramMatch = fn.documentation.parametersTable.match(/\| \*([^*]+)\*/g);
                    if (paramMatch && paramMatch.length > 0) {
                        const params = paramMatch.map((match: string, index: number) => `\${${index + 1}:${match.replace(/\| \*([^*]+)\*.*/, '$1')}}`).join(', ');
                        item.insertText = new vscode.SnippetString(`${fn.name}(${params})`);
                    } else {
                        item.insertText = new vscode.SnippetString(`${fn.name}($1)`);
                    }
                } else {
                    item.insertText = new vscode.SnippetString(`${fn.name}($1)`);
                }

                // Format function documentation
                const documentation = this.getKQLDocumentation(fn.name, '(');
                if (documentation) {
                    item.documentation = new vscode.MarkdownString(documentation);
                } else {
                    item.documentation = new vscode.MarkdownString(fn.category);
                }

                item.sortText = `3_${fn.name}`;
                functions.push(item);
            }
        }

        return functions;
    }

    /**
     * Get Azure Resource Graph table completions from schema data
     */
    private getARGTables(): vscode.CompletionItem[] {
        const tables: vscode.CompletionItem[] = [];

        // Use schema data directly - this avoids duplication in completion-data.json
        if (this.schema?.tables) {
            for (const [tableName, tableData] of Object.entries(this.schema.tables)) {
                const item = new vscode.CompletionItem(tableName, vscode.CompletionItemKind.Class);

                // Generate detail from description
                const data = tableData as any; // Type assertion for schema data
                const description = data.description || 'Azure Resource Graph table';
                item.detail = `Table - ${description}`;

                // Add newline, pipe, and space after table name for easier operator chaining
                item.insertText = new vscode.SnippetString(`${tableName}\n| `);

                // Use getKQLDocumentation for consistent documentation formatting
                const documentation = this.getKQLDocumentation(tableName);
                if (documentation) {
                    item.documentation = new vscode.MarkdownString(documentation);
                }

                item.sortText = `1_${tableName}`;
                tables.push(item);
            }
        }

        return tables;
    }

    /**
     * Randomly select examples from a table's examples array with hover state tracking
     * @param tableName Name of the table for cache key
     * @param examples Array of examples (can be strings or objects)
     * @param count Number of examples to select (default: 2)
     * @returns Array of selected examples
     */
    private selectRandomExamples(tableName: string, examples: any[], count: number = 2): any[] {
        if (!examples || examples.length === 0) {
            return [];
        }

        // If we have fewer examples than requested, return all
        if (examples.length <= count) {
            return examples;
        }

        const cacheKey = `${tableName}_${count}`;

        // If we're already hovering on the same word, return cached examples
        if (this.isHovering && this.currentHoverWord === tableName && this.cachedExamples.has(cacheKey)) {
            return this.cachedExamples.get(cacheKey)!;
        }

        // New hover session - generate new random examples
        const selected: any[] = [];
        const availableIndices = [...Array(examples.length).keys()];

        for (let i = 0; i < count && availableIndices.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * availableIndices.length);
            const exampleIndex = availableIndices.splice(randomIndex, 1)[0];
            selected.push(examples[exampleIndex]);
        }

        // Cache the selection and update hover state
        this.cachedExamples.set(cacheKey, selected);
        this.isHovering = true;
        this.currentHoverWord = tableName;

        return selected;
    }

    private getKQLHoverInfo(word: string, textAfterWord: string = ''): vscode.MarkdownString | null {
        const info = this.getKQLDocumentation(word.toLowerCase(), textAfterWord);
        if (info) {
            return new vscode.MarkdownString(info);
        }
        return null;
    }

    private getKQLDocumentation(word: string, textAfterWord: string = '', textBeforeWord: string = ''): string | null {
        let lowerWord = word.toLowerCase();
        const hasParentheses = textAfterWord.startsWith('(');
        const isAfterPipe = /\|\s*$/.test(textBeforeWord);

        // Handle operator variants with ! prefix and ~ suffix
        let baseOperatorName = lowerWord;
        let isNegated = false;
        let isCaseInsensitive = false;

        // Check for ! prefix (negation)
        if (lowerWord.startsWith('!')) {
            isNegated = true;
            baseOperatorName = lowerWord.substring(1);
        }

        // Check for ~ suffix (case-insensitive)
        if (baseOperatorName.endsWith('~')) {
            isCaseInsensitive = true;
            baseOperatorName = baseOperatorName.substring(0, baseOperatorName.length - 1);
        }

        // Check schema data first if available
        if (this.schemaData) {
            // If we detect parentheses, prioritize function and aggregate matching
            if (hasParentheses) {
                let func = null;

                // Check functions (includes all aggregates now)
                if (this.schemaData.functions) {
                    func = this.schemaData.functions.find((fn: any) => fn.name.toLowerCase() === lowerWord);
                }

                if (func) {
                    // If we have enhanced documentation, use it
                    if (func.documentation) {
                        const doc = func.documentation;
                        let hoverContent = `## Function \`${doc.title}\`\n\n`;
                        hoverContent += `*${func.category}*\n\n`;

                        // Description
                        if (doc.description) {
                            hoverContent += `${doc.description}\n\n`;
                        }

                        // Add Microsoft Learn URL if available
                        if (doc.url) {
                            hoverContent += `[Details on Microsoft Learn](${doc.url}?wt.mc_id=DT-MVP-5005372)\n\n`;
                        }

                        // Syntax
                        if (doc.syntax) {
                            hoverContent += `## Syntax\n\n${doc.syntax}\n\n`;
                        }

                        // Parameters Table
                        if (doc.parametersTable) {
                            hoverContent += `## Parameters\n\n${doc.parametersTable}\n\n`;
                        }

                        // Returns
                        if (doc.returnInfo) {
                            hoverContent += `## Returns\n\n${doc.returnInfo}\n\n`;
                        }

                        // Example(s)
                        if (doc.example && doc.example.trim()) {
                            // Check if there are multiple examples (look for multiple code blocks or line breaks)
                            const hasMultipleExamples = doc.example.includes('```') ||
                                doc.example.split('\n').filter((line: string) => line.trim()).length > 3;
                            const exampleLabel = hasMultipleExamples ? "Examples" : "Example";
                            hoverContent += `## ${exampleLabel}\n\`\`\`kql\n${doc.example}\n\`\`\``;
                        }

                        return hoverContent;
                    } else {
                        // Fallback to old format
                        return `**Function: ${func.name}()** - ${func.category}`;
                    }
                }
            }

            // Check keywords first (where, project, contains, etc.) - only if no parentheses
            if (!hasParentheses && this.schemaData.keywords) {
                const keyword = this.schemaData.keywords.find((kw: any) => kw.name.toLowerCase() === baseOperatorName);
                if (keyword) {
                    return `**${keyword.name}** - ${keyword.category}`;
                }
            }

            // Check operators - operators don't use parentheses in their syntax
            if (this.schemaData.operators) {
                // First try exact match (for operators like in~, !in~ that exist exactly in schema)
                let operator = this.schemaData.operators.find((op: any) => op.name.toLowerCase() === lowerWord);
                
                // If not found, try base operator (for operators like contains~ that don't exist exactly)
                if (!operator) {
                    operator = this.schemaData.operators.find((op: any) => op.name.toLowerCase() === baseOperatorName);
                }
                
                if (operator) {
                    // Show operator documentation
                    if (operator.documentation) {
                        const doc = operator.documentation;
                        let hoverContent = `## Operator \`${word}\`\n\n`;
                        hoverContent += `*${operator.category}*\n\n`;

                        if (doc.description) {
                            hoverContent += `${doc.description}\n\n`;
                        }

                        // Add Microsoft Learn URL if available
                        if (doc.url) {
                            hoverContent += `[Details on Microsoft Learn](${doc.url}?wt.mc_id=DT-MVP-5005372)\n\n`;
                        }

                        if (doc.syntax) {
                            hoverContent += `### Syntax\n\n${doc.syntax}\n\n`;
                        }

                        if (doc.parametersTable) {
                            hoverContent += `### Parameters\n\n${doc.parametersTable}\n\n`;
                        }

                        if (doc.returnInfo) {
                            hoverContent += `### Returns\n\n${doc.returnInfo}\n\n`;
                        }

                        if (doc.example && doc.example.trim()) {
                            const hasMultipleExamples = doc.example.includes('```') ||
                                doc.example.split('\n').filter((line: string) => line.trim()).length > 3;
                            const exampleLabel = hasMultipleExamples ? "Examples" : "Example";
                            hoverContent += `### ${exampleLabel}\n\`\`\`kql\n${doc.example}\n\`\`\``;
                        }

                        return hoverContent;
                    } else {
                        return `**${operator.name}** - ${operator.category}`;
                    }
                }
            }

            // Only check functions if there are parentheses (function call syntax)
            // This prevents matching functions when the word appears as a keyword or operator
            if (hasParentheses && this.schemaData.functions) {
                const func = this.schemaData.functions.find((fn: any) => fn.name.toLowerCase() === lowerWord);
                if (func) {
                    // If we have enhanced documentation, use it
                    if (func.documentation) {
                        const doc = func.documentation;
                        let hoverContent = `## Function \`${doc.title}\`\n\n`;
                        hoverContent += `*${func.category}*\n\n`;

                        // Description
                        if (doc.description) {
                            hoverContent += `${doc.description}\n\n`;
                        }

                        // Syntax
                        if (doc.syntax) {
                            hoverContent += `### Syntax\n\n${doc.syntax}\n\n`;
                        }

                        // Parameters Table
                        if (doc.parametersTable) {
                            hoverContent += `### Parameters\n\n${doc.parametersTable}\n\n`;
                        }

                        // Returns
                        if (doc.returnInfo) {
                            hoverContent += `### Returns\n\n${doc.returnInfo}\n\n`;
                        }

                        // Example(s)
                        if (doc.example && doc.example.trim()) {
                            // Check if there are multiple examples (look for multiple code blocks or line breaks)
                            const hasMultipleExamples = doc.example.includes('```') ||
                                doc.example.split('\n').filter((line: string) => line.trim()).length > 3;
                            const exampleLabel = hasMultipleExamples ? "Examples" : "Example";
                            hoverContent += `### ${exampleLabel}\n\`\`\`kql\n${doc.example}\n\`\`\``;
                        }

                        return hoverContent;
                    } else {
                        // Fallback to old format
                        return `**${func.name}()**`;
                    }
                }
            }

            // Check tables
            if (this.schemaData.tables) {
                const table = this.schemaData.tables[lowerWord];
                if (table) {
                    let hoverContent = `## Table \`${table.name}\`\n\n`;

                    // Add resource types section
                    // Add description if available for non-resources tables
                    if (table.description) {
                        hoverContent += `${table.description}\n\n`;
                    }

                    hoverContent += `[Details on Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language?wt.mc_id=DT-MVP-5005372)\n\n`;

                    // List specific resource types for specialized tables
                    if (table.resourceTypes && table.resourceTypes.length > 0) {
                        hoverContent += `### Resource Types\n`;
                        const displayTypes = table.resourceTypes.slice(0, 5); // Show first 5
                        displayTypes.forEach((type: string) => {
                            hoverContent += `- \`${type}\`\n`;
                        });
                        if (table.resourceTypes.length > 5) {
                            hoverContent += `- ... and ${table.resourceTypes.length - 5} more\n`;
                        }
                        hoverContent += '\n';

                    }

                    hoverContent += `[Tables and Resources Reference](https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources?wt.mc_id=DT-MVP-5005372)\n\n`;

                    // Add examples if available
                    if (table.examples && table.examples.length > 0) {
                        // Handle both old string format and new object format for examples
                        const getExampleCode = (example: any) => {
                            if (typeof example === 'string') {
                                return example;
                            } else if (example && typeof example.code === 'string') {
                                return example.code;
                            }
                            throw new Error('Invalid example format');
                        };

                        // Randomly select up to 2 examples for variety (with caching for stability)
                        const selectedExamples = this.selectRandomExamples(table.name, table.examples, 2);

                        // Sort selected examples by length (shorter first)
                        if (selectedExamples.length > 1) {
                            selectedExamples.sort((a, b) => {
                                const aCode = getExampleCode(a);
                                const bCode = getExampleCode(b);
                                return aCode.length - bCode.length;
                            });
                        }

                        const exampleLabel = selectedExamples.length === 1 ? "Example" : "Examples";

                        if (selectedExamples.length === 1) {
                            const exampleCode = getExampleCode(selectedExamples[0]);
                            hoverContent += `### ${exampleLabel}\n\`\`\`kql\n${exampleCode}\n\`\`\``;
                        } else if (selectedExamples.length > 1) {
                            const example1Code = getExampleCode(selectedExamples[0]);
                            const example2Code = getExampleCode(selectedExamples[1]);
                            hoverContent += `### ${exampleLabel}

\`\`\`kql
${example1Code}
\`\`\`

&nbsp;

\`\`\`kql
${example2Code}
\`\`\``;
                        }
                    }

                    return hoverContent;
                }
            }

            // Check resource types
            if (this.schemaData.resourceTypes) {
                const resourceType = this.schemaData.resourceTypes[lowerWord];
                if (resourceType) {
                    const properties = resourceType.properties ? `\n\nProperties:\n${resourceType.properties.slice(0, 10).map((prop: string) => `• ${prop}`).join('\n')}${resourceType.properties.length > 10 ? '\n• ...' : ''}` : '';
                    return `**${resourceType.name}** - Azure Resource Type\n\nTable: ${resourceType.table}${properties}`;
                }
            }
        }

        // No fallback documentation - will be implemented with a better approach
        return null;
    }

    private getFunctionSignature(functionName: string): vscode.SignatureInformation | null {
        // Check schema data for function signatures
        if (this.schemaData?.functions) {
            const func = this.schemaData.functions.find((fn: any) => fn.name.toLowerCase() === functionName.toLowerCase());
            if (func && func.signature) {
                const signature = new vscode.SignatureInformation(func.signature, func.description);
                if (func.parameters) {
                    signature.parameters = func.parameters.map((p: any) => new vscode.ParameterInformation(p));
                }
                return signature;
            }
        }

        // No fallback signatures - will be implemented with a better approach
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

        // No fallback - if schema isn't loaded, return false
        return false;
    }

    private isValidOperator(name: string): boolean {
        const lowerName = name.toLowerCase();

        // Check both keywords and operators since KQL commands like 'where', 'project' are keywords
        // Check schema data first
        if (this.schemaData?.keywords) {
            const isKeyword = this.schemaData.keywords.some((kw: any) =>
                typeof kw === 'string' ? kw.toLowerCase() === lowerName : kw.name?.toLowerCase() === lowerName
            );
            if (isKeyword) {
                return true;
            }
        }

        if (this.schemaData?.operators) {
            const isOperator = this.schemaData.operators.some((op: any) => op.name?.toLowerCase() === lowerName);
            if (isOperator) {
                return true;
            }
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
        } else {
            throw new Error('Schema data not loaded');
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

        // Get both keyword and operator names from schema data since KQL commands can be either
        if (this.schemaData?.keywords) {
            operatorNames.push(...this.schemaData.keywords);
        }
        if (this.schemaData?.operators) {
            operatorNames.push(...this.schemaData.operators.map((op: any) => op.name));
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
