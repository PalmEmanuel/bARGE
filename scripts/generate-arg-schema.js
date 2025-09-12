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
    if (!text) return '';
    return text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove [text](url) links
        .replace(/>\s*!\s*INCLUDE\s+\[[^\]]+\]/g, '') // Remove > !INCLUDE [name] directives
        .replace(/!\s*INCLUDE\s+\[[^\]]+\]/g, '') // Remove !INCLUDE [name] directives
        .replace(/:heavy_check_mark:/g, '*True*') // Replace emoji with italicized True
        .replace(/\|(-{2,})/g, '|:$1') // Convert table alignment to left-aligned (add colon to start of any column with 2+ dashes)
        // Remove moniker ranges like "::: moniker range="..." ... ::: moniker-end"
        .replace(/::: moniker range="[^"]*"\s*[\s\S]*?::: moniker-end/g, '')
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
                } else if (header.includes('parameter') || header.includes('argument')) {
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
}

class ARGSchemaGenerator {
    constructor() {
        this.schema = {
            tables: {},
            resourceTypes: {},
            // resourceTypeProperties: {}, // Detailed properties for each resource type - DISABLED: Creates 100MB+ of data
            keywords: [], // KQL keywords from Kusto Language Service
            operators: [], // KQL operators from Kusto Language Service
            functions: [], // KQL functions from Kusto Language Service
            aggregates: [], // KQL aggregate functions from Kusto Language Service
            lastUpdated: new Date().toISOString()
        };
        this.sampleQueries = [];
        this.kustoBaseUrl = 'https://learn.microsoft.com';
        this.requestDelay = 2000; // Increase delay to 2 seconds to be more respectful of GitHub API
        
        // Retry configuration
        this.maxRetries = 5;
        this.baseRetryDelay = 1000; // Start with 1 second
        this.maxRetryDelay = 10000; // Cap at 10 seconds
        this.timeoutMs = 10000; // 10 second timeout per request
        
        // Track functions without documentation
        this.unmatchedFunctions = [];
        this.unmatchedAggregates = [];
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
            
            // Ensure keywords, operators, functions, and aggregates arrays exist (they might not in older schema files)
            if (!this.schema.keywords) {
                this.schema.keywords = [];
            }
            if (!this.schema.operators) {
                this.schema.operators = [];
            }
            if (!this.schema.functions) {
                this.schema.functions = [];
            }
            if (!this.schema.aggregates) {
                this.schema.aggregates = [];
            }
            
            console.log(`✅ Loaded existing schema with:`);
            console.log(`   Tables: ${Object.keys(this.schema.tables).length}`);
            console.log(`   Resource Types: ${Object.keys(this.schema.resourceTypes).length}`);
            console.log(`   Keywords: ${this.schema.keywords.length}`);
            console.log(`   Operators: ${this.schema.operators.length}`);
            console.log(`   Functions: ${this.schema.functions.length}`);
            console.log(`   Aggregates: ${this.schema.aggregates.length}`);
            
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
        console.log(`   Aggregates: ${this.schema.aggregates?.length || 0}`);
        
        // Report documentation coverage
        if (this.unmatchedFunctions.length > 0 || this.unmatchedAggregates.length > 0) {
            console.log('\n📝 Documentation Coverage:');
            if (this.unmatchedFunctions.length > 0) {
                console.log(`   Unmatched Functions (${this.unmatchedFunctions.length}): ${this.unmatchedFunctions.join(', ')}`);
            }
            if (this.unmatchedAggregates.length > 0) {
                console.log(`   Unmatched Aggregates (${this.unmatchedAggregates.length}): ${this.unmatchedAggregates.join(', ')}`);
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
            await this.extractKustoLanguageElements();
            
            // Step 3: Generate schema files with updated syntax
            console.log('\n💾 Step 3: Writing updated schema files...');
            await this.writeSchemaFiles();
            
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
            return '\nMost Resource Manager resource types and properties are here. [View sample queries](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/starter).';
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

    async fetchAndMatchSampleQueries() {
        console.log('📚 Fetching sample queries from Microsoft documentation...');
        
        try {
            // Use GitHub API to discover all sample files recursively
            console.log('📝 Discovering sample files from GitHub repository...');
            const sampleFiles = await this.discoverGitHubSampleFiles();
            
            console.log(`📝 Found ${sampleFiles.length} sample files, fetching KQL snippets...`);
            const allCodeSnippets = [];
            
            for (const file of sampleFiles) {
                try {
                    console.log(`📥 Fetching: ${file.name}`);
                    const markdownContent = await this.fetchUrl(file.download_url);
                    const snippets = this.parseMarkdownCodeSnippets(markdownContent);
                    allCodeSnippets.push(...snippets);
                    console.log(`  ✅ Found ${snippets.length} KQL snippets in ${file.name}`);
                    
                    // Add delay between requests to be respectful
                    await this.delay(this.requestDelay);
                } catch (urlError) {
                    console.warn(`  ⚠️ Could not fetch ${file.name}: ${urlError.message}`);
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
                
                // Add delay between directory searches
                await this.delay(this.requestDelay);
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
            if (tableName.toLowerCase() === 'resources') {
                cleanDescription = '\nThe default table if a table isn\'t defined in the query. Most Resource Manager resource types and properties are here';
            } else if (cleanDescription.startsWith('Related to ')) {
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
                const kqlCode = kqlMatch[1].trim();
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

    async writeSchemaFiles() {
        const outputDir = path.join(__dirname, '..', 'src', 'schema');
        
        try {
            await fs.mkdir(outputDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }

        // Extract KQL language elements from Kusto Language Service before writing
        try {
            const kustoElements = this.extractKustoLanguageElements();
            this.schema.keywords = kustoElements.keywords.map(name => ({ name, category: 'KQL Keyword' }));
            this.schema.operators = kustoElements.operators.map(name => ({ name, category: 'KQL Operator' }));
            
            // Set up basic functions and aggregates first
            this.schema.functions = kustoElements.functions.map(name => ({ name, category: 'Function' }));
            this.schema.aggregates = kustoElements.aggregates.map(name => ({ name, category: 'Aggregate' }));
            
            // Extract enhanced documentation for functions and aggregates
            await this.extractMicrosoftDocsDocumentation();
            
        } catch (error) {
            console.warn('⚠️ Could not extract Kusto language elements:', error.message);
            this.schema.keywords = [];
            this.schema.operators = [];
            this.schema.functions = [];
            this.schema.aggregates = [];
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

    async extractMicrosoftDocsDocumentation() {
        const kqlDocsUrl = 'https://api.github.com/repos/MicrosoftDocs/dataexplorer-docs/contents/data-explorer/kusto/query';
        console.log('\n🔍 Extracting KQL documentation from Microsoft Docs...');
        
        try {
            const functionFiles = await this.fetchGitHubDirectoryContents(kqlDocsUrl);
            const relevantFiles = functionFiles.filter(file => 
                file.name.endsWith('-function.md') || 
                file.name.endsWith('-aggregate-function.md') ||
                file.name.endsWith('-aggregation-function.md')
            );

            console.log(`📄 Found ${relevantFiles.length} function documentation files`);

            // Process functions and aggregates in parallel
            const results = await Promise.all(relevantFiles.map(async (file) => {
                const fileContent = await this.fetchGitHubFileContent(file.download_url);
                const functionDoc = this.parseMarkdownDoc(fileContent, file.name);
                
                return { file: file.name, doc: functionDoc };
            }));

            // Separate functions from aggregates (only include successfully parsed ones)
            const functionResults = results.filter(result => result.doc && result.doc.type === 'function').map(result => result.doc);
            const aggregateResults = results.filter(result => result.doc && result.doc.type === 'aggregate').map(result => result.doc);

            console.log(`\n📊 Documentation extraction results:`);
            console.log(`  • Functions documented: ${functionResults.length}`);
            console.log(`  • Aggregates documented: ${aggregateResults.length}`);

            // Match with schema functions and track unmatched
            let matchedFunctions = 0;
            let matchedAggregates = 0;
            const matchedFunctionsList = [];
            const matchedAggregatesList = [];

            for (const func of this.schema.functions) {
                const docFunction = functionResults.find(doc => 
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
                    this.unmatchedFunctions.push(func.name);
                }
            }

            for (const agg of this.schema.aggregates) {
                const docAggregate = aggregateResults.find(doc => 
                    doc.name === agg.name || 
                    doc.name === agg.name.toLowerCase() ||
                    agg.name === doc.name.toLowerCase()
                );
                
                if (docAggregate) {
                    agg.documentation = docAggregate.documentation;
                    agg.category = docAggregate.category;
                    matchedAggregatesList.push(agg);
                    matchedAggregates++;
                } else {
                    this.unmatchedAggregates.push(agg.name);
                }
            }

            // Update schema to only include matched functions and aggregates
            this.schema.functions = matchedFunctionsList;
            this.schema.aggregates = matchedAggregatesList;

            const totalFunctions = matchedFunctions + this.unmatchedFunctions.length;
            const totalAggregates = matchedAggregates + this.unmatchedAggregates.length;

            console.log(`\n🔗 Documentation matching results:`);
            console.log(`  • Functions matched: ${matchedFunctions}/${totalFunctions} (${this.unmatchedFunctions.length} excluded from schema)`);
            console.log(`  • Aggregates matched: ${matchedAggregates}/${totalAggregates} (${this.unmatchedAggregates.length} excluded from schema)`);
            
            if (this.unmatchedFunctions.length > 0) {
                console.log(`  • Unmatched functions: ${this.unmatchedFunctions.join(', ')}`);
            }
            
            if (this.unmatchedAggregates.length > 0) {
                console.log(`  • Unmatched aggregates: ${this.unmatchedAggregates.join(', ')}`);
            }

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
        
        return {
            name: functionName,
            type: type,
            category: parsedDoc.category || (isAggregate ? 'KQL aggregate function' : 'KQL function'),
            documentation: parsedDoc
        };
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

    async generateCompletionData(outputDir) {
        const completionData = {
            tables: Object.keys(this.schema.tables).map(name => ({
                label: name,
                kind: 'Table',
                insertText: name
            })),
            keywords: this.schema.keywords.map(kw => ({
                label: kw.name,
                kind: 'Keyword',
                insertText: kw.name,
                category: kw.category
            })),
            operators: this.schema.operators.map(op => ({
                label: op.name,
                kind: 'Operator',
                insertText: op.name,
                category: op.category
            })),
            functions: this.schema.functions.map(fn => ({
                label: fn.name,
                kind: 'Function',
                insertText: `${fn.name}()`,
                category: fn.category
            })),
            aggregates: this.schema.aggregates.map(agg => ({
                label: agg.name,
                kind: 'Function',
                insertText: `${agg.name}()`,
                category: agg.category
            })),
            resourceTypes: Object.keys(this.schema.resourceTypes).map(type => ({
                label: type,
                kind: 'Value',
                insertText: `'${type}'`
            })),
            properties: [] // this.generatePropertyCompletions() // NOTE: Detailed properties disabled to reduce bundle size
        };

        await fs.writeFile(
            path.join(outputDir, 'completion-data.json'),
            JSON.stringify(completionData, null, 2)
        );
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
            
            console.log(`🔧 Extracted ${keywords.size} keywords, ${operators.size} operators, ${functions.size} functions, and ${aggregates.size} aggregates from Kusto Language Service`);
            
        } catch (error) {
            console.error('❌ Error extracting from Kusto Language Service:', error.message);
            throw error;
        }
        
        return {
            keywords: Array.from(keywords).sort(),
            operators: Array.from(operators).sort(),
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
        
        // Access the global Kusto Language API
        const kustoLanguage = global.Kusto.Language;
        
        // Use keywords and operators from Kusto Language Service
        const keywords = kustoElements.keywords;
        const operators = kustoElements.operators;
        
        // Escape regex metacharacters in keywords for safe regex usage
        const escapedKeywords = keywords.map(kw => {
            // Escape regex special characters: \ ^ $ . | ? * + ( ) [ ] { }
            return kw.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
        });
        const keywordsPattern = escapedKeywords.join('|');
        
        // Escape regex metacharacters in operators for safe regex usage
        const escapedOperators = operators.map(op => {
            // Escape regex special characters: \ ^ $ . | ? * + ( ) [ ] { }
            return op.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&');
        });
        const operatorsPattern = escapedOperators.join('|');
        
        const allFunctions = [...kustoElements.functions, ...kustoElements.aggregates];
        const allFunctionsSet = new Set(allFunctions.map(f => f.toLowerCase()));
        const allKeywordsSet = new Set(keywords.map(k => k.toLowerCase()));
        const allOperatorsSet = new Set(operators.map(o => o.toLowerCase()));
        
        // Find words that can be both functions AND keywords/operators
        const ambiguousWords = [];
        allFunctions.forEach(func => {
            const lowerFunc = func.toLowerCase();
            if (allKeywordsSet.has(lowerFunc) || allOperatorsSet.has(lowerFunc)) {
                ambiguousWords.push(func);
            }
        });
        
        // Separate ambiguous functions from pure functions
        const pureKeywords = keywords.filter(kw => !allFunctionsSet.has(kw.toLowerCase()));
        const pureOperators = operators.filter(op => !allFunctionsSet.has(op.toLowerCase()));
        const pureFunctions = allFunctions.filter(func => {
            const lowerFunc = func.toLowerCase();
            return !allKeywordsSet.has(lowerFunc) && !allOperatorsSet.has(lowerFunc);
        });
        
        const allFunctionsPattern = allFunctions.join('|');
        const pureKeywordsPattern = pureKeywords.map(kw => kw.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureOperatorsPattern = pureOperators.map(op => op.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureFunctionsPattern = pureFunctions.join('|');
        const ambiguousWordsPattern = ambiguousWords.join('|');
        
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
                { "include": "#ambiguous_keywords_as_keywords" },
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
                "function_calls": {
                    "patterns": [
                        {
                            "name": "support.function.builtin.kql",
                            "match": `(?i)\\b(${allFunctionsPattern})(?=\\s*\\()`
                        }
                    ]
                },
                "ambiguous_keywords_as_keywords": {
                    "patterns": [
                        {
                            "name": "keyword.control.kql",
                            "match": `(?i)\\b(${ambiguousWordsPattern})(?!\\s*\\()`
                        }
                    ]
                },
                "keywords": {
                    "patterns": [
                        {
                            "name": "keyword.control.kql",
                            "match": `(?i)\\b(${pureKeywordsPattern})\\b`
                        }
                    ]
                },
                "operators": {
                    "patterns": [
                        {
                            "name": "punctuation.operator.kql",
                            "match": `(${pureOperatorsPattern})`
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
