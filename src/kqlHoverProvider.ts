import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ARGSchema {
    tables: Record<string, {
        name: string;
        description: string;
        resourceTypes: string[];
        examples?: string[];
    }>;
    resourceTypes: Record<string, {
        table: string;
        type: string;
    }>;
    operators: Array<{
        name: string;
        description: string;
        category: string;
        syntax?: string;
        examples?: string[];
        displayName?: string;
        sourceUrl?: string;
    }>;
    functions: Array<{
        name: string;
        description: string;
        category: string;
        syntax?: string;
        examples?: string[];
    }>;
}

export class KQLHoverProvider implements vscode.HoverProvider {
    private schema: ARGSchema | null = null;

    constructor() {
        this.loadSchema();
    }

    private async loadSchema(): Promise<void> {
        try {
            const schemaPath = path.join(__dirname, 'schema', 'arg-schema.json');
            const schemaContent = fs.readFileSync(schemaPath, 'utf8');
            this.schema = JSON.parse(schemaContent);
        } catch (error) {
            console.error('Failed to load ARG schema for hover provider:', error);
            this.schema = this.getDefaultSchema();
        }

        // Always ensure core KQL elements are available
        this.ensureCoreElements();
    }

    private getDefaultSchema(): ARGSchema {
        return {
            tables: {},
            resourceTypes: {},
            operators: [],
            functions: []
        };
    }

    private ensureCoreElements(): void {
        // Removed hardcoded elements - now purely schema-driven
        // The schema generator should provide all necessary KQL elements
    }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        if (!this.schema) {
            await this.loadSchema();
        }

        if (!this.schema) {
            // Simple fallback for debugging
            return null;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        
        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);
        const lineSuffix = line.substring(position.character);

        // Try to get hover information for the word
        const hoverInfo = this.getHoverInfo(word, linePrefix, lineSuffix);
        
        if (hoverInfo) {
            return new vscode.Hover(hoverInfo, wordRange);
        }

        return null;
    }

    private getHoverInfo(word: string, linePrefix: string, lineSuffix: string): vscode.MarkdownString | null {
        if (!this.schema) {
            return null;
        }

        const lowerWord = word.toLowerCase();

        // Check if it's a table name (case-insensitive lookup)
        const tableEntry = Object.entries(this.schema.tables).find(([key, _]) => 
            key.toLowerCase() === lowerWord
        );
        
        if (tableEntry) {
            const [tableName, table] = tableEntry;
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**Table: \`${tableName}\`**\n\n`);
            markdown.appendMarkdown(`${table.description}\n\n`);
            
            // Skip Resource Types section for the main "resources" table
            if (tableName.toLowerCase() !== 'resources' && table.resourceTypes && table.resourceTypes.length > 0) {
                markdown.appendMarkdown(`**Resource Types:**\n`);
                const displayTypes = table.resourceTypes.slice(0, 5); // Show first 5
                displayTypes.forEach((type: string) => {
                    markdown.appendMarkdown(`- \`${type}\`\n`);
                });
                if (table.resourceTypes.length > 5) {
                    markdown.appendMarkdown(`- ... and ${table.resourceTypes.length - 5} more\n`);
                }
                markdown.appendMarkdown('\n');
            }

            // Use real examples from the schema if available
            if (table.examples && table.examples.length > 0) {
                const exampleLabel = table.examples.length === 1 ? "Example" : "Examples";
                if (table.examples.length === 1) {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${table.examples[0]}\n\`\`\``);
                } else {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${table.examples[0]}\n\`\`\`\n\n\`\`\`kql\n${table.examples[1]}\n\`\`\``);
                }
            }
            return markdown;
        }

        // Check if it's an operator
        const operator = this.schema.operators.find(op => op.name.toLowerCase() === lowerWord);
        if (operator) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**Operator: \`${operator.name}\`**\n\n`);
            markdown.appendMarkdown(`*${operator.category}*\n\n`);
            markdown.appendMarkdown(`${operator.description}\n\n`);
            
            // Use real examples from the schema if available
            if (operator.examples && operator.examples.length > 0) {
                const exampleLabel = operator.examples.length === 1 ? "Example" : "Examples";
                if (operator.examples.length === 1) {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${operator.examples[0]}\n\`\`\``);
                } else {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${operator.examples[0]}\n\`\`\`\n\n\`\`\`kql\n${operator.examples[1]}\n\`\`\``);
                }
            } else if (operator.syntax) {
                markdown.appendMarkdown(`**Syntax:**\n\`\`\`kql\n${operator.syntax}\n\`\`\``);
            }
            
            return markdown;
        }

        // Check if it's a function
        const func = this.schema.functions.find(f => f.name.toLowerCase() === lowerWord);
        if (func) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**Function: \`${func.name}()\`**\n\n`);
            markdown.appendMarkdown(`*${func.category}*\n\n`);
            markdown.appendMarkdown(`${func.description}\n\n`);
            
            // Use real examples from the schema if available
            if (func.examples && func.examples.length > 0) {
                const exampleLabel = func.examples.length === 1 ? "Example" : "Examples";
                if (func.examples.length === 1) {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${func.examples[0]}\n\`\`\``);
                } else {
                    markdown.appendMarkdown(`**${exampleLabel}:**\n\`\`\`kql\n${func.examples[0]}\n\`\`\`\n\n\`\`\`kql\n${func.examples[1]}\n\`\`\``);
                }
            } else if (func.syntax) {
                markdown.appendMarkdown(`**Syntax:**\n\`\`\`kql\n${func.syntax}\n\`\`\``);
            }
            
            return markdown;
        }

        // Check if it's a resource type (in quotes)
        if (this.isInResourceTypeContext(linePrefix + word + lineSuffix)) {
            const resourceType = this.schema.resourceTypes[word];
            if (resourceType) {
                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.appendMarkdown(`**Resource Type: \`${word}\`**\n\n`);
                markdown.appendMarkdown(`**Table:** \`${resourceType.table}\`\n\n`);
                
                // Use table examples if available, otherwise show minimal usage
                const tableInfo = this.schema.tables[resourceType.table];
                if (tableInfo && tableInfo.examples && tableInfo.examples.length > 0) {
                    // Find an example that uses this resource type, or use the first example
                    const relevantExample = tableInfo.examples.find(ex => ex.includes(word)) || tableInfo.examples[0];
                    markdown.appendMarkdown(`**Example:**\n\`\`\`kql\n${relevantExample}\n\`\`\``);
                } else {
                    markdown.appendMarkdown(`**Usage:**\n\`\`\`kql\n${resourceType.table}\n| where type == '${word}'\n\`\`\``);
                }
                return markdown;
            }
        }

        return null;
    }

    private isInResourceTypeContext(line: string): boolean {
        return /type\s*(==|=~)\s*['"]/i.test(line);
    }
}
