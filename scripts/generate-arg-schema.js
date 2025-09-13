#!/usr/bin/env node

/**
 * Azure Resource Graph Schema Generator
 * 
 * Dynamically parses Resource Graph API and Microsoft Learn documentation to generate info for bARGE
 * Sources:
 * - @kusto/language-service-next - Get KQL keywords, operators, functions, aggregates
 * - Resource Graph API - Get all available tables and resource types
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language - Find information about resource tables
 * - https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category - Get sample queries for all tables
 * 
 * Usage:
 *   node generate-arg-schema.js                     # Full generation from documentation
 *   node generate-arg-schema.js <bearer-token>      # Full generation using Azure API
 *   node generate-arg-schema.js --examples-only     # Only refresh examples (faster)
 *   node generate-arg-schema.js -e                  # Short form for examples-only
 *   node generate-arg-schema.js --resources-only    # Only refresh resource tables and types
 *   node generate-arg-schema.js -r                  # Short form for resources-only  
 *   node generate-arg-schema.js --syntax-only       # Only refresh KQL syntax (operators, functions, aggregates)
 *   node generate-arg-schema.js -s                  # Short form for syntax-only
 *   node generate-arg-schema.js --help              # Show help
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');

// Function to clean markdown links and includes  
function cleanMarkdownLinks(text) {
    if (!text) {
        return '';
    }
    return text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove [text](url) links
        .replace(/>\s*!\s*INCLUDE\s+\[[^\]]+\]/g, '') // Remove > !INCLUDE [name] directives
        .replace(/!\s*INCLUDE\s+\[[^\]]+\]/g, '') // Remove !INCLUDE [name] directives
        .replace(/:heavy_check_mark:/g, '*True*') // Replace emoji with italicized True
        .replace(/\|(-{2,})/g, '|:$1') // Convert table alignment to left-aligned (add colon to start of any column with 2+ dashes)
        // Remove moniker ranges like "::: moniker range="..." ... ::: moniker-end"
        .replace(/::: moniker range="[^"]*"\s*[\s\S]*?::: moniker-end/g, '')
        // Remove image references like ":::image type="content" source="media/..." alt-text="...":::"
        .replace(/:::image[^:]*:::/g, '')
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Collapse multiple newlines
        .trim();
}

// Extract category from function title and apply sentence casing
function extractCategoryFromTitle(title) {
    // Look for patterns like "count() (aggregation function)" or "bin() (scalar function)"
    const match = title.match(/\(([^)]+)\)$/);
    if (match) {
        const category = match[1].trim();
        // Apply sentence casing: first letter uppercase, rest lowercase
        return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
    }
    return 'KQL function'; // Default fallback
}

// Clean title by removing category information in parentheses
function cleanFunctionTitle(title) {
    if (!title) {
        return title;
    }
    // Remove category information like "(aggregation function)" from the end
    // Also remove " - (preview)" from the end
    return title
        .replace(/\s*\([^)]+\)\s*$/, '')
        .replace(/\s+-\s*\(preview\)$/i, '')
        .replace(/\s*-\s*$/i, '')  // Remove trailing " -" after removing preview
        .trim();
}

function filterMicrosoftLearnNotes(text) {
    if (!text) {
        return text;
    }
    
    const lines = text.split('\n');
    const filteredLines = [];
    let inNoteBlock = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Check if this line starts a Microsoft Learn note block
        if (trimmed.startsWith('> [!')) {
            inNoteBlock = true;
            continue; // Skip this line
        }
        
        // Check if we're in a note block
        if (inNoteBlock) {
            // If the line starts with '>', it's still part of the note block
            if (trimmed.startsWith('>')) {
                continue; // Skip this line
            } else {
                // No longer in note block
                inNoteBlock = false;
                // Fall through to process this line normally
            }
        }
        
        // Keep the line if we're not in a note block
        if (!inNoteBlock) {
            filteredLines.push(line);
        }
    }
    
    return filteredLines.join('\n').trim();
}

// Focused documentation parser for Microsoft Docs
function parseMarkdownDoc(content) {
    const lines = content.split('\n');
    let title = '';
    let description = '';
    let syntax = '';
    let returnInfo = '';
    let parametersTable = '';
    let example = '';
    
    let currentSection = '';
    let descriptionLines = [];
    let syntaxLines = [];
    let returnLines = [];
    let parameterLines = [];
    let exampleLines = [];
    let foundIncludeLine = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Extract title (first h1)
        if (!title && trimmedLine.startsWith('# ')) {
            title = trimmedLine.substring(2).trim();
            continue;
        }
        
        // Skip until we find the INCLUDE line for description
        if (!foundIncludeLine && trimmedLine.includes('!INCLUDE')) {
            foundIncludeLine = true;
            continue;
        }
        
        // Detect sections by headers (any level #, ##, ###, etc.)
        if (trimmedLine.startsWith('#')) {
            const isH2 = trimmedLine.startsWith('## ') && !trimmedLine.startsWith('### ');
            
            if (isH2) {
                const header = trimmedLine.substring(3).toLowerCase();
                if (header.includes('syntax')) {
                    currentSection = 'syntax';
                    syntaxLines = [];
                } else if (header.includes('parameter')) {
                    currentSection = 'parameters';
                    parameterLines = [];
                } else if (header.includes('return') || header.includes('output')) {
                    currentSection = 'returns';
                    returnLines = [];
                } else if (header.includes('example')) {
                    currentSection = 'examples';
                    exampleLines = [];
                } else if (header.includes('related')) {
                    // Stop processing at "Related content" section
                    currentSection = 'stopped';
                } else {
                    // Any other section stops description collection
                    if (currentSection === '') {
                        currentSection = 'other';
                    }
                }
                
                // Don't continue here - we want to capture the section header for non-description sections
                if (currentSection !== 'other' && currentSection !== 'stopped') {
                    continue;
                }
            } else {
                // Any heading (h1, h3, h4, etc.) ends the current section
                // This is especially important for examples to stop at "# Related content"
                if (currentSection === 'examples' || currentSection === 'other') {
                    // Stop collecting for examples or other sections
                    currentSection = 'stopped';
                }
            }
        }
        
        // Collect content based on current section
        if (foundIncludeLine && currentSection === '' && !trimmedLine.startsWith('## ')) {
            // Description: everything after INCLUDE until first ## section
            descriptionLines.push(line);
        } else if (currentSection === 'syntax') {
            syntaxLines.push(line);
        } else if (currentSection === 'returns') {
            returnLines.push(line);
        } else if (currentSection === 'parameters') {
            parameterLines.push(line);
        } else if (currentSection === 'examples') {
            exampleLines.push(line);
        }
        // Stop collecting if we hit 'stopped' section
        if (currentSection === 'stopped') {
            continue;
        }
    }
    
    // Process all sections - preserve full content including formatting
    description = descriptionLines.join('\n').trim();
    syntax = syntaxLines.join('\n').trim();
    returnInfo = returnLines.join('\n').trim();
    parametersTable = parameterLines.join('\n').trim();
    
    // Filter out Microsoft Learn note blocks from description
    description = filterMicrosoftLearnNotes(description);
    
    // For examples, extract only kusto code blocks
    let processedExample = '';
    if (exampleLines.length > 0) {
        const exampleText = exampleLines.join('\n');
        const lines = exampleText.split('\n');
        let inKustoBlock = false;
        let kustoBlocks = [];
        let currentBlock = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '```kusto') {
                inKustoBlock = true;
                currentBlock = [];
            } else if (trimmed === '```' && inKustoBlock) {
                inKustoBlock = false;
                if (currentBlock.length > 0) {
                    kustoBlocks.push(currentBlock.join('\n'));
                }
                currentBlock = [];
            } else if (inKustoBlock) {
                currentBlock.push(line);
            }
        }
        
        processedExample = kustoBlocks.join('\n\n');
    }
    
    example = processedExample;
    
    // First, remove preview suffix from title if present
    let cleanedTitle = title;
    if (title) {
        cleanedTitle = title.replace(/\s+-\s*\(preview\)$/i, '').replace(/\s*-\s*$/i, '').trim();
    }
    
    // Extract category from cleaned title (without preview suffix)
    const extractedCategory = extractCategoryFromTitle(cleanedTitle);
    
    return {
        title: cleanMarkdownLinks(cleanFunctionTitle(cleanedTitle)),
        description: cleanMarkdownLinks(description),
        syntax: cleanMarkdownLinks(syntax),
        returnInfo: cleanMarkdownLinks(returnInfo),
        parametersTable: cleanMarkdownLinks(parametersTable),
        example: cleanMarkdownLinks(example),
        category: extractedCategory, // Include the extracted category
        sourceLength: content.length
    };
}

// Import Kusto Language Service for KQL language elements
let kustoLanguageService;
try {
    // Load Bridge.NET framework first (minified version for better performance)
    require('@kusto/language-service-next/bridge.min.js');
    // Then load the Kusto Language Service (minified version)
    kustoLanguageService = require('@kusto/language-service-next/Kusto.Language.Bridge.min.js');
    console.log('✅ Kusto Language Service loaded successfully');
} catch (error) {
    console.warn('⚠️ @kusto/language-service-next not available, operators/functions will be empty in TextMate grammar');
    console.warn('Error:', error.message);
    throw error;
}

class ARGSchemaGenerator {
    constructor() {
        this.schema = {
            tables: {},
            resourceTypes: {},
            // resourceTypeProperties: {}, // Detailed properties for each resource type - DISABLED: Creates 100MB+ of data
            keywords: [], // KQL keywords from Kusto Language Service
            operators: [], // KQL operators from Kusto Language Service
            functions: [], // KQL functions and aggregates from Kusto Language Service
            lastUpdated: new Date().toISOString()
        };
        this.sampleQueries = [];
        this.kustoBaseUrl = 'https://learn.microsoft.com';
        
        // Retry configuration
        this.maxRetries = 5;
        this.baseRetryDelay = 1000; // Start with 1 second
        this.maxRetryDelay = 10000; // Cap at 10 seconds
        this.timeoutMs = 10000; // 10 second timeout per request
        
        // Track functions without documentation
        this.unmatchedFunctions = [];
        this.unmatchedKeywords = [];
        this.unmatchedOperators = [];
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
            const requestOptions = {
                headers: {
                    'User-Agent': 'bARGE-SchemaGenerator/1.0 (+https://github.com/PalmEmanuel/bARGE)'
                }
            };
            
            const request = https.get(url, requestOptions, (res) => {
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http') 
                        ? res.headers.location 
                        : `${this.kustoBaseUrl}${res.headers.location}`;
                    console.log(`🔄 Redirecting to: ${redirectUrl}`);
                    resolve(this.makeHttpRequest(redirectUrl));
                    return;
                }
                
                // Handle rate limiting specifically for GitHub API
                if (res.statusCode === 403 && url.includes('api.github.com')) {
                    const resetTime = res.headers['x-ratelimit-reset'];
                    const rateLimitRemaining = res.headers['x-ratelimit-remaining'];
                    
                    if (rateLimitRemaining === '0' && resetTime) {
                        const resetDate = new Date(parseInt(resetTime) * 1000);
                        const waitTime = Math.max(resetDate.getTime() - Date.now(), 60000);
                        reject(new Error(`GitHub API rate limit exceeded. Reset at ${resetDate.toISOString()}. Wait ${Math.round(waitTime/1000)}s`));
                        return;
                    }
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

    async generateExamplesOnly() {
        console.log('📚 Examples-only mode: Loading existing schema and refreshing examples...');
        
        try {
            // Step 1: Load existing schema
            console.log('\n📂 Step 1: Loading existing schema files...');
            await this.loadExistingSchema();
            
            // Step 2: Fetch and match sample queries to tables
            console.log('\n📚 Step 2: Fetching sample queries...');
            await this.fetchAndMatchSampleQueries();
            
            // Step 3: Generate schema files with updated examples
            console.log('\n💾 Step 3: Writing updated schema files...');
            await this.writeSchemaFiles();
            
            console.log('\n✅ Examples refresh complete!');
            this.printSummary();
            
        } catch (error) {
            console.error('❌ Error refreshing examples:', error);
            throw error;
        }
    }

    async loadExistingSchema() {
        const fs = require('fs').promises;
        const outputDir = path.join(__dirname, '..', 'src', 'schema');
        const schemaPath = path.join(outputDir, 'arg-schema.json');
        
        try {
            console.log(`📂 Loading existing schema from: ${schemaPath}`);
            const schemaContent = await fs.readFile(schemaPath, 'utf8');
            this.schema = JSON.parse(schemaContent);
            
            // Ensure keywords, operators, and functions arrays exist (they might not in older schema files)
            if (!this.schema.keywords) {
                this.schema.keywords = [];
            }
            if (!this.schema.operators) {
                this.schema.operators = [];
            }
            if (!this.schema.functions) {
                this.schema.functions = [];
            }
            
            console.log(`✅ Loaded existing schema with:`);
            console.log(`   Tables: ${Object.keys(this.schema.tables).length}`);
            console.log(`   Resource Types: ${Object.keys(this.schema.resourceTypes).length}`);
            console.log(`   Keywords: ${this.schema.keywords.length}`);
            console.log(`   Operators: ${this.schema.operators.length}`);
            console.log(`   Functions: ${this.schema.functions.length} (includes aggregation functions)`);
            
        } catch (error) {
            console.error('❌ Failed to load existing schema:', error.message);
            console.log('💡 Hint: Run the full generation first to create the schema files');
            throw error;
        }
    }

    printSummary() {
        console.log('\n📊 Generation Summary:');
        console.log(`   Tables: ${Object.keys(this.schema.tables).length}`);
        console.log(`   Resource Types: ${Object.keys(this.schema.resourceTypes).length}`);
        console.log(`   Keywords: ${this.schema.keywords?.length || 0}`);
        console.log(`   Operators: ${this.schema.operators?.length || 0}`);
        console.log(`   Functions: ${this.schema.functions?.length || 0}`);
        
        // Report documentation coverage
        if (this.unmatchedFunctions.length > 0 || 
            this.unmatchedKeywords.length > 0 || this.unmatchedOperators.length > 0) {
            console.log('\n📝 Documentation Coverage:');
            if (this.unmatchedFunctions.length > 0) {
                console.log(`   Unmatched Functions (${this.unmatchedFunctions.length}): ${this.unmatchedFunctions.join(', ')}`);
            }
            if (this.unmatchedKeywords.length > 0) {
                console.log(`   Unmatched Keywords (${this.unmatchedKeywords.length}): ${this.unmatchedKeywords.join(', ')}`);
            }
            if (this.unmatchedOperators.length > 0) {
                console.log(`   Unmatched Operators (${this.unmatchedOperators.length}): ${this.unmatchedOperators.join(', ')}`);
            }
        }
    }

    async generateResourcesOnly() {
        console.log('🗂️ Resources-only mode: Loading existing schema and refreshing resource tables/types...');
        
        try {
            // Step 1: Load existing schema
            console.log('\n📂 Step 1: Loading existing schema files...');
            await this.loadExistingSchema();
            
            // Step 2: Fetch and parse tables and resource types
            console.log('\n🗂️ Step 2: Fetching resource tables and types...');
            const htmlContent = await this.fetchUrl('https://learn.microsoft.com/en-us/azure/governance/resource-graph/reference/supported-tables-resources');
            await this.parseTables(htmlContent);
            
            // Step 2.5: Fetch table descriptions
            console.log('\n📋 Step 2.5: Fetching table descriptions...');
            await this.fetchTableDescriptions();
            
            // Step 2.7: Fetch and match sample queries to tables
            console.log('\n📚 Step 2.7: Fetching sample queries...');
            await this.fetchAndMatchSampleQueries();
            
            // Step 3: Generate schema files with updated resources
            console.log('\n💾 Step 3: Writing updated schema files...');
            await this.writeSchemaFiles();
            
            console.log('\n✅ Resources refresh complete!');
            this.printSummary();
            
        } catch (error) {
            console.error('❌ Error refreshing resources:', error);
            throw error;
        }
    }

    async generateSyntaxOnly() {
        console.log('⚙️ Syntax-only mode: Loading existing schema and refreshing KQL syntax elements...');
        
        try {
            // Step 1: Load existing schema
            console.log('\n📂 Step 1: Loading existing schema files...');
            await this.loadExistingSchema();
            
            // Step 2: Extract KQL syntax elements from Kusto Language Service
            console.log('\n⚙️ Step 2: Extracting KQL syntax elements...');
            const kustoElements = this.extractKustoLanguageElements();
            this.schema.keywords = kustoElements.keywords.map(name => ({ name, category: 'KQL Keyword' }));
            this.schema.operators = kustoElements.operators.map(name => ({ name, category: 'KQL Operator' }));
            
            // Set up functions and merge aggregates into functions array
            this.schema.functions = [
                ...kustoElements.functions.map(name => ({ name, category: 'Function' })),
                ...kustoElements.aggregates.map(name => ({ name, category: 'Aggregation function' }))
            ];
            
            // Remove the separate aggregates section since they're now merged into functions
            delete this.schema.aggregates;
            
            // Step 3: Generate schema files with updated syntax and documentation
            console.log('\n💾 Step 3: Writing updated schema files...');
            await this.writeSchemaFiles(true); // Skip Kusto extraction since we just did it
            
            console.log('\n✅ Syntax refresh complete!');
            this.printSummary();
            
        } catch (error) {
            console.error('❌ Error refreshing syntax:', error);
            throw error;
        }
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
                
                // Extract resource types from the section (skip for main "resources" table)
                let resourceTypes = this.extractResourceTypes(sectionContent);
                
                // Preserve existing examples if table already exists
                const existingTable = this.schema.tables[tableName];
                const existingExamples = existingTable ? existingTable.examples || [] : [];
                const existingDescription = existingTable ? existingTable.description : undefined;
                
                const tableSchema = {
                    name: tableName,
                    examples: existingExamples
                };
                
                // Preserve existing description if it exists and we're not overwriting it
                if (existingDescription) {
                    tableSchema.description = existingDescription;
                }
                
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

    async fetchAndMatchSampleQueries() {
        console.log('📚 Fetching sample queries from Microsoft documentation...');
        
        try {
            // Use GitHub API to discover all sample files recursively
            console.log('📝 Discovering sample files from GitHub repository...');
            const sampleFiles = await this.discoverGitHubSampleFiles();
            
            console.log(`📝 Found ${sampleFiles.length} sample files, fetching KQL snippets...`);
            const allCodeSnippets = [];
            
            // Process files in parallel batches to avoid overwhelming the GitHub API
            const batchSize = 10; // Process 10 files at a time
            const batches = [];
            
            for (let i = 0; i < sampleFiles.length; i += batchSize) {
                batches.push(sampleFiles.slice(i, i + batchSize));
            }
            
            console.log(`🚀 Processing ${sampleFiles.length} files in ${batches.length} parallel batches of ${batchSize}...`);
            
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)...`);
                
                try {
                    // Process all files in this batch in parallel
                    const batchResults = await Promise.all(batch.map(async (file) => {
                        try {
                            console.log(`📥 Fetching: ${file.name}`);
                            const markdownContent = await this.fetchUrl(file.download_url);
                            const snippets = this.parseMarkdownCodeSnippets(markdownContent);
                            console.log(`  ✅ Found ${snippets.length} KQL snippets in ${file.name}`);
                            return snippets;
                        } catch (urlError) {
                            console.warn(`  ⚠️ Could not fetch ${file.name}: ${urlError.message}`);
                            return [];
                        }
                    }));
                    
                    // Flatten and add all snippets from this batch
                    for (const snippets of batchResults) {
                        allCodeSnippets.push(...snippets);
                    }
                } catch (batchError) {
                    console.warn(`⚠️ Error processing batch ${batchIndex + 1}: ${batchError.message}`);
                }
            }
            
            console.log(`📝 Total ${allCodeSnippets.length} KQL snippets found from all sample files`);
            console.log('🔗 Matching code snippets to tables...');
            this.matchSnippetsToTables(allCodeSnippets);
            
        } catch (error) {
            console.error('❌ Could not fetch sample queries:', error.message);
            console.log('📝 Tables will have no examples');
        }
    }

    /**
     * Recursively discover all sample files from GitHub repository
     */
    async discoverGitHubSampleFiles() {
        const sampleFiles = [];
        
        // Main directories to search for samples
        const searchPaths = [
            'articles/governance/resource-graph/includes/samples-by-category',
            'articles/governance/resource-graph/samples'
        ];
        
        for (const searchPath of searchPaths) {
            try {
                console.log(`🔍 Searching in: ${searchPath}`);
                const files = await this.getGitHubDirectoryContents(searchPath);
                sampleFiles.push(...files);
            } catch (error) {
                console.warn(`⚠️ Could not access ${searchPath}: ${error.message}`);
            }
        }
        
        return sampleFiles;
    }

    /**
     * Recursively get all markdown files from a GitHub directory
     */
    async getGitHubDirectoryContents(path) {
        const files = [];
        const apiUrl = `https://api.github.com/repos/MicrosoftDocs/azure-docs/contents/${path}`;
        
        try {
            const response = await this.fetchUrl(apiUrl);
            const items = JSON.parse(response);
            
            if (Array.isArray(items)) {
                for (const item of items) {
                    if (item.type === 'file' && item.name.endsWith('.md')) {
                        // This is a markdown file, add it to our list
                        files.push({
                            name: item.name,
                            path: item.path,
                            download_url: item.download_url
                        });
                        console.log(`  📄 Found sample file: ${item.name}`);
                    } else if (item.type === 'dir') {
                        // This is a directory, recursively search it
                        console.log(`  📁 Searching subdirectory: ${item.name}`);
                        const subFiles = await this.getGitHubDirectoryContents(item.path);
                        files.push(...subFiles);
                    }
                }
            }
        } catch (error) {
            console.warn(`⚠️ Failed to fetch directory contents for ${path}: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Fetch table descriptions from the query language documentation
     */
    async fetchTableDescriptions() {
        console.log('📋 Fetching table descriptions from query language documentation...');
        
        try {
            const apiUrl = 'https://api.github.com/repos/MicrosoftDocs/azure-docs/contents/articles/governance/resource-graph/concepts/query-language.md';
            const response = await this.fetchUrl(apiUrl);
            const fileInfo = JSON.parse(response);
            
            if (fileInfo.download_url) {
                console.log(`📥 Fetching: query-language.md`);
                const markdownContent = await this.fetchUrl(fileInfo.download_url);
                
                // Parse the table descriptions from the markdown
                const tableDescriptions = this.parseTableDescriptions(markdownContent);
                console.log(`📋 Found descriptions for ${Object.keys(tableDescriptions).length} tables`);
                
                // Add descriptions to existing tables
                for (const [tableName, description] of Object.entries(tableDescriptions)) {
                    const lowerTableName = tableName.toLowerCase();
                    if (this.schema.tables[lowerTableName]) {
                        this.schema.tables[lowerTableName].description = description;
                        console.log(`  ✅ Added description for ${tableName}: ${description.substring(0, 50)}...`);
                    }
                }
                
                return tableDescriptions;
            }
        } catch (error) {
            console.warn(`⚠️ Could not fetch table descriptions: ${error.message}`);
            return {};
        }
    }

    /**
     * Parse table descriptions from the query language markdown content
     */
    parseTableDescriptions(markdownContent) {
        const descriptions = {};
        
        // Look for the table section with format:
        // | TableName | Yes | Description |
        const tableRegex = /\|\s*([A-Za-z]+)\s*\|\s*Yes\s*\|\s*([^|]+)\s*\|/g;
        let match;
        
        while ((match = tableRegex.exec(markdownContent)) !== null) {
            const tableName = match[1].trim();
            const description = match[2].trim();
            
            // Clean up the description
            let cleanDescription = description
                .replace(/\.$/, '') // Remove trailing period
                .replace(/^Includes resources /, '') // Remove common prefix
                .replace(/_([^_]+)_/g, '$1') // Remove markdown italic formatting (_text_ -> text)
                .replace(/`([^`]+)`/g, '$1') // Remove markdown code formatting (`text` -> text)
                .trim();
            
            // Handle special cases and normalize the format
            if (cleanDescription.startsWith('Related to ')) {
                // Keep "Related to" descriptions as-is
                cleanDescription = cleanDescription;
            } else if (cleanDescription.startsWith('related to ')) {
                cleanDescription = cleanDescription.replace('related to ', 'Related to ');
            } else if (cleanDescription.includes('management group')) {
                // Keep the full description for ResourceContainers as it's more complex
                cleanDescription = cleanDescription;
            } else if (cleanDescription.includes('The default table')) {
                // Keep the full description for Resources table
                cleanDescription = cleanDescription;
            } else if (!cleanDescription.startsWith('Related to')) {
                // Add "Related to " prefix if it doesn't already have it
                cleanDescription = 'Related to ' + cleanDescription;
            }
            
            descriptions[tableName] = cleanDescription;
        }
        
        return descriptions;
    }

    parseMarkdownCodeSnippets(markdownContent) {
        console.log('🔍 Extracting KQL code snippets from markdown...');
        const allExamples = [];
        
        // Collect all examples with their source type - single pass through content
        
        // 1. Pure KQL/Kusto code blocks (highest priority)
        const kqlBlockPattern = /```\s*(?:kql|kusto)\s*\n(.*?)\n```/gs;
        let match;
        while ((match = kqlBlockPattern.exec(markdownContent)) !== null) {
            const rawCode = match[1];
            const cleanCode = this.cleanCodeSnippet(rawCode);
            
            if (cleanCode && this.isKQLQuery(cleanCode)) {
                allExamples.push({
                    code: cleanCode,
                    source: 'kql',
                    priority: 1
                });
            }
        }
        
        // 2. Azure CLI code blocks (medium priority)
        const azCliPattern = /```\s*azurecli(?:-interactive)?\s*\n(.*?)\n```/gs;
        while ((match = azCliPattern.exec(markdownContent)) !== null) {
            const cliCode = match[1];
            const kqlMatch = cliCode.match(/az\s+graph\s+query\s+(?:-q|--query)\s+"([^"]+)"/s);
            if (kqlMatch) {
                let kqlCode = kqlMatch[1].trim();
                // For CLI examples, remove shell escaping of dollar signs
                // Handle both single and double backslash escaping
                kqlCode = kqlCode.replace(/\\\\(\$)/g, '$1');  // Handle \\$ → $
                kqlCode = kqlCode.replace(/\\(\$)/g, '$1');     // Handle \$ → $
                const cleanCode = this.cleanCodeSnippet(kqlCode);
                
                if (cleanCode && this.isKQLQuery(cleanCode)) {
                    // Format with newlines before pipes for CLI examples
                    const formattedCode = this.formatKQLWithPipeNewlines(cleanCode);
                    allExamples.push({
                        code: formattedCode,
                        source: 'cli',
                        priority: 2
                    });
                }
            }
        }
        
        // 3. Azure PowerShell code blocks (lower priority)
        const azPowerShellPattern = /```\s*azurepowershell(?:-interactive)?\s*\n(.*?)\n```/gs;
        while ((match = azPowerShellPattern.exec(markdownContent)) !== null) {
            const psCode = match[1];
            const kqlMatch = psCode.match(/Search-AzGraph\s+(?:-Query)\s+"([^"]+)"/s);
            if (kqlMatch) {
                const kqlCode = kqlMatch[1].trim();
                const cleanCode = this.cleanCodeSnippet(kqlCode);
                
                if (cleanCode && this.isKQLQuery(cleanCode)) {
                    // Format with newlines before pipes for PowerShell examples
                    const formattedCode = this.formatKQLWithPipeNewlines(cleanCode);
                    allExamples.push({
                        code: formattedCode,
                        source: 'powershell',
                        priority: 3
                    });
                }
            }
        }
        
        // 4. Generic code blocks (lowest priority - fallback)
        const genericBlockPattern = /```\s*\n(.*?)\n```/gs;
        while ((match = genericBlockPattern.exec(markdownContent)) !== null) {
            const rawCode = match[1];
            const cleanCode = this.cleanCodeSnippet(rawCode);
            
            if (cleanCode && this.isKQLQuery(cleanCode)) {
                allExamples.push({
                    code: cleanCode,
                    source: 'generic',
                    priority: 4
                });
            }
        }
        
        // Process by priority: KQL first, then CLI, then PowerShell, then generic
        // Within each category, sort by length (shortest first)
        const codeSnippets = [];
        const sourceTypes = ['kql', 'cli', 'powershell', 'generic'];
        
        for (const sourceType of sourceTypes) {
            const examplesOfType = allExamples.filter(ex => ex.source === sourceType);
            
            // Sort by length (shortest first) within each category
            examplesOfType.sort((a, b) => a.code.length - b.code.length);
            
            for (const example of examplesOfType) {
                // Only add if we don't already have this exact snippet
                if (!codeSnippets.some(existing => existing.code.trim() === example.code.trim())) {
                    codeSnippets.push({
                        code: example.code,
                        source: example.source,
                        length: example.code.length
                    });
                    console.log(`  ✅ Found KQL from ${sourceType} (${example.code.length} chars): ${example.code.substring(0, 50)}...`);
                }
            }
        }
        
        console.log(`📝 Extracted ${codeSnippets.length} unique KQL code snippets from markdown (${allExamples.length} total found)`);
        
        return codeSnippets;
    }

    parseCodeSnippets(htmlContent) {
        console.log('🔍 Extracting KQL code snippets...');
        const codeSnippets = [];
        
        // Look for code blocks in various formats used by Microsoft Learn
        const codeBlockPatterns = [
            // Pattern 1: Standard markdown code blocks
            /```\s*(?:kql|kusto)?\s*(.*?)```/gs,
            // Pattern 2: HTML pre/code blocks with language classes
            /<(?:pre|code)[^>]*class="[^"]*(?:lang-kql|lang-kusto|highlight)[^"]*"[^>]*>(.*?)<\/(?:pre|code)>/gs,
            // Pattern 3: Microsoft Learn code blocks
            /<code[^>]*data-lang="(?:kql|kusto)"[^>]*>(.*?)<\/code>/gs,
            // Pattern 4: Div-based code blocks
            /<div[^>]*class="[^"]*(?:code|highlight)[^"]*"[^>]*>.*?<code[^>]*>(.*?)<\/code>.*?<\/div>/gs,
            // Pattern 5: Any pre/code block (broader catch)
            /<(?:pre|code)[^>]*>(.*?)<\/(?:pre|code)>/gs,
            // Pattern 6: Script tag code blocks (sometimes used for syntax highlighting)
            /<script[^>]*type="application\/json"[^>]*data-lang="(?:kql|kusto)"[^>]*>(.*?)<\/script>/gs
        ];
        
        for (const pattern of codeBlockPatterns) {
            let match;
            while ((match = pattern.exec(htmlContent)) !== null) {
                const rawCode = match[1];
                const cleanCode = this.cleanCodeSnippet(rawCode);
                
                if (cleanCode && this.isKQLQuery(cleanCode)) {
                    // Avoid duplicates
                    if (!codeSnippets.some(existing => existing.trim() === cleanCode.trim())) {
                        codeSnippets.push(cleanCode);
                        console.log(`  ✅ Found KQL snippet (${cleanCode.length} chars): ${cleanCode.substring(0, 50)}...`);
                    }
                }
            }
        }
        
        // Remove duplicates
        const uniqueSnippets = [...new Set(codeSnippets)];
        console.log(`📝 Extracted ${uniqueSnippets.length} unique KQL code snippets`);
        
        return uniqueSnippets;
    }

    formatKQLWithPipeNewlines(kqlCode) {
        // Add newlines before pipes for better formatting in CLI/PowerShell examples
        // Only add newlines if the query doesn't already have them
        if (kqlCode.includes('\n|')) {
            return kqlCode; // Already formatted
        }
        
        return kqlCode.replace(/\s*\|\s*/g, '\n| ');
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
        
        // Remove common markdown artifacts and formatting
        cleaned = cleaned
            .replace(/^[\s\n\r]*[-]+[\s\n\r]*$/gm, '') // Remove horizontal rules
            .replace(/^\s*\*\s+/gm, '') // Remove bullet points
            .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered lists
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold formatting
            .replace(/\*(.*?)\*/g, '$1') // Remove italic formatting
            .replace(/`([^`]+)`/g, '$1') // Remove inline code formatting
            .replace(/^\s*>\s+/gm, '') // Remove blockquotes
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        
        // Remove excessive whitespace but preserve KQL structure
        cleaned = cleaned
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim();
        
        // If the result is just whitespace or very short, return null
        if (!cleaned || cleaned.length < 10) {
            return null;
        }
        
        return cleaned;
    }

    isKQLQuery(code) {
        if (!code || typeof code !== 'string') { 
            return false; 
        }
        
        // Remove comments and whitespace for analysis
        const cleanCode = code.replace(/\/\/.*$/gm, '').trim();
        if (cleanCode.length < 10) { // Increase minimum length
            return false;
        }
        
        // Check for obvious non-KQL content first
        const isNotKQL = /\b(curl|wget|http:\/\/|https:\/\/|<html|<script|SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET)\b/i.test(cleanCode) ||
            // Check for portal tab headers and markdown formatting
            /^#\s*\[.*\]\(#tab\/.*\)/.test(cleanCode) ||
            /^#\s*\[.*Portal.*\]/.test(cleanCode) ||
            /^#\s*\[.*Azure CLI.*\]/.test(cleanCode) ||
            /^#\s*\[.*PowerShell.*\]/.test(cleanCode) ||
            // Check for pure markdown content
            /^[\s\n\r-]*$/.test(cleanCode) ||
            // Check for documentation text patterns
            /^(Try this query|Azure portal:|By default,|For more information)/.test(cleanCode);
        
        if (isNotKQL) {
            return false;
        }
        
        // Check for KQL characteristics
        const hasTableNames = Object.keys(this.schema.tables).some(table => {
            // Escape regex metacharacters in table names
            const escapedTable = table.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
            return new RegExp(`\\b${escapedTable}\\b`, 'i').test(cleanCode);
        });
        
        const hasOperators = this.schema.operators.length > 0 ? 
            this.schema.operators.some(op => {
                // Escape regex metacharacters in operator names
                const escapedOpName = op.name.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
                return new RegExp(`\\b${escapedOpName}\\b`, 'i').test(cleanCode);
            }) : false;
        
        const hasPipeOperator = cleanCode.includes('|');
        
        // Check for common KQL operators even if not yet in schema
        const hasCommonKQLOperators = /\b(where|project|extend|summarize|join|union|sort|take|limit|count|distinct)\b/i.test(cleanCode);
        
        // A snippet is likely KQL if it has table names or common operators, and preferably pipe operator
        return (hasTableNames || hasCommonKQLOperators) && (hasPipeOperator || hasOperators);
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
            
            // Collect all potential examples for this table, organized by source type
            const potentialExamples = {
                kql: [],
                cli: [],
                powershell: [],
                generic: []
            };
            
            // Categorize snippets by source type and relevance
            for (const snippet of codeSnippets) {
                if (matchedSnippets.has(snippet.code)) {
                    continue;
                }
                
                // Check if snippet is relevant to this table
                if (this.snippetStartsWithTable(snippet.code, tableName) || this.isSnippetForTable(snippet.code, tableName)) {
                    potentialExamples[snippet.source].push({
                        code: snippet.code,
                        length: snippet.length,
                        startsWithTable: this.snippetStartsWithTable(snippet.code, tableName)
                    });
                }
            }
            
            // Sort each category by length (shortest first), with "starts with table" having priority
            Object.keys(potentialExamples).forEach(sourceType => {
                potentialExamples[sourceType].sort((a, b) => {
                    // First, prioritize snippets that start with the table name
                    if (a.startsWithTable && !b.startsWithTable) { return -1; }
                    if (!a.startsWithTable && b.startsWithTable) { return 1; }
                    // Then sort by length (shortest first)
                    return a.length - b.length;
                });
            });
            
            // Collect ALL examples for this table (no limit - we'll randomly pick during hover)
            const tableExamples = [];
            
            // Collect examples in priority order: KQL first, then CLI, PowerShell, generic
            const sourceTypes = ['kql', 'cli', 'powershell', 'generic'];
            for (const sourceType of sourceTypes) {
                for (const example of potentialExamples[sourceType]) {
                    // Only add if we don't already have this exact snippet OR same length (to avoid duplicates)
                    if (!tableExamples.some(existing => 
                        existing.code.trim() === example.code.trim() || 
                        existing.length === example.length
                    )) {
                        tableExamples.push({
                            code: example.code,
                            source: sourceType,
                            length: example.length,
                            startsWithTable: example.startsWithTable
                        });
                        matchedSnippets.add(example.code);
                    }
                }
            }
            
            // Update the table with all examples
            if (tableExamples.length > 0) {
                this.schema.tables[tableKey].examples = tableExamples;
                totalMatches += tableExamples.length;
                
                // Show breakdown of all examples by source
                const sourceBreakdown = {};
                tableExamples.forEach(ex => {
                    if (!sourceBreakdown[ex.source]) {
                        sourceBreakdown[ex.source] = 0;
                    }
                    sourceBreakdown[ex.source]++;
                });
                
                const breakdown = Object.entries(sourceBreakdown)
                    .map(([source, count]) => `${source}:${count}`)
                    .join(', ');
                console.log(`  ✅ ${tableName}: ${tableExamples.length} example(s) [${breakdown}]`);
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
        
        // Escape regex metacharacters in table name
        const escapedTableName = lowerTableName.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
        
        // Pattern: TableName followed by whitespace or pipe
        const startsWithPattern = new RegExp(`^${escapedTableName}\\s*[\\|\\s]`, 'i');
        return startsWithPattern.test(trimmedSnippet);
    }

    isSnippetForTable(snippet, tableName) {
        // Convert to lowercase for case-insensitive matching
        const lowerSnippet = snippet.toLowerCase();
        const lowerTableName = tableName.toLowerCase();
        
        // Escape regex metacharacters in table name
        const escapedTableName = lowerTableName.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
        
        // For exact table name matches, ensure it's not part of a longer table name
        // Look for the table name as a standalone word in FROM clause or pipe context
        const exactTablePatterns = [
            new RegExp(`\\bfrom\\s+${escapedTableName}\\b`, 'i'),
            new RegExp(`\\|\\s*${escapedTableName}\\s*\\|`, 'i'),
            new RegExp(`\\|\\s*${escapedTableName}\\s*$`, 'i')
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
                const escapedLongerTable = longerTable.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
                const longerTablePattern = new RegExp(`\\b${escapedLongerTable}\\b`, 'i');
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
               name.toLowerCase().includes('resources') &&
               name.toLowerCase() !== 'resource'; // Exclude the "resource" (singular) table that shows up in API
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

    async writeSchemaFiles(skipKustoExtraction = false) {
        const outputDir = path.join(__dirname, '..', 'src', 'schema');
        
        try {
            await fs.mkdir(outputDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        // Extract KQL language elements from Kusto Language Service before writing
        // Skip this if already done by the calling method
        if (!skipKustoExtraction) {
            try {
                const kustoElements = this.extractKustoLanguageElements();
                this.schema.keywords = kustoElements.keywords.map(name => ({ name, category: 'KQL Keyword' }));
                this.schema.operators = kustoElements.operators.map(name => ({ name, category: 'KQL Operator' }));
                
                // Set up functions and merge aggregates into functions array
                this.schema.functions = [
                    ...kustoElements.functions.map(name => ({ name, category: 'Function' })),
                    ...kustoElements.aggregates.map(name => ({ name, category: 'Aggregation function' }))
                ];
                
                // Remove the separate aggregates section since they're now merged into functions
                delete this.schema.aggregates;
                
            } catch (error) {
                console.warn('⚠️ Could not extract Kusto language elements:', error.message);
                this.schema.keywords = [];
                this.schema.operators = [];
                this.schema.functions = [];
            }
        }

        // Extract enhanced documentation for functions (including aggregates)
        try {
            await this.extractMicrosoftDocsDocumentation();
        } catch (error) {
            console.warn('⚠️ Could not extract Microsoft Docs documentation:', error.message);
        }

        // Write complete schema
        await fs.writeFile(
            path.join(outputDir, 'arg-schema.json'),
            JSON.stringify(this.schema, null, 2)
        );

        // Write TextMate grammar
        await this.generateTextMateGrammar();

        console.log(`📁 Schema files written to: ${outputDir}`);
    }

    async extractMicrosoftDocsDocumentation() {
        const kqlDocsUrl = 'https://api.github.com/repos/MicrosoftDocs/dataexplorer-docs/contents/data-explorer/kusto/query';
        console.log('\n🔍 Extracting KQL documentation from Microsoft Docs...');
        
        try {
            const allFiles = await this.fetchGitHubDirectoryContents(kqlDocsUrl);
            
            // Filter function files
            const functionFiles = allFiles.filter(file => 
                file.name.endsWith('-function.md') || 
                file.name.endsWith('-aggregate-function.md') ||
                file.name.endsWith('-aggregation-function.md')
            );

            // Filter operator files
            const operatorFiles = allFiles.filter(file => 
                file.name.endsWith('-operator.md')
            );

            console.log(`📄 Found ${functionFiles.length} function documentation files`);
            console.log(`📄 Found ${operatorFiles.length} operator documentation files`);

            // Process functions and aggregates in parallel
            const functionResults = await Promise.all(functionFiles.map(async (file) => {
                const fileContent = await this.fetchGitHubFileContent(file.download_url);
                const functionDoc = this.parseMarkdownDoc(fileContent, file.name);
                
                return { file: file.name, doc: functionDoc };
            }));

            // Process operators in parallel
            const operatorResults = await Promise.all(operatorFiles.map(async (file) => {
                const fileContent = await this.fetchGitHubFileContent(file.download_url);
                const operatorDoc = this.parseOperatorMarkdownDoc(fileContent, file.name);
                
                return { file: file.name, doc: operatorDoc };
            }));

            // Separate functions from aggregates (only include successfully parsed ones)
            const functionsDocumented = functionResults.filter(result => result.doc && result.doc.type === 'function').map(result => result.doc);
            const aggregatesDocumented = functionResults.filter(result => result.doc && result.doc.type === 'aggregate').map(result => result.doc);
            
            // Get documented operators (only include successfully parsed ones)
            const operatorsDocumented = operatorResults.filter(result => result.doc).map(result => result.doc);

            console.log(`\n� Documentation extraction results:`);
            console.log(`  • Functions documented: ${functionsDocumented.length}`);
            console.log(`  • Aggregates documented: ${aggregatesDocumented.length}`);
            console.log(`  • Operators documented: ${operatorsDocumented.length}`);

            // Process operators first to migrate keywords to operators
            await this.processOperatorDocumentation(operatorsDocumented);

            // Then process functions and aggregates
            await this.processFunctionDocumentation(functionsDocumented, aggregatesDocumented);

        } catch (error) {
            console.error('❌ Error extracting Microsoft Docs documentation:', error.message);
        }
    }

    async fetchGitHubDirectoryContents(url) {
        const response = await this.fetchUrl(url);
        return JSON.parse(response);
    }

    async fetchGitHubFileContent(url) {
        return await this.fetchUrl(url);
    }

    parseMarkdownDoc(content, filename) {
        // Extract function name from filename
        const nameMatch = filename.match(/^(.+?)(?:-(function|aggregate-function|aggregation-function))\.md$/);
        if (!nameMatch) {
            return null;
        }
        
        const functionName = nameMatch[1].replace(/-/g, '_');
        
        // Determine type from filename
        const isAggregate = filename.includes('aggregate') || filename.includes('aggregation');
        const type = isAggregate ? 'aggregate' : 'function';
        
        // Use the original parseMarkdownDoc function to get structured data
        const parsedDoc = parseMarkdownDoc(content);
        
        // Add Microsoft Learn URL
        const urlSlug = filename.replace(/\.md$/, '');
        const microsoftLearnUrl = `https://learn.microsoft.com/en-us/kusto/query/${urlSlug}`;
        
        return {
            name: functionName,
            type: type,
            category: parsedDoc.category || (isAggregate ? 'KQL aggregate function' : 'KQL function'),
            documentation: {
                ...parsedDoc,
                url: microsoftLearnUrl
            }
        };
    }

    parseOperatorMarkdownDoc(content, filename) {
        // Extract operator name from filename
        const nameMatch = filename.match(/^(.+?)-operator\.md$/);
        if (!nameMatch) {
            return null;
        }

        const operatorName = nameMatch[1].replace(/-/g, '_');

        // Use the original parseMarkdownDoc function to get structured data
        const parsedDoc = parseMarkdownDoc(content);
        
        // Trim " operator" from the title for cleaner display
        if (parsedDoc.title && parsedDoc.title.toLowerCase().endsWith(' operator')) {
            parsedDoc.title = parsedDoc.title.slice(0, -9).trim(); // Remove " operator" (9 characters)
        }
        
        // Add Microsoft Learn URL
        const urlSlug = filename.replace(/\.md$/, '');
        const microsoftLearnUrl = `https://learn.microsoft.com/en-us/kusto/query/${urlSlug}`;
        
        return {
            name: operatorName,
            type: 'operator',
            category: 'operator',
            documentation: {
                ...parsedDoc,
                url: microsoftLearnUrl
            }
        };
    }

    async processOperatorDocumentation(operatorsDocumented) {
        console.log(`\n🔗 Processing operator documentation...`);
        
        let matchedOperators = 0;
        const matchedOperatorsList = [];
        const documentedOperatorNames = operatorsDocumented.map(op => op.name.toLowerCase());

        for (const docOperator of operatorsDocumented) {
            // Create variations for better matching (handle hyphens/underscores and not-/! mappings)
            const docOperatorVariations = [
                docOperator.name,
                docOperator.name.toLowerCase(),
                docOperator.name.replace(/_/g, '-'),
                docOperator.name.replace(/_/g, '-').toLowerCase(),
                docOperator.name.replace(/-/g, '_'),
                docOperator.name.replace(/-/g, '_').toLowerCase()
            ];
            
            // Add "not-" to "!" mapping - if doc name starts with "not-", also try with "!"
            if (docOperator.name.toLowerCase().startsWith('not-')) {
                const exclamationVersion = '!' + docOperator.name.substring(4); // Remove "not-" and add "!"
                docOperatorVariations.push(
                    exclamationVersion,
                    exclamationVersion.toLowerCase()
                );
                
                // Also try "notcontains" style (remove hyphen)
                const notVersion = 'not' + docOperator.name.substring(4); // Remove "not-" and add "not"
                docOperatorVariations.push(
                    notVersion,
                    notVersion.toLowerCase()
                );
            }
            
            // Special case: "take" documentation should also match "limit" keyword
            if (docOperator.name.toLowerCase() === 'take') {
                docOperatorVariations.push(
                    'limit',
                    'limit'
                );
            }
            
            // Track which items receive documentation from this doc (allow multiple matches)
            let documentationApplied = false;
            
            // Check if this operator exists in our current operators list
            let foundInOperators = this.schema.operators.filter(op => {
                const opVariations = [
                    op.name,
                    op.name.toLowerCase(),
                    op.name.replace(/_/g, '-'),
                    op.name.replace(/_/g, '-').toLowerCase(),
                    op.name.replace(/-/g, '_'),
                    op.name.replace(/-/g, '_').toLowerCase()
                ];
                
                // Create temporary variations for matching:
                // If operator starts with "!", create "not-" version
                if (op.name.toLowerCase().startsWith('!')) {
                    const notDashVersion = 'not-' + op.name.substring(1);
                    opVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
                    );
                }
                
                // If operator starts with "not" but not "not-" or "not_", create "not-" version
                if (op.name.toLowerCase().startsWith('not') && 
                    !op.name.toLowerCase().startsWith('not-') && 
                    !op.name.toLowerCase().startsWith('not_')) {
                    // Insert dash after "not": notcontains -> not-contains
                    const notDashVersion = 'not-' + op.name.substring(3);
                    opVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
                    );
                }
                
                return docOperatorVariations.some(docVar => opVariations.includes(docVar));
            });

            // Check if this operator exists in our keywords list (that could also receive documentation)
            let foundInKeywords = this.schema.keywords.filter(kw => {
                const keywordName = typeof kw === 'object' ? kw.name : kw;
                const keywordVariations = [
                    keywordName,
                    keywordName.toLowerCase(),
                    keywordName.replace(/_/g, '-'),
                    keywordName.replace(/_/g, '-').toLowerCase(),
                    keywordName.replace(/-/g, '_'),
                    keywordName.replace(/-/g, '_').toLowerCase()
                ];
                
                // Create temporary variations for matching:
                // If keyword starts with "!", create "not-" version
                if (keywordName.toLowerCase().startsWith('!')) {
                    const notDashVersion = 'not-' + keywordName.substring(1);
                    const notUnderscoreVersion = 'not_' + keywordName.substring(1);
                    keywordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase(),
                        notUnderscoreVersion,
                        notUnderscoreVersion.toLowerCase()
                    );
                }
                
                // If keyword starts with "not" but not "not-" or "not_", create "not-" version
                if (keywordName.toLowerCase().startsWith('not') && 
                    !keywordName.toLowerCase().startsWith('not-') && 
                    !keywordName.toLowerCase().startsWith('not_')) {
                    // Insert dash after "not": notcontains -> not-contains
                    const notDashVersion = 'not-' + keywordName.substring(3);
                    const notUnderscoreVersion = 'not_' + keywordName.substring(3);
                    keywordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase(),
                        notUnderscoreVersion,
                        notUnderscoreVersion.toLowerCase()
                    );
                }
                
                return docOperatorVariations.some(docVar => keywordVariations.includes(docVar));
            });

            // Apply documentation to all matching operators
            for (const matchedOperator of foundInOperators) {
                // Update existing operator with documentation
                const cleanedDocumentation = { ...docOperator.documentation };
                // Remove the inner category from documentation to avoid conflicts  
                if (cleanedDocumentation.category) {
                    delete cleanedDocumentation.category;
                }
                
                matchedOperator.documentation = cleanedDocumentation;
                matchedOperator.category = 'operator'; // Fix: always use 'operator'
                matchedOperatorsList.push(matchedOperator);
                documentationApplied = true;
            }
            
            // Apply documentation to matching keywords 
            // For operators found in keywords: migrate them to operators section with documentation
            for (const matchedKeyword of foundInKeywords) {
                const keywordName = typeof matchedKeyword === 'object' ? matchedKeyword.name : matchedKeyword;
                
                // Check if this keyword is actually an operator by checking if we have documentation for it as an operator
                // This is much more reliable than hardcoded lists
                const isOperator = docOperator.type === 'operator' || docOperator.category === 'operator';
                
                if (isOperator) {
                    // This is an operator misplaced in keywords - migrate it to operators
                    const newOperator = {
                        name: keywordName,
                        category: 'operator',
                        documentation: { ...docOperator.documentation }
                    };
                    
                    // Remove the inner category from documentation to avoid conflicts
                    if (newOperator.documentation && newOperator.documentation.category) {
                        delete newOperator.documentation.category;
                    }
                    
                    // Add to operators list
                    matchedOperatorsList.push(newOperator);
                    
                    // Remove from keywords
                    this.schema.keywords = this.schema.keywords.filter(kw => {
                        const kwName = typeof kw === 'object' ? kw.name : kw;
                        return kwName !== keywordName;
                    });
                    
                    documentationApplied = true;
                } else {
                    // This is actually a keyword, just add documentation
                    const keywordInSchema = this.schema.keywords.find(kw => {
                        const kwName = typeof kw === 'object' ? kw.name : kw;
                        return kwName === keywordName;
                    });
                    
                    if (keywordInSchema) {
                        // Convert keyword to object if it's a string and add documentation
                        if (typeof keywordInSchema === 'string') {
                            const keywordIndex = this.schema.keywords.indexOf(keywordInSchema);
                            this.schema.keywords[keywordIndex] = {
                                name: keywordInSchema,
                                category: 'KQL Keyword',
                                documentation: docOperator.documentation
                            };
                        } else {
                            keywordInSchema.documentation = docOperator.documentation;
                        }
                        documentationApplied = true;
                    }
                }
            }
            
            if (documentationApplied) {
                matchedOperators++;
            } else {
                // This is a new operator not in our lists
                const cleanedDocumentation = { ...docOperator.documentation };
                // Remove the inner category from documentation to avoid conflicts
                if (cleanedDocumentation.category) {
                    delete cleanedDocumentation.category;
                }
                
                const newOperator = {
                    name: docOperator.name,
                    category: 'operator', // Fix: always use 'operator'
                    documentation: cleanedDocumentation
                };
                matchedOperatorsList.push(newOperator);
                matchedOperators++;
            }
        }

        // Add existing operators that didn't get documentation and track unmatched
        for (const op of this.schema.operators) {
            const matchedOp = matchedOperatorsList.find(matched => matched.name === op.name);
            if (!matchedOp) {
                // Check if this operator has documentation available
                const hasDocumentation = documentedOperatorNames.includes(op.name.toLowerCase());
                if (hasDocumentation) {
                    // This should have matched but didn't - likely a naming mismatch
                    matchedOperatorsList.push(op);
                } else {
                    // No documentation available for this operator
                    matchedOperatorsList.push(op);
                    this.unmatchedOperators.push(op.name);
                }
            }
        }

        // Update schema with documented operators
        this.schema.operators = matchedOperatorsList;

        console.log(`  • Operators documented: ${matchedOperators}`);
        if (this.unmatchedOperators.length > 0) {
            console.log(`  • Unmatched operators: ${this.unmatchedOperators.join(', ')}`);
        }
    }

    async processFunctionDocumentation(functionsDocumented, aggregatesDocumented) {
        console.log(`\n🔗 Processing function documentation...`);
        
        // Combine both function and aggregate documentation arrays
        const allDocumentedFunctions = [...functionsDocumented, ...aggregatesDocumented];
        
        // Match with schema functions (including aggregates) and track unmatched
        let matchedFunctions = 0;
        const matchedFunctionsList = [];

        // Collect unmatched functions to preserve them in schema
        const unmatchedFunctionsList = [];
        for (const func of this.schema.functions) {
            const docFunction = allDocumentedFunctions.find(doc => 
                doc.name === func.name || 
                doc.name === func.name.toLowerCase() ||
                func.name === doc.name.toLowerCase()
            );
            
            if (docFunction) {
                func.documentation = docFunction.documentation;
                func.category = docFunction.category;
                matchedFunctionsList.push(func);
                matchedFunctions++;
            } else {
                // Keep unmatched functions but without documentation
                unmatchedFunctionsList.push(func);
                this.unmatchedFunctions.push(func.name);
            }
        }

        // Update schema to include both matched and unmatched functions
        this.schema.functions = [...matchedFunctionsList, ...unmatchedFunctionsList];

        const totalFunctions = matchedFunctions + this.unmatchedFunctions.length;

        console.log(`  • Functions matched: ${matchedFunctions}/${totalFunctions} (includes aggregation functions, ${this.unmatchedFunctions.length} excluded from schema)`);
        
        // Track remaining keywords that don't have documentation
        for (const keyword of this.schema.keywords) {
            if (typeof keyword === 'object' && keyword.name) {
                // This keyword didn't get migrated to operators and has no documentation
                this.unmatchedKeywords.push(keyword.name);
            } else if (typeof keyword === 'string') {
                // Simple string keyword
                this.unmatchedKeywords.push(keyword);
            }
        }
        
        if (this.unmatchedFunctions.length > 0) {
            console.log(`  • Unmatched functions: ${this.unmatchedFunctions.join(', ')}`);
        }
    }

    extractCategoryFromTitle(content) {
        // Extract the first H1 title from the markdown
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (!titleMatch) {
            return null;
        }
        
        const title = titleMatch[1].trim();
        
        // Look for category patterns in the title
        const categoryPatterns = [
            /(.+?)\s+function$/i,
            /(.+?)\s+aggregate\s*function$/i,
            /(.+?)\s+aggregation\s*function$/i,
            /(.+?)\s+operator$/i
        ];
        
        for (const pattern of categoryPatterns) {
            const match = title.match(pattern);
            if (match) {
                // Convert to sentence case (first letter uppercase, rest lowercase)
                const category = match[1].trim();
                return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
            }
        }
        
        return null;
    }

    cleanFunctionTitle(title) {
        // Remove category suffixes from titles
        return title
            .replace(/\s+function$/i, '')
            .replace(/\s+aggregate\s*function$/i, '')
            .replace(/\s+aggregation\s*function$/i, '')
            .replace(/\s+operator$/i, '')
            .replace(/\s+-\s*\(preview\)$/i, '')  // Remove " - (preview)" from the end
            .replace(/\s*-\s*$/i, '')  // Remove trailing " -" after removing preview
            .trim();
    }

    cleanMarkdownLinks(content) {
        if (!content) {
            return '';
        }
        
        return content
            // Remove moniker ranges
            .replace(/:::moniker\s+range="[^"]*":::\s*/g, '')
            .replace(/:::moniker-end:::\s*/g, '')
            
            // Convert markdown links to plain text, preserving the link text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            
            // Remove reference-style links
            .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
            
            // Clean up table alignment (dynamic replacement for any number of dashes)
            .replace(/^\|[\s\-:]*\|$/gm, '')
            
            // Remove extra whitespace and empty lines
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    }


    /**
     * Generate enhanced table completions with descriptions and examples
     */
    generateTableCompletions() {
        return Object.keys(this.schema.tables).map(name => {
            const table = this.schema.tables[name];
            const completion = {
                label: name,
                kind: 'Table',
                insertText: name,
                detail: `Table - ${table.description || 'Azure Resource Graph table'}`,
                sortText: `1_${name}` // Tables get higher priority
            };

            // Add documentation if available
            if (table.description || table.resourceTypes?.length || table.examples?.length) {
                const docs = [];
                
                if (table.description) {
                    docs.push(table.description);
                }
                
                if (table.resourceTypes?.length) {
                    docs.push(`**Resource Types:**\n${table.resourceTypes.slice(0, 5).map(rt => `- ${rt}`).join('\n')}${table.resourceTypes.length > 5 ? `\n- ... and ${table.resourceTypes.length - 5} more` : ''}`);
                }
                
                if (table.examples?.length) {
                    const example = table.examples[0];
                    if (example.code && example.code.length < 200) {
                        docs.push(`**Example:**\n\`\`\`kql\n${example.code}\n\`\`\``);
                    } else if (example.code) {
                        docs.push(`**Example:**\n\`\`\`kql\n${example.code.substring(0, 150)}...\n\`\`\``);
                    }
                }
                
                if (docs.length > 0) {
                    completion.documentation = {
                        kind: 'markdown',
                        value: docs.join('\n\n')
                    };
                }
            }

            return completion;
        });
    }

    /**
     * Generate enhanced keyword completions
     */
    generateKeywordCompletions() {
        return this.schema.keywords.map(kw => ({
            label: kw.name,
            kind: 'Keyword',
            insertText: kw.name,
            detail: `Keyword - ${kw.category || 'KQL keyword'}`,
            sortText: `2_${kw.name}`, // Lower priority than tables
            filterText: kw.name,
            documentation: kw.documentation ? {
                kind: 'markdown',
                value: kw.documentation.description || `${kw.category} keyword`
            } : undefined
        }));
    }

    /**
     * Generate enhanced operator completions
     */
    generateOperatorCompletions() {
        return this.schema.operators.map(op => ({
            label: op.name,
            kind: 'Operator',
            insertText: op.name,
            detail: `Operator - ${op.category || 'KQL operator'}`,
            sortText: `3_${op.name}`, // Lower priority than keywords
            filterText: op.name,
            documentation: op.documentation ? {
                kind: 'markdown',
                value: this.formatOperatorDocumentation(op.documentation)
            } : undefined
        }));
    }

    /**
     * Generate enhanced function completions with parameter placeholders
     */
    generateFunctionCompletions() {
        return this.schema.functions.map(fn => {
            const completion = {
                label: fn.name,
                kind: 'Function',
                detail: `Function - ${fn.category || 'KQL function'}`,
                sortText: this.getFunctionSortText(fn),
                filterText: fn.name
            };

            // Generate smart insertText with parameter placeholders
            completion.insertText = this.generateFunctionInsertText(fn);

            // Add rich documentation if available
            if (fn.documentation) {
                completion.documentation = {
                    kind: 'markdown',
                    value: this.formatFunctionDocumentation(fn.documentation)
                };
                
                // Update detail with function signature if available
                if (fn.documentation.syntax) {
                    completion.detail = `Function - ${fn.documentation.syntax}`;
                }
            }

            return completion;
        });
    }

    /**
     * Generate enhanced resource type completions
     */
    generateResourceTypeCompletions() {
        return Object.keys(this.schema.resourceTypes).map(type => ({
            label: type,
            kind: 'Value',
            insertText: `'${type}'`,
            detail: `Resource Type - ${type.split('/')[0]}`,
            sortText: `4_${type}`, // Lowest priority
            filterText: type.replace(/[/.]/g, ' '), // Allow searching by parts
            documentation: {
                kind: 'markdown',
                value: `Azure resource type: \`${type}\``
            }
        }));
    }

    /**
     * Generate function insertText with parameter placeholders
     */
    generateFunctionInsertText(fn) {
        if (!fn.documentation?.parametersTable) {
            return `${fn.name}($1)$0`; // Simple placeholder if no parameter info
        }

        // Parse parameters from table
        const params = this.parseParametersFromTable(fn.documentation.parametersTable);
        
        if (params.length === 0) {
            return `${fn.name}()$0`;
        }

        // Generate snippet with parameter placeholders
        const paramPlaceholders = params.map((param, index) => {
            const placeholder = `\${${index + 1}:${param.name}}`;
            return param.required ? placeholder : `\${${index + 1}:${param.name}?}`;
        }).join(', ');

        return `${fn.name}(${paramPlaceholders})$0`;
    }

    /**
     * Parse parameters from documentation table
     */
    parseParametersFromTable(parametersTable) {
        if (!parametersTable) {
            return [];
        }

        const params = [];
        const lines = parametersTable.split('\n');
        
        for (const line of lines) {
            const match = line.match(/\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
            if (match && !match[1].trim().toLowerCase().includes('name')) {
                const name = match[1].trim().replace(/[*`]/g, '');
                const type = match[2].trim();
                const required = match[3].trim().toLowerCase().includes('true');
                
                if (name && name !== '--') {
                    params.push({ name, type, required });
                }
            }
        }
        
        return params;
    }

    /**
     * Generate sort text for functions based on category and usage patterns
     */
    getFunctionSortText(fn) {
        // Prioritize commonly used functions
        const commonFunctions = ['count', 'where', 'project', 'summarize', 'extend', 'limit', 'take', 'sort', 'order', 'join'];
        
        if (commonFunctions.includes(fn.name)) {
            return `2_${fn.name}`; // High priority, same as keywords
        }
        
        // Categorize by function type
        const categoryPriority = {
            'Aggregation function': '3_',
            'Scalar function': '4_',
            'Tabular function': '3_',
            'Window function': '4_'
        };
        
        const prefix = categoryPriority[fn.category] || '5_';
        return `${prefix}${fn.name}`;
    }

    /**
     * Format function documentation for display
     */
    formatFunctionDocumentation(doc) {
        const parts = [];
        
        if (doc.description) {
            parts.push(doc.description);
        }
        
        if (doc.syntax) {
            parts.push(`**Syntax:**\n\`\`\`kql\n${doc.syntax}\n\`\`\``);
        }
        
        if (doc.parametersTable) {
            parts.push(`**Parameters:**\n${doc.parametersTable}`);
        }
        
        if (doc.returnInfo) {
            parts.push(`**Returns:** ${doc.returnInfo}`);
        }
        
        if (doc.example) {
            parts.push(`**Example:**\n\`\`\`kql\n${doc.example}\n\`\`\``);
        }
        
        if (doc.url) {
            parts.push(`[📖 More info](${doc.url})`);
        }
        
        return parts.join('\n\n');
    }

    /**
     * Format operator documentation for display
     */
    formatOperatorDocumentation(doc) {
        const parts = [];
        
        if (doc.description) {
            parts.push(doc.description);
        }
        
        if (doc.syntax) {
            parts.push(`**Syntax:**\n\`\`\`kql\n${doc.syntax}\n\`\`\``);
        }
        
        if (doc.example) {
            parts.push(`**Example:**\n\`\`\`kql\n${doc.example}\n\`\`\``);
        }
        
        if (doc.url) {
            parts.push(`[📖 More info](${doc.url})`);
        }
        
        return parts.join('\n\n');
    }

    /**
     * Generate property completions from detailed schema data
     * DISABLED: Detailed properties create 100MB+ of data, focusing on core functionality for now
     */
    generatePropertyCompletions() {
        const properties = [];
        const allPropertyNames = new Set();
        
        // Add properties from detailed schema if available - DISABLED
        /* 
        if (this.schema.resourceTypeProperties) {
            for (const [resourceType, resourceProps] of Object.entries(this.schema.resourceTypeProperties)) {
                for (const [propName, propInfo] of Object.entries(resourceProps)) {
                    if (!allPropertyNames.has(propName)) {
                        properties.push({
                            label: propName,
                            kind: 'Property',
                            insertText: propName,
                            resourceType: resourceType
                        });
                        allPropertyNames.add(propName);
                    }
                }
            }
        } else {
        */
            // Fallback: extract properties from basic resource type info
            for (const [resourceType, resourceInfo] of Object.entries(this.schema.resourceTypes)) {
                if (resourceInfo.properties && Array.isArray(resourceInfo.properties)) {
                    resourceInfo.properties.forEach(propName => {
                        if (!allPropertyNames.has(propName)) {
                            properties.push({
                                label: propName,
                                kind: 'Property',
                                insertText: propName,
                                resourceType: resourceType
                            });
                            allPropertyNames.add(propName);
                        }
                    });
                }
            }
        // }

        console.log(`📝 Generated ${properties.length} property completions`);
        return properties;
    }

    extractKustoLanguageElements() {
        console.log('🔧 Extracting KQL language elements from @kusto/language-service-next...');
        
        const operators = new Set();
        const keywords = new Set();
        const functions = new Set();
        const aggregates = new Set();
        let filteredKeywords = new Set();
        let filteredOperators = new Set();
        
        if (!kustoLanguageService) {
            throw new Error('Kusto Language Service not available');
        }
        
        try {
            // Initialize Bridge.NET framework first
            require('@kusto/language-service-next/bridge.min.js');
            
            // Access the global Kusto Language API
            const kustoLanguage = global.Kusto.Language;

            // Extract operators and keywords from SyntaxKind enum with dynamic symbol mapping
            if (kustoLanguage.Syntax && kustoLanguage.Syntax.SyntaxKind && kustoLanguage.Syntax.SyntaxFacts) {
                const syntaxKind = kustoLanguage.Syntax.SyntaxKind;
                const syntaxFacts = kustoLanguage.Syntax.SyntaxFacts;
                
                // Extract operators and keywords by using SyntaxFacts methods
                for (const [tokenName, tokenValue] of Object.entries(syntaxKind)) {
                    if (typeof tokenValue === 'number') {
                        try {
                            // Use SyntaxFacts.GetText to get the actual symbol/text for this token
                            const tokenText = syntaxFacts.GetText(tokenValue);
                            if (tokenText && tokenText.trim()) {
                                // Use SyntaxFacts methods to properly categorize
                                const isKeyword = syntaxFacts.IsKeyword && syntaxFacts.IsKeyword(tokenValue);
                                const isOperator = syntaxFacts.IsOperator && syntaxFacts.IsOperator(tokenValue);
                                
                                if (isKeyword) {
                                    keywords.add(tokenText);
                                } else if (isOperator) {
                                    operators.add(tokenText);
                                } else if (tokenName.endsWith('Token') || tokenName.endsWith('Keyword')) {
                                    // Fallback for tokens that might not be properly categorized
                                    if (tokenName.includes('Keyword')) {
                                        keywords.add(tokenText);
                                    } else {
                                        operators.add(tokenText);
                                    }
                                }
                            }
                        } catch (error) {
                            // Some tokens might not have text representation, skip them
                        }
                    }
                }
            }
            
            // Extract functions from Kusto.Language.Functions.All
            if (kustoLanguage.Functions && kustoLanguage.Functions.All) {
                const functionList = kustoLanguage.Functions.All;
                functionList.forEach(fn => {
                    const name = fn.name || fn.Name;
                    if (name && !name.startsWith('__')) {
                        // Exclude internal double underscore functions not available in ARG
                        functions.add(name);
                    }
                });
            }
            
            // Extract aggregates from Kusto.Language.Aggregates.All
            if (kustoLanguage.Aggregates && kustoLanguage.Aggregates.All) {
                const aggregateList = kustoLanguage.Aggregates.All;
                aggregateList.forEach(agg => {
                    const name = agg.name || agg.Name;
                    if (name && !name.startsWith('__')) {
                        // Exclude internal double underscore aggregates not available in ARG
                        aggregates.add(name);
                    }
                });
            }
            
            // Filter out symbolic keywords and operators (keep only word-based items)
            filteredKeywords = new Set();
            filteredOperators = new Set();
            const isSymbolic = (item) => {
                // Check if item contains only symbols/punctuation and no letters
                return /^[^a-zA-Z]*$/.test(item) && /[^\w\s]/.test(item);
            };
            
            for (const keyword of keywords) {
                if (!isSymbolic(keyword)) {
                    filteredKeywords.add(keyword);
                }
            }
            
            for (const operator of operators) {
                if (!isSymbolic(operator)) {
                    filteredOperators.add(operator);
                }
            }
            
            const filteredKeywordCount = keywords.size - filteredKeywords.size;
            const filteredOperatorCount = operators.size - filteredOperators.size;
            console.log(`🔧 Extracted ${filteredKeywords.size} keywords, ${filteredOperators.size} operators, ${functions.size} functions, and ${aggregates.size} aggregates from Kusto Language Service`);
            if (filteredKeywordCount > 0 || filteredOperatorCount > 0) {
                console.log(`   • Filtered out ${filteredKeywordCount} symbolic keywords and ${filteredOperatorCount} symbolic operators`);
            }
            
        } catch (error) {
            console.error('❌ Error extracting from Kusto Language Service:', error.message);
            throw error;
        }
        
        return {
            keywords: Array.from(filteredKeywords).sort(),
            operators: Array.from(filteredOperators).sort(),
            functions: Array.from(functions).sort(),
            aggregates: Array.from(aggregates).sort()
        };
    }

    async generateTextMateGrammar() {
        const syntaxDir = path.join(__dirname, '..', 'syntaxes');
        
        try {
            await fs.mkdir(syntaxDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        console.log('🎨 Generating dynamic TextMate grammar...');

        // Extract KQL language elements from Kusto Language Service
        const kustoElements = this.extractKustoLanguageElements();
        
        // Override with our schema classifications for better accuracy
        const schemaOperatorNames = new Set(this.schema.operators.map(op => op.name.toLowerCase()));
        const schemaKeywordNames = new Set();
        
        // Build schema keywords set
        for (const keyword of this.schema.keywords) {
            const keywordName = typeof keyword === 'object' ? keyword.name : keyword;
            schemaKeywordNames.add(keywordName.toLowerCase());
        }
        
        // Use schema-based classification, fall back to Kusto Language Service
        const keywords = [];
        const operators = [];
        
        // Add all elements from Kusto Language Service, but classify based on our schema
        const allKustoElements = new Set([...kustoElements.keywords, ...kustoElements.operators]);
        
        for (const element of allKustoElements) {
            const lowerElement = element.toLowerCase();
            if (schemaOperatorNames.has(lowerElement)) {
                operators.push(element);
            } else if (schemaKeywordNames.has(lowerElement)) {
                keywords.push(element);
            } else {
                // Fallback to original Kusto classification
                if (kustoElements.operators.includes(element)) {
                    operators.push(element);
                } else {
                    keywords.push(element);
                }
            }
        }
        
        // Add any schema operators not found in Kusto elements
        for (const op of this.schema.operators) {
            if (!operators.includes(op.name) && !operators.includes(op.name.toLowerCase())) {
                operators.push(op.name);
            }
        }
        
        // Escape regex metacharacters in keywords for safe regex usage
        const escapedKeywords = keywords.map(kw => {
            // Escape regex special characters: \ ^ $ . | ? * + ( ) [ ] { }
            return kw.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
        });
        const keywordsPattern = escapedKeywords.join('|');
        
        // Escape regex metacharacters in operators for safe regex usage
        const escapedOperators = operators.map(op => {
            // Escape regex special characters: \ ^ $ . | ? * + ( ) [ ] { } !
            return op.replace(/[\\^$.|?*+(){}\[\]!]/g, '\\$&');
        });
        const operatorsPattern = escapedOperators.join('|');
        
        const allFunctions = [...kustoElements.functions, ...kustoElements.aggregates];
        const allFunctionsSet = new Set(allFunctions.map(f => f.toLowerCase()));
        const allKeywordsSet = new Set(keywords.map(k => k.toLowerCase()));
        const allOperatorsSet = new Set(operators.map(o => o.toLowerCase()));
        
        // Separate ambiguous functions from pure functions
        const pureKeywords = keywords.filter(kw => !allFunctionsSet.has(kw.toLowerCase()));
        const pureOperators = operators.filter(op => !allFunctionsSet.has(op.toLowerCase()));
        const pureFunctions = allFunctions.filter(func => {
            const lowerFunc = func.toLowerCase();
            return !allKeywordsSet.has(lowerFunc) && !allOperatorsSet.has(lowerFunc);
        });
        
        // Use pureFunctions for all function patterns to avoid conflicts with operators
        const allFunctionsPattern = allFunctions.join('|');
        const pureKeywordsPattern = pureKeywords.map(kw => kw.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureOperatorsPattern = pureOperators.map(op => op.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureFunctionsPattern = pureFunctions.join('|');
        
        const tables = Object.keys(this.schema.tables).filter(name => name).join('|');
        
        // Extract common properties from schema data only
        const allProperties = new Set();
        
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
                { "include": "#function_calls" },
                { "include": "#keywords" },
                { "include": "#operators" },
                { "include": "#functions" },
                { "include": "#tables" },
                { "include": "#properties" },
                { "include": "#join_references" },
                { "include": "#columns" },
                { "include": "#strings" },
                { "include": "#numbers" }
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
                "function_calls": {
                    "patterns": [
                        {
                            "name": "support.function.builtin.kql",
                            "match": `(?i)\\b(${allFunctionsPattern})(?=\\s*\\()`
                        }
                    ]
                },
                "keywords": {
                    "patterns": [
                        {
                            "name": "keyword.other.kql",
                            "match": `(?i)\\b(${pureKeywordsPattern})\\b`
                        }
                    ]
                },
                "operators": {
                    "patterns": [
                        {
                            "name": "keyword.control.kql",
                            "match": `(?i)(?<!\\w)(${operatorsPattern})(?!\\w)`
                        }
                    ]
                },
                "functions": {
                    "patterns": [
                        {
                            "name": "support.function.builtin.kql",
                            "match": `(?i)\\b(${pureFunctionsPattern})\\b`
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
                "join_references": {
                    "patterns": [
                        {
                            "name": "variable.other.join-reference.kql",
                            "match": "(?i)\\$?(left|right)\\b"
                        }
                    ]
                },
                "strings": {
                    "patterns": [
                        {
                            "name": "string.quoted.verbatim.kql",
                            "begin": "@\"",
                            "end": "\"",
                            "patterns": [
                                {
                                    "name": "constant.character.escape.kql",
                                    "match": "\"\""
                                }
                            ]
                        },
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
                "columns": {
                    "patterns": [
                        {
                            "name": "variable.other.column.assignment.kql",
                            "match": "(?i)(?<!\\.)\\b\\w+(?=\\s*=|\\s*\\.)"
                        },
                        {
                            "name": "variable.other.column.first.kql",
                            "match": `(?i)(?<=\\b(?:${operatorsPattern}|${keywordsPattern})\\s+)(?<!\\.)\\w+(?=\\s*[,|\\.]|\\s*$)`
                        },
                        {
                            "name": "variable.other.column.between.kql",
                            "match": `(?i)(?<=\\b(?:${operatorsPattern}|${keywordsPattern})\\s+)(?<!\\.)\\w+(?=\\s+(?:${operatorsPattern}|${keywordsPattern})\\b|\\s*\\.)`
                        },
                        {
                            "name": "variable.other.column.after.paren.kql",
                            "match": `(?i)(?<=\\(\\s*)(?<!\\.)\\w+(?=\\s+(?:${operatorsPattern}|${keywordsPattern})\\b|\\s*\\.)`
                        },
                        {
                            "name": "variable.other.column.function.kql",
                            "match": "(?i)(?<=\\()\\s*(?<!\\.)\\w+(?=\\s*[,)\\.])"
                        },
                        {
                            "name": "variable.other.column.function.kql",
                            "match": "(?i)(?<=,\\s*)(?<!\\.)\\w+(?=\\s*[,)\\.])"
                        },
                        {
                            "name": "variable.other.column.kql",
                            "match": "(?i)(?<=,\\s*)(?<!\\.)\\w+(?=\\s*[,|\\.]|\\s*$)"
                        }
                    ]
                },
                "properties": {
                    "patterns": [
                        {
                            "name": "meta.other.property.kql",
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
        console.log(`   - ${kustoElements.keywords.length} keywords`);
        console.log(`   - ${kustoElements.operators.length} operators`);
        console.log(`   - ${kustoElements.functions.length} functions`);
        console.log(`   - ${kustoElements.aggregates.length} aggregates`);
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
        // const resourceTypeProperties = {}; // Store detailed properties for each resource type - DISABLED: Creates 100MB+ of data
        
        // Process each table category
        for (const [tableName, resourceTypeArray] of Object.entries(categoriesData)) {
            console.log(`📋 Processing table: ${tableName} (${resourceTypeArray.length} resource types)`);
            
            // Initialize table
            tables[tableName] = {
                name: tableName,
                resourceTypes: resourceTypeArray,
                examples: []
            };

            // Process each resource type in this table
            for (const resourceType of resourceTypeArray) {
                console.log(`  � Adding resource type: ${resourceType}`);
                
                // Add basic resource type info without fetching detailed properties
                // Detailed property fetching disabled to reduce bundle size from 100MB+ to manageable size
                resourceTypes[resourceType] = {
                    name: resourceType,
                    table: tableName,
                    properties: [] // Empty for now - could be populated from documentation if needed
                };
                
                /* DISABLED: Detailed property fetching - Creates 100MB+ of data
                console.log(`  �🔍 Fetching schema for: ${resourceType}`);
                
                try {
                    // Add delay between requests to avoid rate limiting
                    await this.delay(this.requestDelay);
                    
                    const resourceSchema = await this.fetchResourceTypeSchema(bearerToken, tableName, resourceType);
                    
                    if (resourceSchema) {
                        // Store basic resource type info
                        resourceTypes[resourceType] = {
                            name: resourceType,
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
                            table: tableName,
                            properties: []
                        };
                    }
                } catch (error) {
                    console.warn(`    ❌ Error fetching schema for ${resourceType}: ${error.message}`);
                    
                    // Add basic entry for failed resource types
                    resourceTypes[resourceType] = {
                        name: resourceType,
                        table: tableName,
                        properties: []
                    };
                }
                */
            }
        }

        console.log(`🎯 Successfully processed ${Object.keys(tables).length} tables and ${Object.keys(resourceTypes).length} resource types`);
        
        return { 
            tables, 
            resourceTypes
            // resourceTypeProperties  // DISABLED: Creates 100MB+ of data
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
                
                // Store detailed properties for enhanced completions - DISABLED: Creates 100MB+ of data
                // if (apiResult.resourceTypeProperties) {
                //     this.schema.resourceTypeProperties = apiResult.resourceTypeProperties;
                // }
                
                // Step 2: Fetch table descriptions
                console.log('📋 Step 2: Fetching table descriptions...');
                await this.fetchTableDescriptions();
                
                // Step 3: Fetch examples from GitHub
                console.log('📚 Step 3: Fetching examples from GitHub...');
                await this.fetchAndMatchSampleQueries();
                
                console.log(`✅ API-based schema generation completed with ${Object.keys(apiResult.tables).length} tables`);
                console.log(`📊 Schema summary:`);
                console.log(`   - ${Object.keys(this.schema.tables).length} tables`);
                console.log(`   - ${Object.keys(this.schema.resourceTypes).length} resource types`);
                // Detailed properties disabled to reduce bundle size
                // if (this.schema.resourceTypeProperties) {
                //     const totalProperties = Object.values(this.schema.resourceTypeProperties)
                //         .reduce((sum, props) => sum + Object.keys(props).length, 0);
                //     console.log(`   - ${totalProperties} detailed properties across all resource types`);
                // }
                
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
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const examplesOnly = args.includes('--examples-only') || args.includes('-e');
    const resourcesOnly = args.includes('--resources-only') || args.includes('-r');
    const syntaxOnly = args.includes('--syntax-only') || args.includes('-s');
    const showHelp = args.includes('--help') || args.includes('-h');
    const bearerToken = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));
    
    if (showHelp) {
        console.log(`
Azure Resource Graph Schema Generator

Usage:
  node generate-arg-schema.js                     # Full generation from documentation
  node generate-arg-schema.js <bearer-token>      # Full generation using Azure API
  node generate-arg-schema.js --examples-only     # Only refresh examples (faster)
  node generate-arg-schema.js -e                  # Short form for examples-only
  node generate-arg-schema.js --resources-only    # Only refresh resource tables and types
  node generate-arg-schema.js -r                  # Short form for resources-only  
  node generate-arg-schema.js --syntax-only       # Only refresh KQL syntax (operators, functions, aggregates)
  node generate-arg-schema.js -s                  # Short form for syntax-only
  node generate-arg-schema.js --help              # Show this help

Options:
  --examples-only, -e    Load existing schema and only refresh examples
  --resources-only, -r   Load existing schema and only refresh resource tables/types
  --syntax-only, -s      Load existing schema and only refresh KQL syntax elements
  --help, -h            Show this help message

Examples:
  node generate-arg-schema.js --examples-only
  node generate-arg-schema.js --resources-only
  node generate-arg-schema.js --syntax-only
  node generate-arg-schema.js eyJ0eXAiOiJKV1QiLCJhbGc...
        `);
    } else if (examplesOnly) {
        console.log('📚 Examples-only mode: Loading existing schema and refreshing examples...');
        generator.generateExamplesOnly().catch(console.error);
    } else if (resourcesOnly) {
        console.log('🗂️ Resources-only mode: Loading existing schema and refreshing resource tables/types...');
        generator.generateResourcesOnly().catch(console.error);
    } else if (syntaxOnly) {
        console.log('⚙️ Syntax-only mode: Loading existing schema and refreshing KQL syntax elements...');
        generator.generateSyntaxOnly().catch(console.error);
    } else if (bearerToken && bearerToken.startsWith('Bearer ')) {
        console.log('🔑 Using provided bearer token for API-based generation...');
        generator.generateSchemaFromAPI(bearerToken.substring(7)).then(success => {
            if (!success) {
                throw new Error('API-based schema generation failed.');
            }
        }).catch(console.error);
    } else if (bearerToken) {
        console.log('🔑 Using provided bearer token for API-based generation...');
        generator.generateSchemaFromAPI(bearerToken).then(success => {
            if (!success) {
                throw new Error('API-based schema generation failed.');
            }
        }).catch(console.error);
    } else {
        throw new Error('API-based generation requires a valid bearer token. Use --help for usage details.');
    }
}

module.exports = ARGSchemaGenerator;
