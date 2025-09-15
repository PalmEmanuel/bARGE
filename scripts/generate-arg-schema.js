#!/usr/bin/env node

/**
 * Azure Resource Graph Schema Generator
 * 
 * Dynamically parses Resource Graph API and Microsoft Learn documentation to generate info for bARGE
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');

const isNotARG = (item) => {
    // Filter out items not available in Azure Resource Graph

    // Should not start with '_' or number
    return /^_/.test(item) ||
        /^\d/.test(item) ||
        // Should not start with 'geo', 'with', 'hll_', 'punycode', 'rank_', 'rowstore', 'quer' (query or queries), 'data', 'bag', 'bin_', 'entity_', 'hard', 'soft', 'set', 'node'
        /^(geo|with|hll_|punycode|rank_|rowstore|quer|data|bag|bin_|entity_|hard|soft|set|node)/i.test(item) ||
        // Should not contain '.'
        /\./i.test(item) ||
        // Should not contain 'schema', 'seal', 'partition', 'like', 'pack', 'null', 'policy', 'cache', 'table', 'containers', 'view', 'log', 'unique', 'security', 'access', 'statistics', 'retention', 'simple', 'shard', 'sql', 'materialize', 'pattern', 'optimization', 'other'
        /(schema|partition|seal|like|pack|null|policy|cache|table|containers|view|log|unique|security|access|statistics|retention|simple|shard|sql|materialize|pattern|optimization|other)/i.test(item) ||
        // Should not be 'commands-and-queries', 'force_remote', 'decodeblocks', 'step', 'callout', 'declare', 'expandoutput', 'mdm', 'missing', 'let', 'alias', 'verbose'
        /^(commands-and-queries|force_remote|decodeblocks|step|callout|declare|expandoutput|mdm|missing|let|alias|verbose)$/i.test(item) ||
        // Should not match 'containscs' because they're duplicates of 'contains_cs' and 'notcontains_cs'
        /containscs/i.test(item) ||
        // Should not match 'matches-regex' because it's 'matches regex'
        /matches-regex/i.test(item) ||
        // Should not start with mv without having dash, because there are duplicates of mv-apply and others without dash
        /^mv[^-]/i.test(item);
};

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
    return 'Function'; // Default fallback
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
function parseMarkdownContent(content) {
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
} catch (error) {
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
            joinKinds: [], // Join kinds extracted from join operator documentation
            lastUpdated: new Date().toISOString()
        };
        this.sampleQueries = [];
        this.kustoBaseUrl = 'https://learn.microsoft.com';
        this.requestDelay = 500; // Increase delay to 500ms to be more respectful of GitHub API

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
        try {
            return await this.makeHttpRequest(url);
        } catch (error) {
            if (attempt < this.maxRetries) {
                const delay = Math.min(this.baseRetryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
                console.warn(`⚠️ ${error.message} for ${url}. Retrying in ${delay}ms...`);
                await this.delay(delay);
                return this.fetchUrl(url, attempt + 1);
            } else {
                throw new Error(`❌ Final attempt failed for ${url}: ${error.message}`);
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

    async loadExistingSchema() {
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
            console.warn('❌ Failed to load existing schema:', error.message);
            console.log('💡 Hint: Run the full generation first to create the schema files');
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
                        const markdownContent = await this.fetchUrl(file.download_url);
                        const snippets = this.parseMarkdownCodeSnippets(markdownContent);
                        return snippets;
                    } catch (urlError) {
                        throw new Error(`⚠️ Could not fetch ${file.name}: ${urlError.message}`);
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
                const markdownContent = await this.fetchUrl(fileInfo.download_url);

                // Parse the table descriptions from the markdown
                const tableDescriptions = this.parseTableDescriptions(markdownContent);
                console.log(`📋 Found descriptions for ${Object.keys(tableDescriptions).length} tables`);

                // Add descriptions to existing tables
                for (const [tableName, description] of Object.entries(tableDescriptions)) {
                    const lowerTableName = tableName.toLowerCase();
                    if (this.schema.tables[lowerTableName]) {
                        this.schema.tables[lowerTableName].description = description;
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
                }
            }
        }

        return codeSnippets;
    }

    parseCodeSnippets(htmlContent) {
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

        console.log(`🔗 Total examples matched: ${totalMatches}/${codeSnippets.length}`);
    }

    snippetStartsWithTable(snippet, tableName) {
        // Check if the snippet starts with the table name (case-insensitive)
        // This is the highest priority match
        const trimmedSnippet = snippet.trim();
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
            this.schema.keywords = kustoElements.keywords.map(name => ({ name, category: 'Keyword' }));
            this.schema.operators = kustoElements.operators.map(name => ({ name, category: 'Operator' }));
            this.schema.functions = [
                // Set up functions and merge aggregates into functions array
                ...kustoElements.functions.map(name => ({ name, category: 'Function' })),
                ...kustoElements.aggregates.map(name => ({ name, category: 'Aggregation Function' }))
            ];

            // Extract enhanced documentation from Microsoft Learn files on GitHub
            await this.extractMicrosoftDocsDocumentation();

        } catch (error) {
            throw new Error(`⚠️ Could not extract Kusto language elements: ${error.message}`);
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
            const matchingFiles = allFiles.filter(file =>
                file.name.endsWith('-function.md') ||
                file.name.endsWith('-aggregate-function.md') ||
                file.name.endsWith('-aggregation-function.md') ||
                file.name.endsWith('-operator.md')
            );

            console.log(`📄 Found ${matchingFiles.length} matching documentation files`);

            // Process functions and operators in parallel
            const syntaxResults = await Promise.all(matchingFiles.map(async (file) => {
                const fileContent = await this.fetchGitHubFileContent(file.download_url);
                const doc = this.parseMarkdownDoc(fileContent, file.name);

                return { file: file.name, doc: doc };
            }));

            const functionsDocumented = syntaxResults.filter(result => result.doc && result.doc.category === 'function').map(result => result.doc);
            const aggregatesDocumented = syntaxResults.filter(result => result.doc && result.doc.category === 'aggregate').map(result => result.doc);
            const operatorsDocumented = syntaxResults.filter(result => result.doc && result.doc.category === 'operator').map(result => result.doc);

            console.log(`\n🔍 Documentation extraction results:`);
            console.log(`  • Functions documented: ${functionsDocumented.length}`);
            console.log(`  • Aggregates documented: ${aggregatesDocumented.length}`);
            console.log(`  • Operators documented: ${operatorsDocumented.length}`);

            // Process operators first to migrate keywords to operators
            await this.processOperatorDocumentation(operatorsDocumented);

            // Then process functions and aggregates
            await this.processFunctionDocumentation(functionsDocumented, aggregatesDocumented);

            // Move keywords back from operators list if they couldn't be matched to docs
            this.schema.keywords = this.schema.operators.filter(op => {
                const opName = typeof op === 'object' ? op.name : op;
                return op.category === 'Keyword' && !isNotARG(opName);
            });
            // Filter out keywords from operators that have been moved back to keywords list
            this.schema.operators = this.schema.operators.filter(op => {
                return op.category !== 'Keyword';
            });

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
        let nameMatch = filename.match(/^(.+?)(?:-(function|aggregate-function|aggregation-function))\.md$/);

        let category = null;
        if (nameMatch) {
            // Determine category from filename
            const isAggregate = filename.includes('aggregate') || filename.includes('aggregation');
            category = isAggregate ? 'aggregate' : 'function';
        }
        else {
            nameMatch = filename.match(/^(.+?)-operator\.md$/);

            if (nameMatch) {
                category = 'operator';
            }
        }

        if (!nameMatch) {
            return null; // Not a recognized function or operator file
        }

        const name = nameMatch[1];

        // Use the original parseMarkdownDoc function to get structured data
        const parsedDoc = parseMarkdownContent(content);

        // Add Microsoft Learn URL
        const urlSlug = filename.replace(/\.md$/, '');
        const microsoftLearnUrl = `https://learn.microsoft.com/en-us/kusto/query/${urlSlug}`;

        // Trim " operator" from the title for cleaner display
        if (parsedDoc.title && parsedDoc.title.toLowerCase().endsWith(' operator')) {
            parsedDoc.title = parsedDoc.title.slice(0, -9).trim(); // Remove " operator" (9 characters)
        }

        // Return structured doc for syntax word (function or operator)
        return {
            name: name,
            category: category,
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
            let foundInKeywordsOrOperators = [...this.schema.operators, ...this.schema.keywords].filter(word => {
                let name = word.name;
                let realName = name;

                // Special handling for 'in' and 'in~' operators in docs
                // 'in' is 'in-cs', '!in' is 'not-in-cs'
                // 'in~' is 'in', '!in~' is 'not-in'
                if (name.match(/^!?in$/)) { // If name is in or !in, treat as in-cs for matching
                    name = `${name}-cs`;
                } else if (name.match(/^!?in~$/)) { // If name is in~ or !in~, treat as in for matching
                    name = name.replace('~', '');
                }

                const wordVariations = [
                    name,
                    name.toLowerCase(),
                    name.replace(/\s/g, '-'),
                    name.replace(/_/g, '-'),
                    name.replace(/_/g, '-').toLowerCase(),
                    name.replace(/-/g, '_'),
                    name.replace(/-/g, '_').toLowerCase()
                ];

                // Create temporary variations for matching:
                // If word starts with "!", create "not-" version
                if (name.toLowerCase().startsWith('!')) {
                    const notDashVersion = 'not-' + name.substring(1);
                    wordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
                    );
                }

                // If word starts with "not" but not "not-" or "not_", create "not-" version
                if (name.toLowerCase().startsWith('not') &&
                    !name.toLowerCase().startsWith('not-') &&
                    !name.toLowerCase().startsWith('not_')) {
                    // Insert dash after "not": notcontains -> not-contains
                    const notDashVersion = 'not-' + name.substring(3);
                    wordVariations.push(
                        notDashVersion,
                        notDashVersion.toLowerCase()
                    );
                }

                // Restore original name after possible matching additions
                name = realName;

                if (name.toLowerCase() === 'limit') {
                    // Special case: "limit" keyword in KQL is same as "take" operator
                    wordVariations.push('take');
                }

                if (name.toLowerCase() === 'order') {
                    // Special case: "order" keyword in KQL is same as "sort" operator
                    wordVariations.push('sort');
                }

                return docOperatorVariations.some(docVar => wordVariations.includes(docVar));
            });

            // Apply documentation to all matching operators
            for (const matchedWord of foundInKeywordsOrOperators) {
                // Update existing operator with documentation
                const cleanedDocumentation = { ...docOperator.documentation };

                // Remove the inner category from documentation to avoid conflicts  
                if (cleanedDocumentation.category) {
                    delete cleanedDocumentation.category;
                }

                matchedWord.documentation = cleanedDocumentation;
                matchedWord.category = 'Operator';
                
                // Special case for join operator - extract join kinds from returnInfo
                if (matchedWord.name.toLowerCase() === 'join' && cleanedDocumentation.returnInfo) {
                    this.schema.joinKinds = this.parseJoinKinds(cleanedDocumentation.returnInfo);
                }
                
                matchedOperatorsList.push(matchedWord);
                documentationApplied = true;
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
                    category: 'operator',
                    documentation: cleanedDocumentation
                };
                matchedOperatorsList.push(newOperator);
                matchedOperators++;
            }
        }

        // Add existing operators that didn't get documentation and track unmatched
        for (const op of [...this.schema.operators, ...this.schema.keywords]) {
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
            console.log(`  • Unmatched operators (${this.unmatchedOperators.length}): ${this.unmatchedOperators.join(', ')}`);
        }
    }

    async processFunctionDocumentation(functionsDocumented, aggregatesDocumented) {
        console.log(`🔗 Processing function documentation...`);

        // Combine both function and aggregate documentation arrays
        const allDocumentedFunctions = [...functionsDocumented, ...aggregatesDocumented];

        // Match with schema functions (including aggregates) and track unmatched
        let matchedFunctions = 0;
        const matchedFunctionsList = [];

        // Collect unmatched functions to preserve them in schema
        const unmatchedFunctionsList = [];
        for (const func of this.schema.functions) {
            const wordVariations = [
                func.name,
                func.name.toLowerCase(),
                func.name.replace(/_/g, '-'),
                func.name.replace(/_/g, '-').toLowerCase(),
                func.name.replace(/-/g, '_'),
                func.name.replace(/-/g, '_').toLowerCase()
            ];

            if (func.name.toLowerCase() === 'iif') {
                // Special case: "iif" in KQL is same as "iff" function
                wordVariations.push('iff');
            }

            if (func.name.toLowerCase() === 'floor') {
                // Special case: "floor" in KQL is same as "bin" function
                wordVariations.push('bin');
            }

            // Find the corresponding documented function
            const docFunction = allDocumentedFunctions.find(docFunc => {
                return wordVariations.includes(docFunc.name);
            });

            if (docFunction) {
                func.documentation = docFunction.documentation;
                func.category = docFunction.documentation.category ? docFunction.documentation.category : 'Function';
                // Remove the inner category from documentation
                delete docFunction.documentation.category;
                matchedFunctionsList.push(func);
                matchedFunctions++;
            } else {
                // Keep unmatched functions but without documentation
                unmatchedFunctionsList.push(func);
                this.unmatchedFunctions.push(func.name);
            }
        }

        // Update schema to include both matched and unmatched functions
        this.schema.functions = [...matchedFunctionsList];

        const totalFunctions = matchedFunctions + this.unmatchedFunctions.length;

        console.log(`  • Functions matched: ${matchedFunctions}/${totalFunctions} (${this.unmatchedFunctions.length} excluded from schema)`);

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

    /**
     * Parse join kinds from the join operator's returnInfo markdown table
     * @param {string} returnInfo - The returnInfo text containing the markdown table
     * @returns {Array} Array of join kind objects with name, description, schemaInfo, and rowsInfo
     */
    parseJoinKinds(returnInfo) {
        const joinKinds = [];
        
        if (!returnInfo) {
            return joinKinds;
        }

        // Split the text into lines and find the table
        const lines = returnInfo.split('\n');
        let inTable = false;
        let headerFound = false;

        let sortOrder = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Look for the table header
            if (line.includes('Join flavor') && line.includes('Returns')) {
                headerFound = true;
                continue;
            }
            
            // Skip the separator line (|---|---|---|)
            if (headerFound && line.match(/^\|\s*[-:]+\s*\|/)) {
                inTable = true;
                continue;
            }
            
            // Process table rows
            if (inTable && line.startsWith('|') && line.endsWith('|')) {
                const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell.length > 0);
                
                if (cells.length >= 2) {
                    const joinFlavorCell = cells[0];
                    const returnsCell = cells[1];
                    
                    // Skip empty rows or illustration column
                    if (!joinFlavorCell || joinFlavorCell === 'Join flavor' || !returnsCell || returnsCell === 'Returns') {
                        continue;
                    }
                    
                    // Parse join flavor names - handle multiple variants like `leftanti`, `anti`, `leftantisemi`
                    const joinNames = [];
                    
                    // Look for backtick-quoted variants first
                    const backtickMatches = joinFlavorCell.match(/`([^`]+)`/g);
                    if (backtickMatches) {
                        backtickMatches.forEach(match => {
                            const names = match.replace(/`/g, '').split(',').map(n => n.trim());
                            joinNames.push(...names);
                        });
                    }
                    
                    // If no backtick variants, get the primary name (before any space or parenthesis)
                    if (joinNames.length === 0) {
                        const primaryName = joinFlavorCell.split(/[\s(]/)[0].trim();
                        if (primaryName && primaryName !== 'Join') {
                            joinNames.push(primaryName);
                        }
                    }
                    
                    // Parse the Returns cell to extract description, schema, and rows info
                    let description = '';
                    let schemaInfo = '';
                    let rowsInfo = '';
                    
                    // Split by <br /> or line breaks to separate description, schema, and rows
                    const returnsParts = returnsCell.replace(/<br\s*\/?>/gi, '\n').split('\n');
                    
                    for (let j = 0; j < returnsParts.length; j++) {
                        const part = returnsParts[j].trim();
                        
                        if (part.toLowerCase().startsWith('**schema**:')) {
                            schemaInfo = part.replace(/\*\*schema\*\*:\s*/i, '').trim();
                        } else if (part.toLowerCase().startsWith('**rows**:')) {
                            rowsInfo = part.replace(/\*\*rows\*\*:\s*/i, '').trim();
                        } else if (part && !part.toLowerCase().includes('schema') && !part.toLowerCase().includes('rows')) {
                            // This is likely the main description
                            if (!description) {
                                description = part;
                            } else {
                                description += ' ' + part;
                            }
                        }
                    }
                    
                    // Create join kind objects for each name variant
                    for (const name of joinNames) {
                        if (name) {
                            sortOrder++;
                            joinKinds.push({
                                name: name,
                                description: description || '',
                                schemaInfo: schemaInfo || '',
                                rowsInfo: rowsInfo || '',
                                sortOrder: `${String(sortOrder).padStart(2, '0')}_joinkind`
                            });
                        }
                    }
                }
            }
            
            // Stop processing if we hit a non-table line after starting the table
            if (inTable && !line.startsWith('|') && line.length > 0 && !line.match(/^\s*$/)) {
                break;
            }
        }
        
        return joinKinds;
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

    extractKustoLanguageElements() {
        console.log('🔧 Extracting KQL language elements from @kusto/language-service-next...');

        const operators = new Set();
        const keywords = new Set();
        const functions = new Set();
        const aggregates = new Set();
        let filteredKeywords = new Set();
        let filteredOperators = new Set();
        let removedFunctions = new Set();

        if (!kustoLanguageService) {
            throw new Error('Kusto Language Service not available');
        }

        try {
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

            // Filter out symbolic keywords and operators (keep only word-based items)
            filteredKeywords = new Set();
            filteredOperators = new Set();
            const isSymbolic = (item) => {
                // Check if item contains only symbols/punctuation and no letters
                return /^[^a-zA-Z]*$/.test(item) && /[^\w\s]/.test(item);
            };

            // Extract functions from Kusto.Language.Functions.All
            if (kustoLanguage.Functions && kustoLanguage.Functions.All) {
                const functionList = kustoLanguage.Functions.All;
                functionList.forEach(fn => {
                    const name = fn.name || fn.Name;
                    if (name && !isNotARG(name)) {
                        functions.add(name);
                    } else if (name) {
                        removedFunctions.add(name);
                    }
                });
            }

            // Extract aggregates from Kusto.Language.Aggregates.All
            if (kustoLanguage.Aggregates && kustoLanguage.Aggregates.All) {
                const aggregateList = kustoLanguage.Aggregates.All;
                aggregateList.forEach(agg => {
                    const name = agg.name || agg.Name;
                    if (name && !isNotARG(name)) {
                        aggregates.add(name);
                    } else if (name) {
                        removedFunctions.add(name);
                    }
                });
            }

            for (const keyword of keywords) {
                if (!isNotARG(keyword)) {
                    filteredKeywords.add(keyword);
                }
            }

            for (const operator of operators) {
                if (!isSymbolic(operator) && !isNotARG(operator)) {
                    filteredOperators.add(operator);
                }
            }

            const removedKeywords = keywords.size - filteredKeywords.size;
            const removedOperators = operators.size - filteredOperators.size;
            console.log(`🔧 Extracted ${filteredKeywords.size} keywords, ${filteredOperators.size} operators, ${functions.size} functions, and ${aggregates.size} aggregates from Kusto Language Service`);
            if (removedKeywords > 0 || removedOperators > 0) {
                console.log(`   • Filtered out ${removedKeywords} symbolic keywords and ${removedOperators} symbolic operators`);
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

        const functions = this.schema.functions.map(f => f.name ? f.name : f);
        const keywords = this.schema.keywords.map(k => k.name ? k.name : k);
        const operators = this.schema.operators.map(o => o.name ? o.name : o);

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

        const allFunctionsSet = new Set(functions.map(f => f.toLowerCase()));
        const allKeywordsSet = new Set(keywords.map(k => k.toLowerCase()));
        const allOperatorsSet = new Set(operators.map(o => o.toLowerCase()));

        // Separate ambiguous functions from pure functions
        const pureKeywords = keywords.filter(kw => !allFunctionsSet.has(kw.toLowerCase()));
        const pureOperators = operators.filter(op => !allFunctionsSet.has(op.toLowerCase()));
        const pureFunctions = functions.filter(func => {
            const lowerFunc = func.toLowerCase();
            return !allKeywordsSet.has(lowerFunc) && !allOperatorsSet.has(lowerFunc);
        });

        // Use pureFunctions for all function patterns to avoid conflicts with operators
        const allFunctionsPattern = functions.join('|');
        const pureKeywordsPattern = pureKeywords.map(kw => kw.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureOperatorsPattern = pureOperators.map(op => op.replace(/[\\^$.|?*+(){}\[\]]/g, '\\$&')).join('|');
        const pureFunctionsPattern = pureFunctions.join('|');

        const tables = Object.keys(this.schema.tables).filter(name => name).join('|');

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
                            "match": `(?i)(!?)\\b(${operatorsPattern})\\b(~?)`
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
        console.log(`   - ${keywords.length} keywords`);
        console.log(`   - ${operators.length} operators`);
        console.log(`   - ${functions.length} functions`);
        console.log(`   - ${Object.keys(this.schema.tables).length} tables`);
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
                'Authorization': `Bearer ${bearerToken}`
            }
        };

        try {
            const responseData = await this.makeHttpsRequest(requestOptions);
            const schemaData = JSON.parse(responseData);
            if (schemaData.error) {
                throw new Error(`API error: ${schemaData.error.message}`);
            }

            console.log(`✅ Successfully retrieved ${Object.keys(schemaData).length} table categories`);

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
    const showHelp = args.includes('--help') || args.includes('-h');
    const bearerToken = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));

    if (showHelp) {
        console.log(`
Azure Resource Graph Schema Generator

Usage:
  node generate-arg-schema.js <bearer-token>      # Full generation using Azure API

Options:
  --help, -h            Show this help message

Examples:
  node generate-arg-schema.js eyJ0eXAiOiJKV1QiLCJhbGc...
        `);
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
        console.log('⚠️ No bearer token provided!');
    }
}

module.exports = ARGSchemaGenerator;
