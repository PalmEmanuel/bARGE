#!/usr/bin/env node

/**
 * Azure Resource Graph Schema Generator
 * 
 * Parses Microsoft Learn documentation to generate KQL schema for bARGE
 * Sources:
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language
 * - https://learn.microsoft.com/en-us/previous-versions/azure/governance/resource-graph/samples/samples-by-table
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');

class ARGSchemaGenerator {
    constructor() {
        this.schema = {
            tables: {},
            resourceTypes: {},
            operators: [],
            functions: [],
            lastUpdated: new Date().toISOString()
        };
        this.sampleQueries = [];
    }

    async fetchUrl(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    async generateSchema() {
        console.log('🔍 Fetching Azure Resource Graph documentation...');
        
        try {
            // Fetch main table reference
            const tablesDoc = await this.fetchUrl(
                'https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources'
            );
            
            // Fetch query language reference
            const queryDoc = await this.fetchUrl(
                'https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language'
            );

            // Fetch KQL documentation for operators and functions
            const kqlDoc = await this.fetchUrl(
                'https://learn.microsoft.com/en-us/azure/data-explorer/kusto/query/'
            );

            console.log('📋 Parsing table information...');
            this.parseTables(tablesDoc);
            
            console.log('🔧 Parsing query language elements...');
            await this.parseQueryLanguage(queryDoc, kqlDoc);
            
            console.log('💾 Generating schema files...');
            await this.writeSchemaFiles();
            
            console.log('✅ Schema generation complete!');
            
        } catch (error) {
            console.error('❌ Error generating schema:', error);
            throw error;
        }
    }

    parseTables(htmlContent) {
        // Extract table definitions
        const tableRegex = /<h2[^>]*id="([^"]*)"[^>]*>([^<]*)<\/h2>/g;
        const resourceTypeRegex = /•\s*([a-zA-Z0-9./\-_]+)/g;
        
        let match;
        let currentTable = null;
        
        // Parse table headers
        while ((match = tableRegex.exec(htmlContent)) !== null) {
            const tableName = match[2].trim();
            
            if (this.isValidTableName(tableName)) {
                currentTable = tableName;
                this.schema.tables[currentTable] = {
                    name: currentTable,
                    resourceTypes: [],
                    description: `Resources related to ${currentTable}`
                };
            }
        }

        // Parse resource types for each table
        const sections = htmlContent.split(/<h2[^>]*>/);
        sections.forEach(section => {
            const tableMatch = section.match(/^[^<]*([a-zA-Z]+resources?)/i);
            if (tableMatch) {
                const tableName = tableMatch[1];
                if (this.schema.tables[tableName]) {
                    let resourceMatch;
                    while ((resourceMatch = resourceTypeRegex.exec(section)) !== null) {
                        const resourceType = resourceMatch[1];
                        if (this.isValidResourceType(resourceType)) {
                            this.schema.tables[tableName].resourceTypes.push(resourceType);
                            this.schema.resourceTypes[resourceType] = {
                                table: tableName,
                                type: resourceType
                            };
                        }
                    }
                }
            }
        });
    }

    async parseQueryLanguage(argDoc, kqlDoc) {
        console.log('📝 Parsing KQL operators from documentation...');
        await this.parseOperatorsFromDocs(argDoc, kqlDoc);
        
        console.log('🔧 Parsing KQL functions from documentation...');
        await this.parseFunctionsFromDocs(argDoc, kqlDoc);
        
        console.log('📊 Parsing main ARG tables from documentation...');
        await this.parseMainTablesFromDocs(argDoc);
        
        console.log('🔍 Fetching sample queries from documentation...');
        await this.fetchSampleQueries();
    }

    async parseOperatorsFromDocs(argDoc, kqlDoc) {
        // Parse operators from ARG and KQL documentation
        const operators = new Map();
        
        // Common KQL operators that are supported in ARG
        const coreOperators = [
            'where', 'project', 'summarize', 'extend', 'join', 'union', 
            'sort', 'order', 'top', 'take', 'limit', 'distinct', 'count', 'mv-expand'
        ];
        
        // First, extract operators mentioned in the ARG documentation
        const operatorRegex = /\b(where|project|summarize|extend|join|union|sort|order|top|take|limit|distinct|count|mv-expand)\b/gi;
        let match;
        
        while ((match = operatorRegex.exec(argDoc)) !== null) {
            const operatorName = match[1].toLowerCase();
            if (!operators.has(operatorName)) {
                operators.set(operatorName, {
                    name: operatorName,
                    category: this.getOperatorCategory(operatorName),
                    description: this.getOperatorDescription(operatorName)
                });
            }
        }
        
        // Ensure we have all core operators
        coreOperators.forEach(op => {
            if (!operators.has(op)) {
                operators.set(op, {
                    name: op,
                    category: this.getOperatorCategory(op),
                    description: this.getOperatorDescription(op)
                });
            }
        });
        
        this.schema.operators = Array.from(operators.values());
        console.log(`✅ Found ${this.schema.operators.length} KQL operators`);
    }

    async parseFunctionsFromDocs(argDoc, kqlDoc) {
        // Parse functions from ARG and KQL documentation
        const functions = new Map();
        
        // Common KQL functions that are supported in ARG
        const coreFunctions = [
            'tostring', 'toint', 'todouble', 'tobool', 'todatetime', 'now', 'ago',
            'strlen', 'substring', 'split', 'replace', 'tolower', 'toupper',
            'sum', 'count', 'max', 'min', 'avg', 'make_list', 'make_set',
            'parse_json', 'bag_keys', 'extract', 'isnotnull', 'isnull', 'isempty', 'isnotempty'
        ];
        
        // Extract functions from the documentation
        const functionRegex = /\b(tostring|toint|todouble|tobool|todatetime|now|ago|strlen|substring|split|replace|tolower|toupper|sum|count|max|min|avg|make_list|make_set|parse_json|bag_keys|extract|isnotnull|isnull|isempty|isnotempty)\s*\(/gi;
        let match;
        
        while ((match = functionRegex.exec(argDoc)) !== null) {
            const functionName = match[1].toLowerCase();
            if (!functions.has(functionName)) {
                functions.set(functionName, {
                    name: functionName,
                    category: this.getFunctionCategory(functionName),
                    description: this.getFunctionDescription(functionName)
                });
            }
        }
        
        // Ensure we have all core functions
        coreFunctions.forEach(func => {
            if (!functions.has(func)) {
                functions.set(func, {
                    name: func,
                    category: this.getFunctionCategory(func),
                    description: this.getFunctionDescription(func)
                });
            }
        });
        
        this.schema.functions = Array.from(functions.values());
        console.log(`✅ Found ${this.schema.functions.length} KQL functions`);
    }

    async parseMainTablesFromDocs(argDoc) {
        // Parse main table names from the ARG documentation
        const tables = new Map();
        
        // Extract table names from the documentation
        const tableRegex = /\b([a-zA-Z][a-zA-Z0-9]*resources?)\b/gi;
        let match;
        
        while ((match = tableRegex.exec(argDoc)) !== null) {
            const tableName = match[1].toLowerCase();
            if (this.isValidTableName(tableName) && !tables.has(tableName)) {
                tables.set(tableName, {
                    name: tableName,
                    description: this.getTableDescription(tableName),
                    properties: {}
                });
            }
        }
        
        // Ensure we have the main essential tables
        const essentialTables = ['resources', 'resourcecontainers'];
        essentialTables.forEach(table => {
            if (!tables.has(table)) {
                tables.set(table, {
                    name: table,
                    description: this.getTableDescription(table),
                    properties: {}
                });
            }
        });
        
        // Update the schema tables (merge with existing)
        tables.forEach((tableInfo, tableName) => {
            if (!this.schema.tables[tableName]) {
                this.schema.tables[tableName] = tableInfo;
            }
        });
        
        console.log(`✅ Found ${tables.size} main ARG tables`);
    }

    getOperatorCategory(operatorName) {
        const categories = {
            'where': 'filter',
            'project': 'projection',
            'summarize': 'aggregation',
            'extend': 'projection',
            'join': 'join',
            'union': 'union',
            'sort': 'sort',
            'order': 'sort',
            'top': 'limit',
            'take': 'limit',
            'limit': 'limit',
            'distinct': 'filter',
            'count': 'aggregation',
            'mv-expand': 'expand'
        };
        return categories[operatorName] || 'other';
    }

    getOperatorDescription(operatorName) {
        const descriptions = {
            'where': 'Filters rows based on a boolean condition',
            'project': 'Selects and optionally renames columns',
            'summarize': 'Groups rows and applies aggregation functions',
            'extend': 'Adds calculated columns to the result set',
            'join': 'Combines rows from two tables based on matching values',
            'union': 'Combines results from multiple tables or queries',
            'sort': 'Orders result rows by one or more columns',
            'order': 'Orders result rows by one or more columns',
            'top': 'Returns the first N rows after sorting',
            'take': 'Returns the first N rows from the input',
            'limit': 'Limits the number of rows returned',
            'distinct': 'Returns rows with distinct combinations of specified columns',
            'count': 'Counts the number of rows in the input',
            'mv-expand': 'Expands multi-value arrays or property bags into separate rows'
        };
        return descriptions[operatorName] || `KQL operator: ${operatorName}`;
    }

    getFunctionCategory(functionName) {
        const categories = {
            'tostring': 'conversion',
            'toint': 'conversion',
            'todouble': 'conversion',
            'tobool': 'conversion',
            'todatetime': 'conversion',
            'now': 'datetime',
            'ago': 'datetime',
            'strlen': 'string',
            'substring': 'string',
            'split': 'string',
            'replace': 'string',
            'tolower': 'string',
            'toupper': 'string',
            'sum': 'aggregation',
            'count': 'aggregation',
            'max': 'aggregation',
            'min': 'aggregation',
            'avg': 'aggregation',
            'make_list': 'aggregation',
            'make_set': 'aggregation',
            'parse_json': 'parsing',
            'bag_keys': 'parsing',
            'extract': 'parsing',
            'isnotnull': 'conditional',
            'isnull': 'conditional',
            'isempty': 'conditional',
            'isnotempty': 'conditional'
        };
        return categories[functionName] || 'other';
    }

    getFunctionDescription(functionName) {
        const descriptions = {
            'tostring': 'Converts input to string representation',
            'toint': 'Converts input to integer',
            'todouble': 'Converts input to double precision number',
            'tobool': 'Converts input to boolean',
            'todatetime': 'Converts input to datetime',
            'now': 'Returns current UTC datetime',
            'ago': 'Returns datetime that is the specified timespan before now',
            'strlen': 'Returns the length of the string',
            'substring': 'Extracts a substring from a string',
            'split': 'Splits a string into substrings',
            'replace': 'Replaces all occurrences of a substring',
            'tolower': 'Converts string to lowercase',
            'toupper': 'Converts string to uppercase',
            'sum': 'Calculates the sum of values',
            'count': 'Counts the number of values',
            'max': 'Returns the maximum value',
            'min': 'Returns the minimum value',
            'avg': 'Calculates the average of values',
            'make_list': 'Creates a list of values',
            'make_set': 'Creates a set of unique values',
            'parse_json': 'Parses a JSON string',
            'bag_keys': 'Returns keys from a property bag',
            'extract': 'Extracts a match using a regular expression',
            'isnotnull': 'Tests if value is not null',
            'isnull': 'Tests if value is null',
            'isempty': 'Tests if value is empty',
            'isnotempty': 'Tests if value is not empty'
        };
        return descriptions[functionName] || `KQL function: ${functionName}`;
    }

    getTableDescription(tableName) {
        const descriptions = {
            'resources': 'Main table containing all Azure resources across subscriptions',
            'resourcecontainers': 'Contains management groups, subscriptions, and resource groups',
            'advisorresources': 'Azure Advisor recommendations and cost savings data',
            'appserviceresources': 'Azure App Service applications and configurations',
            'extendedlocationresources': 'Azure Arc-enabled custom locations and resource types',
            'kubernetesconfigurationresources': 'Azure Arc-enabled Kubernetes configurations and extensions',
            'healthresources': 'Resource health and availability status information',
            'alertsmanagementresources': 'Azure Monitor alerts and management data',
            'policyresources': 'Azure Policy compliance states and assignments',
            'guestconfigurationresources': 'Azure Policy guest configuration assignments and compliance',
            'authorizationresources': 'Azure RBAC role assignments and definitions',
            'servicehealthresources': 'Azure Service Health events and advisories',
            'securityresources': 'Microsoft Defender for Cloud security assessments and alerts',
            'patchassessmentresources': 'OS update and patch assessment data for virtual machines',
            'iotsecurityresources': 'IoT Defender security data for devices and recommendations',
            'insightsresources': 'Azure Monitor insights and data collection rule associations',
            'computeresources': 'Virtual Machine Scale Sets uniform orchestration instances',
            'relationshipresources': 'Service Group membership and relationship data',
            'healthresourcechanges': 'Historical changes in resource health and availability'
        };
        return descriptions[tableName] || `Azure Resource Graph table: ${tableName}`;
    }

    async fetchSampleQueries() {
        try {
            console.log('🌐 Fetching sample queries from Microsoft Learn documentation...');
            const sampleUrl = 'https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category';
            const htmlContent = await this.fetchUrl(sampleUrl);
            
            console.log('📝 Parsing sample queries...');
            this.parseSampleQueries(htmlContent);
            
            console.log('🔗 Matching samples to tables...');
            this.matchSamplesToTables();
            
        } catch (error) {
            console.warn('⚠️ Could not fetch sample queries from documentation:', error.message);
            console.log('📝 Using fallback examples for tables');
        }
    }

    parseSampleQueries(htmlContent) {
        // Extract all KQL code blocks from the documentation
        const codeBlockRegex = /```\s*(.*?)\s*```/gs;
        let match;
        
        while ((match = codeBlockRegex.exec(htmlContent)) !== null) {
            const queryCode = match[1].trim();
            
            // Skip non-KQL code blocks (like CLI commands)
            if (queryCode.startsWith('az graph query') || 
                queryCode.includes('Azure CLIAzure PowerShellPortal') ||
                queryCode.includes('--query') ||
                !this.looksLikeKQLQuery(queryCode)) {
                continue;
            }
            
            // Clean up and store the query
            const cleanQuery = this.cleanKQLQuery(queryCode);
            if (cleanQuery && cleanQuery.length > 10) {
                this.sampleQueries.push(cleanQuery);
            }
        }
        
        console.log(`✅ Found ${this.sampleQueries.length} sample queries`);
    }

    looksLikeKQLQuery(code) {
        // Check if the code looks like a KQL query
        const kqlKeywords = ['where', 'project', 'summarize', 'extend', 'join', 'union', 'sort', 'order', 'top', 'take', 'limit', 'distinct', 'count', 'mv-expand'];
        const tableNames = Object.keys(this.schema.tables);
        
        // Check for KQL keywords or table names
        const hasKQLKeywords = kqlKeywords.some(keyword => 
            new RegExp(`\\b${keyword}\\b`, 'i').test(code)
        );
        
        const hasTableNames = tableNames.some(table => 
            new RegExp(`\\b${table}\\b`, 'i').test(code)
        );
        
        return hasKQLKeywords || hasTableNames;
    }

    cleanKQLQuery(query) {
        // Remove extra whitespace and normalize the query
        return query
            .replace(/\n\s*\n/g, '\n') // Remove empty lines
            .replace(/^\s+|\s+$/g, '') // Trim
            .replace(/\s+/g, ' ') // Normalize spaces
            .replace(/\|\s+/g, '\n| '); // Format pipe operators on new lines
    }

    matchSamplesToTables() {
        Object.keys(this.schema.tables).forEach(tableKey => {
            const tableName = this.schema.tables[tableKey].name;
            const matchedQueries = [];
            
            // Find queries that mention this table (case-insensitive)
            for (const query of this.sampleQueries) {
                const tableRegex = new RegExp(`\\b${tableName}\\b`, 'i');
                if (tableRegex.test(query) && matchedQueries.length < 2) {
                    matchedQueries.push(query);
                }
            }
            
            // Update the table with real examples if found
            if (matchedQueries.length > 0) {
                this.schema.tables[tableKey].example = matchedQueries[0];
                if (matchedQueries.length > 1) {
                    this.schema.tables[tableKey].examples = matchedQueries;
                }
                console.log(`✅ Found ${matchedQueries.length} example(s) for table: ${tableName}`);
            } else {
                console.log(`⚠️ No examples found for table: ${tableName}, keeping fallback`);
            }
        });
    }

    isValidTableName(name) {
        return /^[a-zA-Z][a-zA-Z0-9]*resources?$/i.test(name);
    }

    isValidResourceType(type) {
        return /^[a-zA-Z][a-zA-Z0-9./\-_]*\/[a-zA-Z][a-zA-Z0-9./\-_]*$/i.test(type);
    }

    getOperatorCategory(operator) {
        const operatorInfo = this.schema.operators.find(op => 
            op.name.toLowerCase() === operator.toLowerCase()
        );
        return operatorInfo ? operatorInfo.category : 'general';
    }

    async writeSchemaFiles() {
        const outputDir = path.join(__dirname, '..', 'src', 'schema');
        
        try {
            await fs.mkdir(outputDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        // Write complete schema
        await fs.writeFile(
            path.join(outputDir, 'arg-schema.json'),
            JSON.stringify(this.schema, null, 2)
        );

        // Write completion provider data
        await this.generateCompletionData(outputDir);

        // Write TextMate grammar
        await this.generateTextMateGrammar();

        console.log(`📁 Schema files written to: ${outputDir}`);
    }

    async generateCompletionData(outputDir) {
        const completionData = {
            tables: Object.keys(this.schema.tables).map(name => ({
                label: name,
                kind: 'Table',
                detail: this.schema.tables[name].description,
                insertText: name
            })),
            operators: this.schema.operators.map(op => ({
                label: op.name,
                kind: 'Keyword',
                detail: op.description,
                insertText: op.name,
                category: op.category
            })),
            functions: this.schema.functions.map(fn => ({
                label: fn.name,
                kind: 'Function',
                detail: fn.description,
                insertText: `${fn.name}()`,
                category: fn.category
            })),
            resourceTypes: Object.keys(this.schema.resourceTypes).map(type => ({
                label: type,
                kind: 'Value',
                detail: `Resource type in ${this.schema.resourceTypes[type].table} table`,
                insertText: `'${type}'`
            }))
        };

        await fs.writeFile(
            path.join(outputDir, 'completion-data.json'),
            JSON.stringify(completionData, null, 2)
        );
    }

    async generateTextMateGrammar() {
        const syntaxDir = path.join(__dirname, '..', 'syntaxes');
        
        try {
            await fs.mkdir(syntaxDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        // Create lists of keywords, functions, and tables from schema
        const operators = this.schema.operators.map(op => op.name).join('|');
        const functions = this.schema.functions.map(fn => fn.name).join('|');
        const tables = Object.keys(this.schema.tables).join('|');

        // Common property names - manually maintained list of Azure resource properties
        const allProperties = new Set(['id', 'name', 'type', 'kind', 'location', 'resourceGroup', 'subscriptionId', 'managedBy', 'sku', 'plan', 'properties', 'tags', 'tenantId', 'identity', 'zones', 'extendedLocation']);
        const properties = Array.from(allProperties).join('|');

        const textMateGrammar = {
            "name": "Azure Resource Graph KQL",
            "scopeName": "source.kql.arg",
            "fileTypes": ["kql"],
            "patterns": [
                { "include": "#comments" },
                { "include": "#keywords" },
                { "include": "#operators" },
                { "include": "#functions" },
                { "include": "#tables" },
                { "include": "#strings" },
                { "include": "#numbers" },
                { "include": "#properties" }
            ],
            "repository": {
                "comments": {
                    "patterns": [
                        {
                            "name": "comment.line.double-slash.kql",
                            "match": "//.*$"
                        },
                        {
                            "name": "comment.block.kql",
                            "begin": "/\\*",
                            "end": "\\*/"
                        }
                    ]
                },
                "keywords": {
                    "patterns": [
                        {
                            "name": "keyword.control.kql",
                            "match": `(?i)\\b(${operators})\\b`
                        },
                        {
                            "name": "keyword.operator.logical.kql",
                            "match": "(?i)\\b(and|or|not)\\b"
                        },
                        {
                            "name": "keyword.operator.comparison.kql",
                            "match": "(==|!=|<>|<=|>=|<|>|=~|!~|contains|!contains|has|!has|hasprefix|!hasprefix|hassuffix|!hassuffix|in|!in|startswith|!startswith|endswith|!endswith|matches|regex)"
                        },
                        {
                            "name": "keyword.other.kql",
                            "match": "(?i)\\b(by|asc|desc|nulls|first|last|with|on|kind|inner|outer|left|right|semi|anti|fullouter|innerunique|leftouter|rightouter|leftanti|rightanti|leftsemi|rightsemi)\\b"
                        }
                    ]
                },
                "operators": {
                    "patterns": [
                        {
                            "name": "keyword.operator.pipe.kql",
                            "match": "\\|"
                        },
                        {
                            "name": "keyword.operator.assignment.kql",
                            "match": "="
                        },
                        {
                            "name": "keyword.operator.arithmetic.kql",
                            "match": "[+\\-*/%]"
                        }
                    ]
                },
                "functions": {
                    "patterns": [
                        {
                            "name": "support.function.builtin.kql",
                            "match": `(?i)\\b(${functions})\\b`
                        }
                    ]
                },
                "tables": {
                    "patterns": [
                        {
                            "name": "support.class.table.kql",
                            "match": `(?i)\\b(${tables})\\b`
                        }
                    ]
                },
                "strings": {
                    "patterns": [
                        {
                            "name": "string.quoted.double.kql",
                            "begin": "\"",
                            "end": "\"",
                            "patterns": [
                                {
                                    "name": "constant.character.escape.kql",
                                    "match": "\\\\."
                                }
                            ]
                        },
                        {
                            "name": "string.quoted.single.kql",
                            "begin": "'",
                            "end": "'",
                            "patterns": [
                                {
                                    "name": "constant.character.escape.kql",
                                    "match": "\\\\."
                                }
                            ]
                        }
                    ]
                },
                "numbers": {
                    "patterns": [
                        {
                            "name": "constant.numeric.kql",
                            "match": "\\b([0-9]+\\.?[0-9]*([eE][+-]?[0-9]+)?[fdm]?)\\b"
                        },
                        {
                            "name": "constant.numeric.hex.kql",
                            "match": "\\b0[xX][0-9a-fA-F]+\\b"
                        }
                    ]
                },
                "properties": {
                    "patterns": [
                        {
                            "name": "variable.other.property.kql",
                            "match": `(?i)\\b(${properties})\\b`
                        },
                        {
                            "name": "variable.other.property.dot.kql",
                            "match": "\\.[a-zA-Z_][a-zA-Z0-9_]*"
                        }
                    ]
                }
            }
        };

        await fs.writeFile(
            path.join(syntaxDir, 'kql.tmLanguage.json'),
            JSON.stringify(textMateGrammar, null, 2)
        );

        console.log(`🎨 TextMate grammar written to: ${syntaxDir}/kql.tmLanguage.json`);
    }
}

// Main execution
if (require.main === module) {
    const generator = new ARGSchemaGenerator();
    generator.generateSchema().catch(console.error);
}

module.exports = ARGSchemaGenerator;
