import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface CompletionItem {
    label: string;
    kind: string;
    detail: string;
    insertText: string;
    category?: string;
}

interface CompletionData {
    tables: CompletionItem[];
    operators: CompletionItem[];
    functions: CompletionItem[];
    resourceTypes: CompletionItem[];
}

export class KQLCompletionProvider implements vscode.CompletionItemProvider {
    private completionData: CompletionData | null = null;
    private readonly kindMap: Record<string, vscode.CompletionItemKind> = {
        'Table': vscode.CompletionItemKind.Class,
        'Keyword': vscode.CompletionItemKind.Keyword,
        'Function': vscode.CompletionItemKind.Function,
        'Value': vscode.CompletionItemKind.Value,
        'Property': vscode.CompletionItemKind.Property,
        'Field': vscode.CompletionItemKind.Field
    };

    constructor() {
        this.loadCompletionData();
    }

    private async loadCompletionData(): Promise<void> {
        try {
            const schemaPath = path.join(__dirname, 'schema', 'completion-data.json');
            const schemaContent = fs.readFileSync(schemaPath, 'utf8');
            this.completionData = JSON.parse(schemaContent);
        } catch (error) {
            console.error('Failed to load KQL completion data:', error);
            this.completionData = this.getDefaultCompletionData();
        }

        // Always ensure core KQL elements are available
        this.ensureCoreElements();
    }

    private getDefaultCompletionData(): CompletionData {
        return {
            tables: [],
            operators: [],
            functions: [],
            resourceTypes: []
        };
    }

    private ensureCoreElements(): void {
        // Removed hardcoded elements - now purely schema-driven
        // The schema generator should provide all necessary KQL elements
    }

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        if (!this.completionData) {
            await this.loadCompletionData();
        }

        if (!this.completionData) {
            return [];
        }

        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);
        const currentWord = this.getCurrentWord(linePrefix);

        // Analyze context to determine what to suggest
        const suggestions = this.getContextualSuggestions(linePrefix, currentWord);
        
        return suggestions.map(item => this.createCompletionItem(item));
    }

    private getCurrentWord(linePrefix: string): string {
        const wordMatch = linePrefix.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        return wordMatch ? wordMatch[0] : '';
    }

    private getContextualSuggestions(linePrefix: string, currentWord: string): CompletionItem[] {
        if (!this.completionData) {
            return [];
        }

        const suggestions: CompletionItem[] = [];
        const lowerLinePrefix = linePrefix.toLowerCase();
        const lowerCurrentWord = currentWord.toLowerCase();

        // At start of line or after pipe - suggest tables and operators
        if (this.isStartOfStatement(linePrefix)) {
            suggestions.push(...this.filterItems(this.completionData.tables, lowerCurrentWord));
            suggestions.push(...this.filterItems(this.completionData.operators, lowerCurrentWord));
        }
        
        // After pipe - suggest operators
        else if (this.isAfterPipe(linePrefix)) {
            suggestions.push(...this.filterItems(this.completionData.operators, lowerCurrentWord));
        }
        
        // In function context - suggest functions
        else if (this.isInFunctionContext(linePrefix)) {
            suggestions.push(...this.filterItems(this.completionData.functions, lowerCurrentWord));
        }
        
        // After 'type ==' or 'type =~' - suggest resource types
        else if (this.isResourceTypeContext(linePrefix)) {
            suggestions.push(...this.filterItems(this.completionData.resourceTypes, lowerCurrentWord));
        }
        
        // In project, extend, where, or summarize by context - suggest properties and functions
        else if (this.isPropertyContext(linePrefix)) {
            suggestions.push(...this.getCommonColumns(lowerCurrentWord));
            suggestions.push(...this.filterItems(this.completionData.functions, lowerCurrentWord));
            suggestions.push(...this.filterItems(this.completionData.resourceTypes, lowerCurrentWord));
        }
        
        // Default: suggest common operators and functions
        else {
            suggestions.push(...this.filterItems(this.completionData.operators, lowerCurrentWord));
            suggestions.push(...this.filterItems(this.completionData.functions, lowerCurrentWord));
            
            // Add common column names
            suggestions.push(...this.getCommonColumns(lowerCurrentWord));
        }

        return suggestions;
    }

    private isStartOfStatement(linePrefix: string): boolean {
        const trimmed = linePrefix.trim();
        return trimmed === '' || /^\s*\/\//.test(linePrefix);
    }

    private isAfterPipe(linePrefix: string): boolean {
        return /\|\s*[a-zA-Z_]*$/.test(linePrefix);
    }

    private isInFunctionContext(linePrefix: string): boolean {
        // Look for function call patterns like "where someFunc(" or "extend result = func("
        return /[a-zA-Z_][a-zA-Z0-9_]*\s*\($|[=\s]\s*[a-zA-Z_]*$/.test(linePrefix);
    }

    private isResourceTypeContext(linePrefix: string): boolean {
        // Check for patterns like "where type == " or "where type =~ "
        return /\btype\s*(==|=~)\s*['"]*[a-zA-Z0-9./]*$/i.test(linePrefix);
    }

    private isPropertyContext(linePrefix: string): boolean {
        // Check for contexts where properties/columns are expected
        return /\b(project|extend|where|summarize\s+by)\s+[a-zA-Z0-9_,.\s]*$/i.test(linePrefix) ||
               /[,\s]\s*[a-zA-Z0-9_]*$/.test(linePrefix);
    }

    private filterItems(items: CompletionItem[], filter: string): CompletionItem[] {
        if (!filter) {
            return items;
        }
        
        return items.filter(item => 
            item.label.toLowerCase().includes(filter) ||
            item.detail.toLowerCase().includes(filter)
        );
    }

    private getCommonColumns(filter: string): CompletionItem[] {
        const commonColumns = [
            { label: 'id', kind: 'Property', detail: 'Resource ID', insertText: 'id' },
            { label: 'name', kind: 'Property', detail: 'Resource name', insertText: 'name' },
            { label: 'type', kind: 'Property', detail: 'Resource type', insertText: 'type' },
            { label: 'location', kind: 'Property', detail: 'Resource location', insertText: 'location' },
            { label: 'resourceGroup', kind: 'Property', detail: 'Resource group', insertText: 'resourceGroup' },
            { label: 'subscriptionId', kind: 'Property', detail: 'Subscription ID', insertText: 'subscriptionId' },
            { label: 'tags', kind: 'Property', detail: 'Resource tags', insertText: 'tags' },
            { label: 'properties', kind: 'Property', detail: 'Resource properties', insertText: 'properties' },
            { label: 'sku', kind: 'Property', detail: 'Resource SKU', insertText: 'sku' },
            { label: 'kind', kind: 'Property', detail: 'Resource kind', insertText: 'kind' }
        ];

        return this.filterItems(commonColumns, filter);
    }

    private createCompletionItem(item: CompletionItem): vscode.CompletionItem {
        const completionItem = new vscode.CompletionItem(
            item.label,
            this.kindMap[item.kind] || vscode.CompletionItemKind.Text
        );

        completionItem.detail = item.detail;
        completionItem.insertText = item.insertText;
        completionItem.filterText = item.label;
        completionItem.sortText = this.getSortOrder(item);

        // Add documentation for functions
        if (item.kind === 'Function') {
            completionItem.documentation = new vscode.MarkdownString(`**${item.label}**\n\n${item.detail}`);
        }

        // Add category-based grouping
        if (item.category) {
            completionItem.tags = [item.category as any];
        }

        return completionItem;
    }

    private getSortOrder(item: CompletionItem): string {
        // Prioritize by type: tables first, then operators, then functions, then others
        const priorities: Record<string, string> = {
            'Table': '1',
            'Keyword': '2', 
            'Function': '3',
            'Property': '4',
            'Value': '5'
        };

        const priority = priorities[item.kind] || '9';
        return `${priority}_${item.label}`;
    }
}
