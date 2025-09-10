#!/usr/bin/env node

/**
 * Azure Resource Graph Schema Generator
 * 
 * Dynamically parses Microsoft Learn documentation to generate KQL schema for bARGE
 * Sources:
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources - Get all tables
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language - Find all operators and links to their pages
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category - Get sample queries for all tables
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');

class ARGSchemaGenerator {
    constructor() {
        this.schema = {
            tables: {},
            resourceTypes: {},
            resourceTypeProperties: {}, // Detailed properties for each resource type
            operators: [],
            functions: [],
            lastUpdated: new Date().toISOString()
        };
        this.sampleQueries = [];
        this.kustoBaseUrl = 'https://learn.microsoft.com';
        this.requestDelay = 100; // ms delay between requests to be respectful
        
        // Retry configuration
        this.maxRetries = 5;
        this.baseRetryDelay = 1000; // Start with 1 second
        this.maxRetryDelay = 10000; // Cap at 10 seconds
        this.timeoutMs = 10000; // 10 second timeout per request
    }

    async fetchUrl(url, attempt = 1) {
        const isRetry = attempt > 1;
        console.log(`📥 ${isRetry ? `Retry ${attempt}/${this.maxRetries}: ` : ''}Fetching: ${url}`);
        
        try {
            const data = await this.makeHttpRequest(url);
            if (!isRetry) {
                console.log(`✅ Fetched ${data.length} characters from ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
            } else {
                console.log(`✅ Retry successful: ${data.length} characters from ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
            }
            return data;
        } catch (error) {
            if (attempt < this.maxRetries) {
                const delay = Math.min(this.baseRetryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
                console.warn(`⚠️ ${error.message} for ${url}. Retrying in ${delay}ms...`);
                await this.delay(delay);
                return this.fetchUrl(url, attempt + 1);
            } else {
                console.warn(`❌ Final attempt failed for ${url}: ${error.message}`);
                return ''; // Return empty string after all retries exhausted
            }
        }
    }

    async makeHttpRequest(url) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (res) => {
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http') 
                        ? res.headers.location 
                        : `${this.kustoBaseUrl}${res.headers.location}`;
                    console.log(`🔄 Redirecting to: ${redirectUrl}`);
                    resolve(this.makeHttpRequest(redirectUrl));
                    return;
                }
                
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
                res.on('error', err => reject(new Error(`Response error: ${err.message}`)));
            });
            
            request.on('error', (err) => {
                reject(new Error(`Network error: ${err.message}`));
            });
            
            request.setTimeout(this.timeoutMs, () => {
                request.destroy();
                reject(new Error(`Timeout after ${this.timeoutMs}ms`));
            });
        });
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async generateSchema() {
        console.log('🔍 Starting dynamic Azure Resource Graph schema generation...');
        
        try {
            // Step 1: Parse all tables from the tables documentation
            console.log('\n📋 Step 1: Parsing ARG tables...');
            const tablesDoc = await this.fetchUrl(
                'https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources'
            );
            await this.parseTables(tablesDoc);
            
            // Step 2: Parse operators from query language documentation
            console.log('\n🔧 Step 2: Discovering KQL operators...');
            const queryDoc = await this.fetchUrl(
                'https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language'
            );
            const operatorLinks = await this.extractOperatorLinks(queryDoc);
            
            // Step 3: Fetch detailed information for each operator
            console.log('\n� Step 3: Fetching operator definitions...');
            await this.fetchOperatorDefinitions(operatorLinks);
            
            // Step 4: Extract functions dynamically
            console.log('\n🔧 Step 4: Discovering KQL functions...');
            await this.extractFunctions(queryDoc);
            
            // Step 5: Fetch and match sample queries to tables
            console.log('\n📚 Step 5: Fetching sample queries...');
            await this.fetchAndMatchSampleQueries();
            
            // Step 6: Generate schema files
            console.log('\n💾 Step 6: Writing schema files...');
            await this.writeSchemaFiles();
            
            console.log('\n✅ Dynamic schema generation complete!');
            this.printSummary();
            
        } catch (error) {
            console.error('❌ Error generating schema:', error);
            throw error;
        }
    }

    printSummary() {
        console.log('\n📊 Generation Summary:');
        console.log(`   Tables: ${Object.keys(this.schema.tables).length}`);
        console.log(`   Resource Types: ${Object.keys(this.schema.resourceTypes).length}`);
        console.log(`   Operators: ${this.schema.operators.length}`);
        console.log(`   Functions: ${this.schema.functions.length}`);
    }

    async parseTables(htmlContent) {
        console.log('📋 Dynamically extracting ARG tables...');
        
        // Extract all table sections dynamically
        // Look for headers that contain "resources" (case-insensitive)
        const tableHeaderRegex = /<h2[^>]*>(.*?resources.*?)<\/h2>(.*?)(?=<h2|$)/gis;
        let match;
        let tableCount = 0;
        
        while ((match = tableHeaderRegex.exec(htmlContent)) !== null) {
            const headerText = match[1].trim();
            const sectionContent = match[2];
            
            // Extract clean table name from header
            const tableName = this.extractTableName(headerText);
            
            if (tableName && this.isValidTableName(tableName)) {
                console.log(`  🔍 Found table: ${tableName}`);
                
                // Extract description from the section
                const description = this.extractTableDescription(sectionContent, tableName);
                
                // Extract resource types from the section (skip for main "resources" table)
                let resourceTypes = this.extractResourceTypes(sectionContent);
                
                // Create table schema (exclude resourceTypes for main "resources" table)
                const tableSchema = {
                    name: tableName,
                    description: description,
                    examples: []
                };
                
                tableSchema.resourceTypes = resourceTypes;
                
                this.schema.tables[tableName] = tableSchema;
                
                // Add resource types to global index
                resourceTypes.forEach(resourceType => {
                    this.schema.resourceTypes[resourceType] = {
                        table: tableName,
                        type: resourceType
                    };
                });
                
                tableCount++;
                console.log(`    ✅ ${tableName}: ${resourceTypes.length} resource types`);
            }
        }
        
        console.log(`📋 Extracted ${tableCount} tables dynamically`);
    }

    extractTableName(headerText) {
        // Remove HTML tags and extract the clean table name
        const cleanHeader = headerText.replace(/<[^>]*>/g, '').trim();
        
        // Look for words ending in "resources" or just "resources"
        const tableMatch = cleanHeader.match(/\b(\w*resources?)\b/i);
        return tableMatch ? tableMatch[1].toLowerCase() : null;
    }

    extractTableDescription(sectionContent, tableName) {
        // Look for meaningful descriptions, avoiding common page elements
        const paragraphs = sectionContent.match(/<p[^>]*>(.*?)<\/p>/gis);
        
        if (paragraphs) {
            for (const paragraphMatch of paragraphs) {
                const description = paragraphMatch
                    .replace(/<p[^>]*>/gi, '')  // Remove opening p tag
                    .replace(/<\/p>/gi, '')     // Remove closing p tag
                    .replace(/<[^>]*>/g, '')    // Remove all other HTML tags
                    .replace(/\s+/g, ' ')       // Normalize whitespace
                    .trim();
                
                // Skip common footer/navigation text
                const skipPatterns = [
                    /was this page helpful/i,
                    /did this page help/i,
                    /feedback/i,
                    /microsoft\.com/i,
                    /privacy/i,
                    /terms of use/i,
                    /cookie/i,
                    /trademark/i,
                    /contribute/i,
                    /previous versions/i,
                    /learn\.microsoft\.com/i,
                    /^https?:\/\//i,
                    /^\s*$/, // Empty or whitespace only
                    /^[^a-zA-Z]*$/ // No letters (just symbols/numbers)
                ];
                
                // Check if this description should be skipped
                const shouldSkip = skipPatterns.some(pattern => pattern.test(description));
                
                if (!shouldSkip && description.length > 10 && description.length < 200) {
                    // Add sample query link to the extracted description
                    const sampleLink = `https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category`;
                    return `${description} [View sample queries](${sampleLink}).`;
                }
            }
        }
        
        // Fallback to a more specific description based on the table name
        if (tableName === 'resources') {
            return 'Most Resource Manager resource types and properties are here. [View sample queries](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/starter).';
        }
        
        return `For sample queries for this table, see [Resource Graph sample queries for ${tableName}](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category).`;
    }

    extractResourceTypes(sectionContent) {
        const resourceTypes = [];
        
        // Look for resource type patterns in various formats
        // Pattern 1: microsoft.resource/type format (most common)
        const typePattern1 = /\b(microsoft\.[a-zA-Z0-9]+\/[a-zA-Z0-9./-]+)\b/gi;
        // Pattern 2: Simple type/subtype format  
        const typePattern2 = /\b([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*\/[a-zA-Z][a-zA-Z0-9./-]*)\b/gi;
        // Pattern 3: Code blocks that might contain resource types
        const codeBlockPattern = /<code[^>]*>(.*?)<\/code>/gis;
        // Pattern 4: Pre-formatted text that might contain resource types
        const prePattern = /<pre[^>]*>(.*?)<\/pre>/gis;
        
        let match;
        
        // Extract from code blocks first (most reliable)
        while ((match = codeBlockPattern.exec(sectionContent)) !== null) {
            const codeContent = match[1];
            this.extractTypesFromText(codeContent, resourceTypes);
        }
        
        // Extract from pre-formatted text
        while ((match = prePattern.exec(sectionContent)) !== null) {
            const preContent = match[1];
            this.extractTypesFromText(preContent, resourceTypes);
        }
        
        // Extract using pattern 1 from the full content
        while ((match = typePattern1.exec(sectionContent)) !== null) {
            const resourceType = match[1].toLowerCase();
            if (this.isValidResourceType(resourceType) && !resourceTypes.includes(resourceType)) {
                resourceTypes.push(resourceType);
            }
        }
        
        // Extract using pattern 2 if we didn't find many with pattern 1
        if (resourceTypes.length < 10) {
            while ((match = typePattern2.exec(sectionContent)) !== null) {
                const resourceType = match[1].toLowerCase();
                if (this.isValidResourceType(resourceType) && !resourceTypes.includes(resourceType)) {
                    resourceTypes.push(resourceType);
                }
            }
        }
        
        // For very sparse results, try even more aggressive patterns
        if (resourceTypes.length < 5) {
            // Look for quoted resource types
            const quotedPattern = /['"`](microsoft\.[a-zA-Z0-9]+\/[a-zA-Z0-9./-]+)['"`]/gi;
            while ((match = quotedPattern.exec(sectionContent)) !== null) {
                const resourceType = match[1].toLowerCase();
                if (this.isValidResourceType(resourceType) && !resourceTypes.includes(resourceType)) {
                    resourceTypes.push(resourceType);
                }
            }
            
            // Look for resource types in table cells
            const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
            while ((match = cellPattern.exec(sectionContent)) !== null) {
                const cellContent = match[1];
                this.extractTypesFromText(cellContent, resourceTypes);
            }
        }
        
        return resourceTypes;
    }

    extractTypesFromText(text, resourceTypes) {
        const typePattern = /\b(microsoft\.[a-zA-Z0-9]+\/[a-zA-Z0-9./-]+)\b/gi;
        let match;
        
        while ((match = typePattern.exec(text)) !== null) {
            const resourceType = match[1].toLowerCase();
            if (this.isValidResourceType(resourceType) && !resourceTypes.includes(resourceType)) {
                resourceTypes.push(resourceType);
            }
        }
    }

    async extractOperatorLinks(queryDoc) {
        console.log('🔍 Dynamically discovering supported operators...');
        
        const operatorLinks = [];
        
        // Look for tables that contain operator information
        // We'll search for table rows that have links to operator documentation
        const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
        let match;
        
        while ((match = tableRowRegex.exec(queryDoc)) !== null) {
            const rowContent = match[1];
            
            // Look for links to kusto documentation within table cells
            const linkRegex = /<a[^>]*href="([^"]*kusto[^"]*operator[^"]*)"[^>]*>(.*?)<\/a>/gi;
            let linkMatch;
            
            while ((linkMatch = linkRegex.exec(rowContent)) !== null) {
                const href = linkMatch[1];
                const linkText = linkMatch[2].replace(/<[^>]*>/g, '').trim();
                
                // Clean up the operator name
                const operatorName = this.extractOperatorName(linkText);
                
                if (operatorName && this.isValidOperatorName(operatorName)) {
                    const fullUrl = href.startsWith('http') ? href : `${this.kustoBaseUrl}${href}`;
                    
                    operatorLinks.push({
                        name: operatorName,
                        url: fullUrl,
                        displayName: linkText
                    });
                    
                    console.log(`  🔗 Found operator: ${operatorName} -> ${fullUrl}`);
                }
            }
        }
        
        // Also search for any operator mentions outside of tables
        const operatorMentionRegex = /<a[^>]*href="([^"]*kusto[^"]*query[^"]*\/([a-zA-Z-]+)-operator[^"]*)"[^>]*>/gi;
        while ((match = operatorMentionRegex.exec(queryDoc)) !== null) {
            const href = match[1];
            const operatorName = match[2].replace(/-/g, '').toLowerCase();
            
            if (this.isValidOperatorName(operatorName) && 
                !operatorLinks.some(op => op.name === operatorName)) {
                
                const fullUrl = href.startsWith('http') ? href : `${this.kustoBaseUrl}${href}`;
                
                operatorLinks.push({
                    name: operatorName,
                    url: fullUrl,
                    displayName: operatorName
                });
                
                console.log(`  � Found additional operator: ${operatorName} -> ${fullUrl}`);
            }
        }
        
        console.log(`🔗 Discovered ${operatorLinks.length} tabular operators to fetch`);
        
        // Add common comparison operators that might not be in the main operator documentation
        console.log('🔍 Adding common comparison operators...');
        const commonComparisonOps = [
            'contains', '!contains', 'has', '!has', 'hasprefix', '!hasprefix', 
            'hassuffix', '!hassuffix', 'startswith', '!startswith', 'endswith', 
            '!endswith', 'matches', 'regex', 'in', '!in'
        ];
        
        for (const opName of commonComparisonOps) {
            if (!operatorLinks.some(op => op.name === opName)) {
                operatorLinks.push({
                    name: opName,
                    url: null, // No specific URL for comparison operators
                    displayName: opName
                });
                console.log(`  ➕ Added comparison operator: ${opName}`);
            }
        }
        
        console.log(`🔗 Total operators (tabular + comparison): ${operatorLinks.length}`);
        return operatorLinks;
    }

    extractOperatorName(linkText) {
        // Extract clean operator name from link text
        const cleaned = linkText.toLowerCase()
            .replace(/operator/gi, '')
            .replace(/[^a-z\-]/g, '')
            .replace(/^-+|-+$/g, '');
        
        return cleaned || null;
    }

    isValidOperatorName(name) {
        // Basic validation for operator names
        return name && 
               name.length >= 2 && 
               name.length <= 20 && 
               /^[a-z-]+$/.test(name) &&
               !name.includes('--');
    }

    async fetchOperatorDefinitions(operatorLinks) {
        console.log(`📖 Fetching definitions for ${operatorLinks.length} operators...`);
        
        for (const operator of operatorLinks) {
            try {
                await this.delay(this.requestDelay); // Be respectful to the server
                
                // Handle operators without specific documentation URLs (comparison operators)
                if (!operator.url) {
                    console.log(`  ➕ Adding comparison operator: ${operator.name}`);
                    const operatorInfo = this.createComparisonOperatorInfo(operator);
                    this.schema.operators.push(operatorInfo);
                    console.log(`    ✅ ${operator.name}: ${operatorInfo.description}`);
                    continue;
                }
                
                console.log(`  📖 Fetching definition for: ${operator.name}`);
                const operatorDoc = await this.fetchUrl(operator.url);
                const operatorInfo = this.parseOperatorDefinition(operator, operatorDoc);
                
                if (operatorInfo) {
                    this.schema.operators.push(operatorInfo);
                    console.log(`    ✅ ${operator.name}: ${operatorInfo.description.substring(0, 50)}...`);
                } else {
                    console.log(`    ⚠️ Could not parse definition for ${operator.name}`);
                }
                
            } catch (error) {
                console.warn(`    ❌ Failed to fetch definition for ${operator.name}:`, error.message);
                
                // Add a basic fallback entry
                this.schema.operators.push({
                    name: operator.name,
                    displayName: operator.displayName,
                    category: 'general',
                    description: `KQL operator: ${operator.name}`,
                    syntax: `... | ${operator.name} ...`,
                    examples: []
                });
            }
        }
        
        console.log(`📖 Successfully processed ${this.schema.operators.length} operators`);
    }

    createComparisonOperatorInfo(operator) {
        const name = operator.name;
        
        // Create appropriate descriptions for common comparison operators
        let description, syntax, category;
        
        if (name.includes('contains')) {
            description = name.startsWith('!') 
                ? 'Tests that input string does not contain specified substring'
                : 'Tests that input string contains specified substring';
            syntax = `<column> ${name} "<value>"`;
            category = 'comparison';
        } else if (name.includes('has')) {
            description = name.startsWith('!') 
                ? 'Tests that input does not have specified term'
                : 'Tests that input has specified term';
            syntax = `<column> ${name} "<value>"`;
            category = 'comparison';
        } else if (name.includes('startswith')) {
            description = name.startsWith('!') 
                ? 'Tests that input does not start with specified value'
                : 'Tests that input starts with specified value';
            syntax = `<column> ${name} "<value>"`;
            category = 'comparison';
        } else if (name.includes('endswith')) {
            description = name.startsWith('!') 
                ? 'Tests that input does not end with specified value'
                : 'Tests that input ends with specified value';
            syntax = `<column> ${name} "<value>"`;
            category = 'comparison';
        } else if (name === 'matches' || name === 'regex') {
            description = 'Tests input against regular expression pattern';
            syntax = `<column> ${name} regex("<pattern>")`;
            category = 'comparison';
        } else if (name.includes('in')) {
            description = name.startsWith('!') 
                ? 'Tests that value is not in specified list'
                : 'Tests that value is in specified list';
            syntax = `<column> ${name} (<value1>, <value2>, ...)`;
            category = 'comparison';
        } else {
            description = `KQL comparison operator: ${name}`;
            syntax = `<column> ${name} <value>`;
            category = 'comparison';
        }
        
        return {
            name: name,
            displayName: operator.displayName,
            category: category,
            description: description,
            syntax: syntax,
            examples: []
        };
    }

    parseOperatorDefinition(operator, htmlContent) {
        try {
            // Extract the main description - usually in the first paragraph after the title
            const description = this.extractOperatorDescription(htmlContent);
            
            // Extract syntax information
            const syntax = this.extractOperatorSyntax(htmlContent, operator.name);
            
            // Extract examples
            const examples = this.extractOperatorExamples(htmlContent);
            
            // Determine category based on description and examples
            const category = this.determineOperatorCategory(operator.name, description, examples);
            
            return {
                name: operator.name,
                displayName: operator.displayName,
                category: category,
                description: description,
                syntax: syntax,
                examples: examples,
                sourceUrl: operator.url
            };
            
        } catch (error) {
            console.warn(`Error parsing operator definition for ${operator.name}:`, error.message);
            return null;
        }
    }

    extractOperatorDescription(htmlContent) {
        // Look for meaningful descriptions, avoiding common page elements
        const patterns = [
            // Pattern 1: First paragraph after a heading
            /<h[1-6][^>]*>.*?<\/h[1-6]>\s*<p[^>]*>(.*?)<\/p>/is,
            // Pattern 2: Description in a summary or overview section
            /<p[^>]*class="[^"]*summary[^"]*"[^>]*>(.*?)<\/p>/is,
            // Pattern 3: First substantial paragraph
            /<p[^>]*>([^<]{50,}?)<\/p>/is
        ];
        
        // Patterns to skip (common Microsoft Learn boilerplate)
        const skipPatterns = [
            /upgrade to microsoft edge/i,
            /microsoft edge.*latest features/i,
            /browser.*not supported/i,
            /this browser is no longer supported/i,
            /for the best experience/i,
            /was this page helpful/i,
            /did this page help/i,
            /feedback/i,
            /microsoft\.com/i,
            /privacy/i,
            /terms of use/i,
            /cookie/i,
            /trademark/i,
            /contribute/i,
            /previous versions/i,
            /learn\.microsoft\.com/i,
            /^\s*$/, // Empty or whitespace only
            /^[^a-zA-Z]*$/ // No letters (just symbols/numbers)
        ];
        
        for (const pattern of patterns) {
            const matches = htmlContent.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
            
            for (const match of matches) {
                const description = match[1]
                    .replace(/<[^>]*>/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                // Check if this description should be skipped
                const shouldSkip = skipPatterns.some(skipPattern => skipPattern.test(description));
                
                if (!shouldSkip && description.length > 20 && description.length < 300) {
                    return description.substring(0, 200) + (description.length > 200 ? '...' : '');
                }
            }
        }
        
        return 'KQL operator for data transformation';
    }

    extractOperatorSyntax(htmlContent, operatorName) {
        // Look for syntax or usage patterns
        const syntaxPatterns = [
            // Pattern 1: Code blocks with syntax
            /<code[^>]*>(.*?)<\/code>/gis,
            // Pattern 2: Pre-formatted syntax blocks
            /<pre[^>]*>(.*?)<\/pre>/gis
        ];
        
        for (const pattern of syntaxPatterns) {
            const matches = [...htmlContent.matchAll(pattern)];
            for (const match of matches) {
                const code = match[1].replace(/<[^>]*>/g, '').trim();
                if (code.includes(operatorName) || code.includes('|')) {
                    return code.substring(0, 100) + (code.length > 100 ? '...' : '');
                }
            }
        }
        
        return `... | ${operatorName} ...`;
    }

    extractOperatorExamples(htmlContent) {
        const examples = [];
        
        // Look for example sections
        const exampleSectionRegex = /<h[1-6][^>]*>.*?example.*?<\/h[1-6]>(.*?)(?=<h[1-6]|$)/gis;
        const matches = [...htmlContent.matchAll(exampleSectionRegex)];
        
        for (const match of matches) {
            const sectionContent = match[1];
            
            // Extract code blocks from the example section
            const codeBlockRegex = /<(?:pre|code)[^>]*>(.*?)<\/(?:pre|code)>/gis;
            const codeMatches = [...sectionContent.matchAll(codeBlockRegex)];
            
            for (const codeMatch of codeMatches) {
                const code = codeMatch[1]
                    .replace(/<[^>]*>/g, '')
                    .trim();
                
                if (code.length > 10 && code.includes('|')) {
                    examples.push(code);
                    if (examples.length >= 2) { 
                        break; // Limit to 2 examples per operator
                    }
                }
            }
            
            if (examples.length >= 2) { 
                break;
            }
        }
        
        return examples;
    }

    determineOperatorCategory(operatorName, description, examples) {
        const desc = description.toLowerCase();
        const name = operatorName.toLowerCase();
        
        // Dynamically categorize based on actual content from documentation
        // Look for category indicators in the description
        if (desc.includes('join') || desc.includes('combine') || desc.includes('merge')) {
            return 'join';
        }
        if (desc.includes('union') || desc.includes('concatenate') || desc.includes('append')) {
            return 'union';
        }
        if (desc.includes('filter') || desc.includes('condition') || desc.includes('criteria') || desc.includes('where')) {
            return 'filter';
        }
        if (desc.includes('project') || desc.includes('select') || desc.includes('column') || desc.includes('field')) {
            return 'projection';
        }
        if (desc.includes('sort') || desc.includes('order') || desc.includes('arrange')) {
            return 'sort';
        }
        if (desc.includes('limit') || desc.includes('restrict') || desc.includes('top') || desc.includes('first')) {
            return 'limit';
        }
        if (desc.includes('aggregat') || desc.includes('group') || desc.includes('summariz') || desc.includes('count')) {
            return 'aggregation';
        }
        if (desc.includes('expand') || desc.includes('flatten') || desc.includes('unfold')) {
            return 'expand';
        }
        if (desc.includes('parse') || desc.includes('extract') || desc.includes('process')) {
            return 'parsing';
        }
        
        return 'general';
    }

    async extractFunctions(queryDoc) {
        console.log('🔧 Dynamically discovering KQL functions...');
        
        const functions = new Set();
        
        // Look for function patterns in the documentation
        // Pattern 1: function_name() in code blocks
        const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
        
        // Extract functions from code examples
        const codeBlockRegex = /<(?:code|pre)[^>]*>(.*?)<\/(?:code|pre)>/gis;
        const codeMatches = [...queryDoc.matchAll(codeBlockRegex)];
        
        for (const match of codeMatches) {
            const code = match[1].replace(/<[^>]*>/g, '');
            let funcMatch;
            
            while ((funcMatch = functionCallRegex.exec(code)) !== null) {
                const funcName = funcMatch[1].toLowerCase();
                
                if (this.isValidFunctionName(funcName)) {
                    functions.add(funcName);
                }
            }
        }
        
        // Look for explicit function references in links
        const functionLinkRegex = /<a[^>]*href="[^"]*\/([a-zA-Z_][a-zA-Z0-9_-]*)-function[^"]*"[^>]*>/gi;
        let linkMatch;
        
        while ((linkMatch = functionLinkRegex.exec(queryDoc)) !== null) {
            const funcName = linkMatch[1].replace(/-/g, '').toLowerCase();
            if (this.isValidFunctionName(funcName)) {
                functions.add(funcName);
            }
        }
        
        // Convert to array and create function objects - fully dynamic without hardcoded categories
        this.schema.functions = Array.from(functions).map(funcName => ({
            name: funcName,
            category: 'function', // Simple generic category - completely dynamic
            description: `KQL function: ${funcName}`, // Simple dynamic description
            syntax: `${funcName}()`
        }));
        
        console.log(`🔧 Discovered ${this.schema.functions.length} functions dynamically`);
    }

    isValidFunctionName(name) {
        // Validate function names
        return name && 
               name.length >= 2 && 
               name.length <= 30 && 
               /^[a-z_][a-z0-9_]*$/.test(name) &&
               !this.isReservedWord(name);
    }

    isReservedWord(word) {
        // Common programming language reserved words that shouldn't be treated as KQL functions
        const reserved = [
            'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'function', 'return', 
            'var', 'let', 'const', 'class', 'struct', 'enum', 'interface', 'public', 'private',
            'static', 'void', 'int', 'string', 'bool', 'double', 'float', 'char', 'byte',
            'true', 'false', 'null', 'undefined', 'new', 'delete', 'this', 'super', 'try', 'catch'
        ];
        return reserved.includes(word);
    }

    async fetchAndMatchSampleQueries() {
        console.log('📚 Fetching sample queries from Microsoft documentation...');
        
        try {
            const sampleUrl = 'https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category';
            const htmlContent = await this.fetchUrl(sampleUrl);
            
            console.log('📝 Parsing KQL code snippets from samples...');
            const codeSnippets = this.parseCodeSnippets(htmlContent);
            
            console.log('🔗 Matching code snippets to tables...');
            this.matchSnippetsToTables(codeSnippets);
            
        } catch (error) {
            console.warn('⚠️ Could not fetch sample queries:', error.message);
            console.log('📝 Tables will have no examples');
        }
    }

    parseCodeSnippets(htmlContent) {
        console.log('🔍 Extracting KQL code snippets...');
        const codeSnippets = [];
        
        // Look for code blocks in various formats
        const codeBlockPatterns = [
            // Pattern 1: Standard markdown code blocks
            /```\s*(?:kql|kusto)?\s*(.*?)```/gs,
            // Pattern 2: HTML pre/code blocks
            /<(?:pre|code)[^>]*class="[^"]*(?:lang-kql|lang-kusto|highlight)[^"]*"[^>]*>(.*?)<\/(?:pre|code)>/gs,
            // Pattern 3: Any pre/code block that might contain KQL
            /<(?:pre|code)[^>]*>(.*?)<\/(?:pre|code)>/gs
        ];
        
        for (const pattern of codeBlockPatterns) {
            let match;
            while ((match = pattern.exec(htmlContent)) !== null) {
                const rawCode = match[1];
                const cleanCode = this.cleanCodeSnippet(rawCode);
                
                if (cleanCode && this.isKQLQuery(cleanCode)) {
                    codeSnippets.push(cleanCode);
                    console.log(`  ✅ Found KQL snippet (${cleanCode.length} chars)`);
                }
            }
        }
        
        // Remove duplicates
        const uniqueSnippets = [...new Set(codeSnippets)];
        console.log(`📝 Extracted ${uniqueSnippets.length} unique KQL code snippets`);
        
        return uniqueSnippets;
    }

    cleanCodeSnippet(rawCode) {
        if (!rawCode) { 
            return null; 
        }
        
        // Remove HTML tags
        let cleaned = rawCode.replace(/<[^>]*>/g, '');
        
        // Decode HTML entities
        cleaned = cleaned
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        
        // Remove extra whitespace and normalize
        cleaned = cleaned
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
        
        return cleaned;
    }

    isKQLQuery(code) {
        if (!code || typeof code !== 'string') { 
            return false; 
        }
        
        // Check for KQL characteristics
        const hasTableNames = Object.keys(this.schema.tables).some(table => 
            new RegExp(`\\b${table}\\b`, 'i').test(code)
        );
        
        const hasOperators = this.schema.operators.some(op => 
            new RegExp(`\\b${op.name}\\b`, 'i').test(code)
        );
        
        const hasPipeOperator = code.includes('|');

        return (hasTableNames || hasOperators || hasPipeOperator) && 
               !code.includes('curl') && 
               !code.includes('http://') && 
               !code.includes('https://');
    }

    matchSnippetsToTables(codeSnippets) {
        console.log('🔗 Matching code snippets to tables...');
        
        let totalMatches = 0;
        
        // Sort tables by length (longest first) to prioritize more specific matches
        const sortedTables = Object.keys(this.schema.tables).sort((a, b) => {
            return this.schema.tables[b].name.length - this.schema.tables[a].name.length;
        });
        
        // Track which snippets have been matched to avoid duplicates
        const matchedSnippets = new Set();
        
        sortedTables.forEach(tableKey => {
            const tableName = this.schema.tables[tableKey].name;
            const tableExamples = [];
            
            // First pass: Find snippets that START with the table name (highest priority)
            for (const snippet of codeSnippets) {
                if (matchedSnippets.has(snippet) || tableExamples.length >= 2) {
                    continue;
                }
                
                if (this.snippetStartsWithTable(snippet, tableName)) {
                    tableExamples.push(snippet);
                    matchedSnippets.add(snippet);
                }
            }
            
            // Second pass: If we need more examples, find snippets that contain the table name
            if (tableExamples.length < 2) {
                for (const snippet of codeSnippets) {
                    if (matchedSnippets.has(snippet) || tableExamples.length >= 2) {
                        continue;
                    }
                    
                    if (this.isSnippetForTable(snippet, tableName)) {
                        tableExamples.push(snippet);
                        matchedSnippets.add(snippet);
                    }
                }
            }
            
            // Update the table with examples
            if (tableExamples.length > 0) {
                this.schema.tables[tableKey].examples = tableExamples;
                totalMatches += tableExamples.length;
                console.log(`  ✅ ${tableName}: ${tableExamples.length} example(s)`);
            } else {
                console.log(`  ⚠️ ${tableName}: No examples found`);
            }
        });
        
        console.log(`🔗 Total examples matched: ${totalMatches}`);
    }

    snippetStartsWithTable(snippet, tableName) {
        // Check if the snippet starts with the table name (case-insensitive)
        // This is the highest priority match
        const trimmedSnippet = snippet.trim();
        const lowerSnippet = trimmedSnippet.toLowerCase();
        const lowerTableName = tableName.toLowerCase();
        
        // Pattern: TableName followed by whitespace or pipe
        const startsWithPattern = new RegExp(`^${lowerTableName}\\s*[\\|\\s]`, 'i');
        return startsWithPattern.test(trimmedSnippet);
    }

    isSnippetForTable(snippet, tableName) {
        // Convert to lowercase for case-insensitive matching
        const lowerSnippet = snippet.toLowerCase();
        const lowerTableName = tableName.toLowerCase();
        
        // For exact table name matches, ensure it's not part of a longer table name
        // Look for the table name as a standalone word in FROM clause or pipe context
        const exactTablePatterns = [
            new RegExp(`\\bfrom\\s+${lowerTableName}\\b`, 'i'),
            new RegExp(`\\|\\s*${lowerTableName}\\s*\\|`, 'i'),
            new RegExp(`\\|\\s*${lowerTableName}\\s*$`, 'i')
        ];
        
        // Check if any of the exact patterns match
        const hasExactMatch = exactTablePatterns.some(pattern => pattern.test(snippet));
        
        if (hasExactMatch) {
            // Additional check: make sure it's not actually referencing a longer table name
            // Get all table names that contain this table name as a substring
            const longerTables = Object.keys(this.schema.tables)
                .map(key => this.schema.tables[key].name.toLowerCase())
                .filter(name => name !== lowerTableName && name.includes(lowerTableName));
            
            // If any longer table name is also present in the snippet, this is not a match
            const hasLongerTableMatch = longerTables.some(longerTable => {
                const longerTablePattern = new RegExp(`\\b${longerTable}\\b`, 'i');
                return longerTablePattern.test(snippet);
            });
            
            return !hasLongerTableMatch;
        }
        
        return false;
    }

    isValidTableName(name) {
        return name && 
               typeof name === 'string' &&
               name.length >= 3 && 
               name.length <= 50 &&
               /^[a-zA-Z][a-zA-Z0-9]*$/i.test(name) &&
               name.toLowerCase().includes('resource');
    }

    isValidResourceType(type) {
        if (!type || typeof type !== 'string') {
            return false;
        }
        
        // Must match the basic pattern for resource types
        if (!/^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9./\-_]*\/[a-zA-Z][a-zA-Z0-9./\-_]*$/i.test(type)) {
            return false;
        }
        
        // Exclude obvious non-resource-types
        const excludePatterns = [
            /microsoft\.com/i,
            /learn\.microsoft\.com/i,
            /\.html$/i,
            /\.asp$/i,
            /\.php$/i,
            /\/en-us\//i,
            /\/fwlink/i,
            /\/contribute/i,
            /\/legal/i,
            /\/privacy/i,
            /\/terms/i,
            /\/previous-versions/i,
            /\/principles-for-ai/i,
            /\/blog/i
        ];
        
        // Check if the type matches any exclude pattern
        const shouldExclude = excludePatterns.some(pattern => pattern.test(type));
        
        return !shouldExclude;
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
            })),
            properties: this.generatePropertyCompletions()
        };

        await fs.writeFile(
            path.join(outputDir, 'completion-data.json'),
            JSON.stringify(completionData, null, 2)
        );
    }

    /**
     * Generate property completions from detailed schema data
     */
    generatePropertyCompletions() {
        const properties = [];
        const allPropertyNames = new Set();
        
        // Add standard Azure resource properties
        const standardProperties = [
            { name: 'id', type: 'string', description: 'Resource ID' },
            { name: 'name', type: 'string', description: 'Resource name' },
            { name: 'type', type: 'string', description: 'Resource type' },
            { name: 'kind', type: 'string', description: 'Resource kind' },
            { name: 'location', type: 'string', description: 'Resource location' },
            { name: 'resourceGroup', type: 'string', description: 'Resource group name' },
            { name: 'subscriptionId', type: 'string', description: 'Subscription ID' },
            { name: 'tenantId', type: 'string', description: 'Tenant ID' },
            { name: 'managedBy', type: 'string', description: 'Managed by resource ID' },
            { name: 'sku', type: 'object', description: 'Resource SKU' },
            { name: 'plan', type: 'object', description: 'Resource plan' },
            { name: 'properties', type: 'object', description: 'Resource properties' },
            { name: 'tags', type: 'object', description: 'Resource tags' },
            { name: 'identity', type: 'object', description: 'Resource identity' },
            { name: 'zones', type: 'array', description: 'Availability zones' },
            { name: 'extendedLocation', type: 'object', description: 'Extended location' }
        ];

        standardProperties.forEach(prop => {
            properties.push({
                label: prop.name,
                kind: 'Property',
                detail: `${prop.type}: ${prop.description}`,
                insertText: prop.name
            });
            allPropertyNames.add(prop.name);
        });

        // Add properties from detailed schema if available
        if (this.schema.resourceTypeProperties) {
            for (const [resourceType, resourceProps] of Object.entries(this.schema.resourceTypeProperties)) {
                for (const [propName, propInfo] of Object.entries(resourceProps)) {
                    if (!allPropertyNames.has(propName)) {
                        properties.push({
                            label: propName,
                            kind: 'Property',
                            detail: `${propInfo.type || 'unknown'}: ${propInfo.description || `Property from ${resourceType}`}`,
                            insertText: propName,
                            resourceType: resourceType
                        });
                        allPropertyNames.add(propName);
                    }
                }
            }
        } else {
            // Fallback: extract properties from basic resource type info
            for (const [resourceType, resourceInfo] of Object.entries(this.schema.resourceTypes)) {
                if (resourceInfo.properties && Array.isArray(resourceInfo.properties)) {
                    resourceInfo.properties.forEach(propName => {
                        if (!allPropertyNames.has(propName)) {
                            properties.push({
                                label: propName,
                                kind: 'Property',
                                detail: `Property from ${resourceType}`,
                                insertText: propName,
                                resourceType: resourceType
                            });
                            allPropertyNames.add(propName);
                        }
                    });
                }
            }
        }

        console.log(`📝 Generated ${properties.length} property completions`);
        return properties;
    }

    async generateTextMateGrammar() {
        const syntaxDir = path.join(__dirname, '..', 'syntaxes');
        
        try {
            await fs.mkdir(syntaxDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        console.log('🎨 Generating dynamic TextMate grammar...');

        // Extract dynamic lists from schema
        const operators = this.schema.operators.map(op => op.name).filter(name => name).join('|');
        const functions = this.schema.functions.map(fn => fn.name).filter(name => name).join('|');
        const tables = Object.keys(this.schema.tables).filter(name => name).join('|');
        
        // Extract common properties from all sources
        const allProperties = new Set();
        
        // Add standard Azure resource properties
        ['id', 'name', 'type', 'kind', 'location', 'resourceGroup', 'subscriptionId', 'tenantId', 
         'managedBy', 'sku', 'plan', 'properties', 'tags', 'identity', 'zones', 'extendedLocation'].forEach(prop => {
            allProperties.add(prop);
        });
        
        // Add properties from detailed schema if available
        if (this.schema.resourceTypeProperties) {
            for (const resourceProps of Object.values(this.schema.resourceTypeProperties)) {
                for (const propName of Object.keys(resourceProps)) {
                    // Only add top-level properties (not nested like "properties.something")
                    if (!propName.includes('.')) {
                        allProperties.add(propName);
                    }
                }
            }
        } else {
            // Fallback: extract properties from basic resource type info
            Object.values(this.schema.resourceTypes).forEach(rt => {
                if (rt.properties && Array.isArray(rt.properties)) {
                    rt.properties.forEach(prop => {
                        if (!prop.includes('.')) {
                            allProperties.add(prop);
                        }
                    });
                }
                
                // Extract properties from resource type names
                if (rt.name) {
                    const typeParts = rt.name.split('/');
                    if (typeParts.length >= 2) {
                        // Add the resource provider as a potential property
                        const provider = typeParts[0].split('.').pop();
                        if (provider && provider.length > 2) {
                            allProperties.add(provider);
                        }
                    }
                }
            });
        }
        
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
                            "match": operators ? `(?i)\\b(${operators})\\b` : "(?i)\\b(where|project|summarize)\\b"
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
                            "match": functions ? `(?i)\\b(${functions})\\b` : "(?i)\\b(tostring|count|now)\\b"
                        }
                    ]
                },
                "tables": {
                    "patterns": [
                        {
                            "name": "support.class.table.kql",
                            "match": tables ? `(?i)\\b(${tables})\\b` : "(?i)\\b(resources|resourcecontainers)\\b"
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
                            "match": properties ? `(?i)\\b(${properties})\\b` : "(?i)\\b(id|name|type|location)\\b"
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

        console.log(`🎨 Dynamic TextMate grammar written with:`);
        console.log(`   - ${this.schema.operators.length} operators`);
        console.log(`   - ${this.schema.functions.length} functions`);
        console.log(`   - ${Object.keys(this.schema.tables).length} tables`);
        console.log(`   - ${allProperties.size} properties`);
    }

    /**
     * Fetch schema directly from Azure Resource Graph API
     * Step 1: Get all tables and their resource types
     * Step 2: For each resource type, fetch detailed schema
     */
    async fetchSchemaFromAzureAPI(bearerToken) {
        console.log('🔍 Step 1: Fetching table categories from Azure Resource Graph API...');
        
        // Step 1: Get all tables and resource types
        const categoriesData = await this.fetchTableCategories(bearerToken);
        if (!categoriesData) {
            return null;
        }

        // Step 2: Fetch detailed schema for each resource type
        return await this.fetchDetailedSchemas(bearerToken, categoriesData);
    }

    /**
     * Step 1: Fetch table categories and resource types
     */
    async fetchTableCategories(bearerToken) {
        const requestOptions = {
            hostname: 'management.azure.com',
            port: 443,
            path: '/providers/microsoft.resourcegraph/resources/schema?action=ListCategories&api-version=2018-09-01-preview&$expand=resourceType',
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'en',
                'Authorization': `Bearer ${bearerToken}`,
                'x-ms-client-request-id': this.generateGuid(),
                'x-ms-command-name': 'bARGE.SchemaGenerator',
                'User-Agent': 'bARGE-SchemaGenerator/1.0'
            }
        };

        try {
            const responseData = await this.makeHttpsRequest(requestOptions);
            const schemaData = JSON.parse(responseData);
            
            console.log(`✅ Successfully retrieved ${Object.keys(schemaData).length} table categories`);
            console.log(`📋 Tables found: ${Object.keys(schemaData).join(', ')}`);
            
            return schemaData;
        } catch (error) {
            console.error(`❌ Error fetching table categories: ${error.message}`);
            return null;
        }
    }

    /**
     * Step 2: Fetch detailed schema for each resource type
     */
    async fetchDetailedSchemas(bearerToken, categoriesData) {
        console.log('🔍 Step 2: Fetching detailed schemas for each resource type...');
        
        const tables = {};
        const resourceTypes = {};
        const resourceTypeProperties = {}; // Store detailed properties for each resource type
        
        // Process each table category
        for (const [tableName, resourceTypeArray] of Object.entries(categoriesData)) {
            console.log(`📋 Processing table: ${tableName} (${resourceTypeArray.length} resource types)`);
            
            // Initialize table
            tables[tableName] = {
                name: tableName,
                displayName: this.formatTableDisplayName(tableName),
                description: `Azure Resource Graph table containing ${tableName} data`,
                resourceTypes: resourceTypeArray,
                examples: []
            };

            // Process each resource type in this table
            for (const resourceType of resourceTypeArray) {
                console.log(`  🔍 Fetching schema for: ${resourceType}`);
                
                try {
                    // Add delay between requests to avoid rate limiting
                    await this.delay(this.requestDelay);
                    
                    const resourceSchema = await this.fetchResourceTypeSchema(bearerToken, tableName, resourceType);
                    
                    if (resourceSchema) {
                        // Store basic resource type info
                        resourceTypes[resourceType] = {
                            name: resourceType,
                            displayName: resourceType,
                            description: `Resource type: ${resourceType}`,
                            table: tableName,
                            properties: Object.keys(resourceSchema)
                        };
                        
                        // Store detailed properties for completion
                        resourceTypeProperties[resourceType] = resourceSchema;
                        
                        console.log(`    ✅ ${resourceType}: ${Object.keys(resourceSchema).length} properties`);
                    } else {
                        console.log(`    ⚠️ Failed to fetch schema for ${resourceType}`);
                        
                        // Add basic entry even if schema fetch failed
                        resourceTypes[resourceType] = {
                            name: resourceType,
                            displayName: resourceType,
                            description: `Resource type: ${resourceType}`,
                            table: tableName,
                            properties: []
                        };
                    }
                } catch (error) {
                    console.warn(`    ❌ Error fetching schema for ${resourceType}: ${error.message}`);
                    
                    // Add basic entry for failed resource types
                    resourceTypes[resourceType] = {
                        name: resourceType,
                        displayName: resourceType,
                        description: `Resource type: ${resourceType}`,
                        table: tableName,
                        properties: []
                    };
                }
            }
        }

        console.log(`🎯 Successfully processed ${Object.keys(tables).length} tables and ${Object.keys(resourceTypes).length} resource types`);
        
        return { 
            tables, 
            resourceTypes, 
            resourceTypeProperties 
        };
    }

    /**
     * Fetch detailed schema for a specific resource type
     */
    async fetchResourceTypeSchema(bearerToken, category, resourceType, attempt = 1) {
        const requestOptions = {
            hostname: 'management.azure.com',
            port: 443,
            path: `/providers/microsoft.resourcegraph/resources/schema?action=GetSchema&category=${encodeURIComponent(category)}&resourceType=${encodeURIComponent(resourceType)}&api-version=2019-04-01`,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'en',
                'Authorization': `Bearer ${bearerToken}`,
                'x-ms-client-request-id': this.generateGuid(),
                'x-ms-command-name': 'bARGE.SchemaGenerator',
                'User-Agent': 'bARGE-SchemaGenerator/1.0'
            }
        };

        try {
            const responseData = await this.makeHttpsRequest(requestOptions);
            const schemaData = JSON.parse(responseData);
            
            // The response should be a JSON object with property definitions
            return this.parseResourceTypeProperties(schemaData);
            
        } catch (error) {
            if (attempt < this.maxRetries) {
                console.log(`    🔄 Retry ${attempt}/${this.maxRetries} for ${resourceType}: ${error.message}`);
                
                // Exponential backoff
                const delay = Math.min(this.baseRetryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
                await this.delay(delay);
                
                return this.fetchResourceTypeSchema(bearerToken, category, resourceType, attempt + 1);
            } else {
                throw error;
            }
        }
    }

    /**
     * Parse resource type properties from schema response
     */
    parseResourceTypeProperties(schemaData) {
        const properties = {};
        
        if (!schemaData || typeof schemaData !== 'object') {
            return properties;
        }

        // Recursively extract all property names from the schema
        this.extractPropertiesRecursive(schemaData, properties, '');
        
        return properties;
    }

    /**
     * Recursively extract property names and types from schema object
     */
    extractPropertiesRecursive(obj, properties, prefix = '') {
        if (!obj || typeof obj !== 'object') {
            return;
        }

        for (const [key, value] of Object.entries(obj)) {
            if (key === '`indexer`') {
                // Skip indexer properties as they're not real property names
                continue;
            }

            const fullKey = prefix ? `${prefix}.${key}` : key;
            
            if (typeof value === 'string') {
                // This is a property with a type
                properties[fullKey] = {
                    name: fullKey,
                    type: value,
                    description: `Property of type ${value}`
                };
            } else if (typeof value === 'object' && value !== null) {
                // This is a nested object, recurse into it
                this.extractPropertiesRecursive(value, properties, fullKey);
            }
        }
    }

    /**
     * Parse the Azure API schema response into our internal format
     * @deprecated - replaced by fetchDetailedSchemas
     */
    parseAzureSchemaResponse(schemaData) {
        console.log('📊 Parsing Azure schema response...');
        
        const tables = {};
        const resourceTypes = {};
        
        // The API returns table names as keys with arrays of resource types as values
        for (const [tableName, resourceTypeArray] of Object.entries(schemaData)) {
            console.log(`📋 Processing table: ${tableName} with ${resourceTypeArray.length} resource types`);
            
            // Create table entry
            tables[tableName.toLowerCase()] = {
                name: tableName,
                displayName: this.formatTableDisplayName(tableName),
                description: `${this.formatTableDisplayName(tableName)} table from Azure Resource Graph`,
                category: 'Azure Resource Graph',
                columns: {}, // Will be empty since API doesn't provide column details
                resourceTypes: resourceTypeArray,
                sampleQueries: []
            };

            // Process resource types for this table
            for (const resourceType of resourceTypeArray) {
                // Track resource types globally
                if (!resourceTypes[resourceType]) {
                    resourceTypes[resourceType] = {
                        name: resourceType,
                        displayName: resourceType,
                        description: `${resourceType} resource type`,
                        tables: []
                    };
                }
                resourceTypes[resourceType].tables.push(tableName.toLowerCase());
            }

            console.log(`  ✅ Processed table '${tableName}' with ${resourceTypeArray.length} resource types`);
        }

        console.log(`🎯 Successfully parsed ${Object.keys(tables).length} tables and ${Object.keys(resourceTypes).length} resource types`);
        return { tables, resourceTypes };
    }

    /**
     * Format table name for display (e.g., "advisorresources" -> "Advisor Resources")
     */
    formatTableDisplayName(tableName) {
        // Remove "resources" suffix and capitalize
        const baseName = tableName.replace(/resources$/i, '');
        return baseName.charAt(0).toUpperCase() + baseName.slice(1).replace(/([A-Z])/g, ' $1').trim() + ' Resources';
    }

    /**
     * Generate a GUID for request tracking
     */
    generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Make HTTPS request with proper error handling
     */
    makeHttpsRequest(options, postData = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve(data);
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.setTimeout(this.timeoutMs, () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.timeoutMs}ms`));
            });

            if (postData) {
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * Enhanced schema generation that can use either documentation or Azure API
     */
    async generateSchemaFromAPI(bearerToken) {
        console.log('🚀 Starting Azure API-based schema generation...');
        
        try {
            // Fetch schema from Azure API
            const apiResult = await this.fetchSchemaFromAzureAPI(bearerToken);
            
            if (apiResult) {
                // Merge API results into our schema
                this.schema.tables = { ...this.schema.tables, ...apiResult.tables };
                this.schema.resourceTypes = { ...this.schema.resourceTypes, ...apiResult.resourceTypes };
                
                // Store detailed properties for enhanced completions
                if (apiResult.resourceTypeProperties) {
                    this.schema.resourceTypeProperties = apiResult.resourceTypeProperties;
                }
                
                console.log(`✅ API-based schema generation completed with ${Object.keys(apiResult.tables).length} tables`);
                console.log(`📊 Schema summary:`);
                console.log(`   - ${Object.keys(this.schema.tables).length} tables`);
                console.log(`   - ${Object.keys(this.schema.resourceTypes).length} resource types`);
                if (this.schema.resourceTypeProperties) {
                    const totalProperties = Object.values(this.schema.resourceTypeProperties)
                        .reduce((sum, props) => sum + Object.keys(props).length, 0);
                    console.log(`   - ${totalProperties} detailed properties across all resource types`);
                }
                
                // Still fetch operators and functions from documentation since API doesn't provide them
                console.log('📚 Fetching operators and functions from documentation...');
                const queryDoc = await this.fetchUrl(
                    'https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language'
                );
                const operatorLinks = await this.extractOperatorLinks(queryDoc);
                await this.fetchOperatorDefinitions(operatorLinks);
                await this.extractFunctions(queryDoc);
                
                // Generate output files
                await this.writeSchemaFiles();
                
                console.log('✅ Schema generation completed successfully using Azure API!');
                return true;
            } else {
                console.log('⚠️ API-based generation failed, falling back to documentation parsing...');
                return false;
            }
        } catch (error) {
            console.error(`❌ Error in API-based schema generation: ${error.message}`);
            return false;
        }
    }
}

// Main execution
if (require.main === module) {
    const generator = new ARGSchemaGenerator();
    
    // Check if bearer token is provided as command line argument
    const bearerToken = process.argv[2];
    
    if (bearerToken && bearerToken.startsWith('Bearer ')) {
        console.log('🔑 Using provided bearer token for API-based generation...');
        generator.generateSchemaFromAPI(bearerToken.substring(7)).then(success => {
            if (!success) {
                console.log('🔄 Falling back to documentation-based generation...');
                generator.generateSchema().catch(console.error);
            }
        }).catch(console.error);
    } else if (bearerToken) {
        console.log('🔑 Using provided bearer token for API-based generation...');
        generator.generateSchemaFromAPI(bearerToken).then(success => {
            if (!success) {
                console.log('🔄 Falling back to documentation-based generation...');
                generator.generateSchema().catch(console.error);
            }
        }).catch(console.error);
    } else {
        console.log('📚 No bearer token provided, using documentation-based generation...');
        generator.generateSchema().catch(console.error);
    }
}

module.exports = ARGSchemaGenerator;
