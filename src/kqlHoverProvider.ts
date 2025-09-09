import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ARGSchema {
    tables: Record<string, any>;
    resourceTypes: Record<string, any>;
    operators: Array<{ name: string; description: string; category: string; }>;
    functions: Array<{ name: string; description: string; category: string; }>;
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
            
            if (table.resourceTypes && table.resourceTypes.length > 0) {
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

            markdown.appendMarkdown(`**Example:**\n\`\`\`kql\n${tableName}\n| where type == 'microsoft.compute/virtualmachines'\n| project name, location\n| limit 10\n\`\`\``);
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
            
            // Add usage examples based on operator
            const example = this.getOperatorExample(operator.name);
            if (example) {
                markdown.appendMarkdown(`**Example:**\n\`\`\`kql\n${example}\n\`\`\``);
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
            
            // Add usage examples based on function
            const example = this.getFunctionExample(func.name);
            if (example) {
                markdown.appendMarkdown(`**Example:**\n\`\`\`kql\n${example}\n\`\`\``);
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
                markdown.appendMarkdown(`**Example:**\n\`\`\`kql\nResources\n| where type == '${word}'\n| project name, location, properties\n\`\`\``);
                return markdown;
            }
        }

        return null;
    }

    private isInResourceTypeContext(line: string): boolean {
        return /type\s*(==|=~)\s*['"]/i.test(line);
    }

    private getOperatorExample(operatorName: string): string | null {
        const examples: Record<string, string> = {
            'where': 'Resources\n| where type == \'microsoft.compute/virtualmachines\'\n| where location =~ \'eastus\'',
            'project': 'Resources\n| project name, location, resourceGroup',
            'summarize': 'Resources\n| summarize count() by type, location',
            'join': 'Resources\n| join kind=inner (\n    ResourceContainers\n    | where type == \'microsoft.resources/subscriptions\'\n) on subscriptionId',
            'extend': 'Resources\n| extend resourceAge = datetime_diff(\'day\', now(), todatetime(properties.timeCreated))',
            'order': 'Resources\n| order by name asc',
            'sort': 'Resources\n| sort by name desc',
            'limit': 'Resources\n| limit 100',
            'take': 'Resources\n| take 50',
            'top': 'Resources\n| top 10 by name',
            'distinct': 'Resources\n| distinct type',
            'count': 'Resources\n| count',
            'union': 'Resources\n| union SecurityResources',
            'mv-expand': 'Resources\n| mv-expand tags\n| project name, tagKey = tags.key, tagValue = tags.value'
        };

        return examples[operatorName.toLowerCase()] || null;
    }

    private getFunctionExample(functionName: string): string | null {
        const examples: Record<string, string> = {
            'tostring': 'Resources\n| extend idString = tostring(id)',
            'toint': 'Resources\n| extend priority = toint(properties.priority)',
            'tobool': 'Resources\n| extend isEnabled = tobool(properties.enabled)',
            'contains': 'Resources\n| where name contains \'prod\'',
            'startswith': 'Resources\n| where name startswith \'web-\'',
            'endswith': 'Resources\n| where name endswith \'-prod\'',
            'isnotnull': 'Resources\n| where isnotnull(properties.ipAddress)',
            'isnull': 'Resources\n| where isnull(managedBy)',
            'count': 'Resources\n| summarize totalResources = count()',
            'dcount': 'Resources\n| summarize uniqueTypes = dcount(type)',
            'sum': 'Resources\n| summarize totalSize = sum(properties.sizeInGB)',
            'avg': 'Resources\n| summarize avgSize = avg(properties.sizeInGB)',
            'min': 'Resources\n| summarize oldestCreated = min(properties.timeCreated)',
            'max': 'Resources\n| summarize newestCreated = max(properties.timeCreated)',
            'make_set': 'Resources\n| summarize allLocations = make_set(location) by resourceGroup',
            'make_list': 'Resources\n| summarize allNames = make_list(name) by type',
            'strcat': 'Resources\n| extend fullName = strcat(resourceGroup, \'/\', name)',
            'split': 'Resources\n| extend nameParts = split(name, \'-\')',
            'tolower': 'Resources\n| extend lowerName = tolower(name)',
            'toupper': 'Resources\n| extend upperLocation = toupper(location)',
            'now': 'Resources\n| extend currentTime = now()',
            'ago': 'Resources\n| where properties.timeCreated > ago(30d)'
        };

        return examples[functionName.toLowerCase()] || null;
    }
}
