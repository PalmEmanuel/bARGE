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

// Function to clean markdown content - removes links, includes, Microsoft Learn callouts, and other formatting
function cleanMarkdown(text) {
    if (!text) {
        return '';
    }

    const lines = text.split('\n');
    const filteredLines = [];

    // First pass: filter Microsoft Learn callouts
    for (const line of lines) {
        const trimmed = line.trim();

        // Check if this line contains a Microsoft Learn callout (case-insensitive)
        if (trimmed.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i)) {
            // Replace the callout with just a blockquote, preserving any content after the marker
            const cleanedLine = line.replace(/\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i, '').replace(/>\s*>\s*/, '> ');
            filteredLines.push(cleanedLine);
        } else {
            // Keep the line as is
            filteredLines.push(line);
        }
    }

    // Second pass: clean markdown links and other formatting
    return filteredLines.join('\n')
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
        title: cleanMarkdown(cleanFunctionTitle(cleanedTitle)),
        description: cleanMarkdown(description),
        syntax: cleanMarkdown(syntax),
        returnInfo: cleanMarkdown(returnInfo),
        parametersTable: cleanMarkdown(parametersTable),
        example: cleanMarkdown(example),
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
            keywords: [], // KQL keywords from Kusto Language Service
            operators: [], // KQL operators from Kusto Language Service
            functions: [], // KQL functions and aggregates from Kusto Language Service
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
                        reject(new Error(`GitHub API rate limit exceeded. Reset at ${resetDate.toISOString()}. Wait ${Math.round(waitTime / 1000)}s`));
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

                this.schema.tables[tableName] = tableSchema;

                tableCount++;
                console.log(`    ✅ ${tableName}: table extracted`);
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
                    const sampleLink = `https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category?wt.mc_id=DT-MVP-5005372`;
                    return `${description} [View sample queries](${sampleLink}).`;
                }
            }
        }

        // Fallback to a more specific description based on the table name
        if (tableName === 'resources') {
            return '\nMost Resource Manager resource types and properties are here. [View sample queries](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/starter?wt.mc_id=DT-MVP-5005372).';
        }

        return `For sample queries for this table, see [Resource Graph sample queries for ${tableName}](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category?wt.mc_id=DT-MVP-5005372).`;
    }

    async fetchAndMatchSampleQueries() {
        console.log('📚 Fetching sample queries from Microsoft documentation...');

        try {
            // Use GitHub API to discover all sample files recursively
            console.log('📝 Discovering sample files from GitHub repository...');
            const sampleFiles = await this.discoverGitHubSampleFiles();

            console.log(`📝 Found ${sampleFiles.length} sample files, fetching KQL snippets...`);

            // Process files in parallel with controlled concurrency to be respectful to GitHub API
            const batchSize = 10; // Process 10 files at a time
            const allCodeSnippets = [];

            for (let i = 0; i < sampleFiles.length; i += batchSize) {
                const batch = sampleFiles.slice(i, i + batchSize);
                console.log(`📥 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sampleFiles.length / batchSize)} (${batch.length} files)`);

                const batchPromises = batch.map(async (file) => {
                    try {
                        console.log(`  📥 Fetching: ${file.name}`);
                        const markdownContent = await this.fetchUrl(file.download_url);
                        const snippets = this.parseMarkdownCodeSnippets(markdownContent);
                        console.log(`    ✅ Found ${snippets.length} KQL snippets in ${file.name}`);
                        return snippets;
                    } catch (urlError) {
                        throw new Error(`    ⚠️ Could not fetch ${file.name}: ${urlError.message}`);
                        return [];
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                batchResults.forEach(snippets => allCodeSnippets.push(...snippets));

                // Add delay between batches to be respectful to GitHub API
                if (i + batchSize < sampleFiles.length) {
                    await this.delay(this.requestDelay);
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
                throw new Error(`⚠️ Could not access ${searchPath}: ${error.message}`);
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
            throw new Error(`⚠️ Failed to fetch directory contents for ${path}: ${error.message}`);
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
            throw new Error(`⚠️ Could not fetch table descriptions: ${error.message}`);
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

            // Set up functions and merge aggregates into functions array
            this.schema.functions = [
                ...kustoElements.functions.map(name => ({ name, category: 'Function' })),
                ...kustoElements.aggregates.map(name => ({ name, category: 'Aggregation function' }))
            ];

            // Remove the separate aggregates section since they're now merged into functions
            delete this.schema.aggregates;

            // Extract enhanced documentation for functions (including aggregates)
            await this.extractMicrosoftDocsDocumentation();

        } catch (error) {
            throw new Error(`⚠️ Could not extract Kusto language elements: ${error.message}`);
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
                    keywordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
                    );
                }

                // If keyword starts with "not" but not "not-" or "not_", create "not-" version
                if (keywordName.toLowerCase().startsWith('not') &&
                    !keywordName.toLowerCase().startsWith('not-') &&
                    !keywordName.toLowerCase().startsWith('not_')) {
                    // Insert dash after "not": notcontains -> not-contains
                    const notDashVersion = 'not-' + keywordName.substring(3);
                    keywordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
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

                // Check if this keyword is actually an operator 
                const isOperator = keywordName.startsWith('!') ||
                    keywordName.includes('between') ||
                    keywordName.includes('contains') ||
                    keywordName.includes('endswith') ||
                    keywordName.includes('startswith') ||
                    keywordName.includes('equals') ||
                    keywordName.includes('has') ||
                    keywordName.includes('in') ||
                    keywordName.includes('matches') ||
                    // KQL operators that are commonly in keywords section
                    ['render', 'search', 'summarize', 'extend', 'project', 'where',
                        'take', 'limit', 'order', 'sort', 'union', 'evaluate', 'top',
                        'join', 'distinct', 'count', 'parse', 'sample', 'fork',
                        'facet', 'materialize', 'serialize', 'mv-apply', 'mv-expand',
                        'make-series', 'make-graph', 'reduce', 'scan', 'range',
                        'datatable', 'externaldata', 'getschema', 'lookup', 'consume'].includes(keywordName);

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

    cleanMarkdown(content) {
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
            resourceTypes: Object.keys(this.schema.resourceTypes).map(type => ({
                label: type,
                kind: 'Value',
                insertText: `'${type}'`
            }))
        };

        await fs.writeFile(
            path.join(outputDir, 'completion-data.json'),
            JSON.stringify(completionData, null, 2)
        );
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
                { "include": "#numbers" },
                { "include": "#columns" },
                { "include": "#strings" }
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
     * Step 2: Save into schema
     */
    async fetchSchemaFromAzureAPI(bearerToken) {
        console.log('🔍 Fetching table categories from Azure Resource Graph API...');

        // Get all tables and resource types
        const categoriesData = await this.fetchTableCategories(bearerToken);
        if (!categoriesData) {
            return null;
        }

        // Process the categories data into our schema format
        const tables = {};
        const resourceTypes = {};

        for (const [tableName, resourceTypeArray] of Object.entries(categoriesData)) {
            tables[tableName] = {
                name: tableName,
                resourceTypes: [],
                examples: []
            };

            // Add resource types for this table (resourceTypeArray is directly an array of strings)
            if (Array.isArray(resourceTypeArray)) {
                for (const resourceTypeName of resourceTypeArray) {
                    tables[tableName].resourceTypes.push(resourceTypeName);

                    // Create or update resource type entry
                    if (resourceTypes[resourceTypeName]) {
                        // Add this table to existing resource type
                        if (!resourceTypes[resourceTypeName].tables.includes(tableName)) {
                            resourceTypes[resourceTypeName].tables.push(tableName);
                        }
                    } else {
                        // Create new resource type entry
                        resourceTypes[resourceTypeName] = {
                            name: resourceTypeName,
                            tables: [tableName]
                        };
                    }
                }
            }
        }

        console.log(`✅ Processed ${Object.keys(tables).length} tables and ${Object.keys(resourceTypes).length} resource types`);

        return {
            tables,
            resourceTypes
        };
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
     * Generate a GUID for request tracking
     */
    generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
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

                // Step 1: Fetch table descriptions
                console.log('📋 Step 1: Fetching table descriptions...');
                await this.fetchTableDescriptions();

                // Step 2: Fetch examples from GitHub
                console.log('📚 Step 2: Fetching examples from GitHub...');
                await this.fetchAndMatchSampleQueries();

                console.log(`✅ API-based schema generation completed with ${Object.keys(apiResult.tables).length} tables`);
                console.log(`📊 Schema summary:`);
                console.log(`   - ${Object.keys(this.schema.tables).length} tables`);
                console.log(`   - ${Object.keys(this.schema.resourceTypes).length} resource types`);

                // Generate output files
                await this.writeSchemaFiles();

                console.log('✅ Schema generation completed successfully using Azure API!');
                return true;
            } else {
                throw new Error('⚠️ API-based generation failed!');
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
        console.log('📖 Full generation from documentation (no bearer token provided)...');
        generator.generateExamplesOnly().catch(console.error);
    }
}

module.exports = ARGSchemaGenerator;
