# bARGE - boosted Azure Resource Graph Explorer

bARGE is a VS Code extension that provides Azure Resource Graph querying capabilities directly in VS Code, similar to the Azure Portal's Resource Graph Explorer. It's built with TypeScript, esbuild for bundling, and uses Azure SDK libraries for authentication and querying.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Build
- Install dependencies: `npm install` -- takes 16 seconds. NEVER CANCEL - may appear to hang but is downloading dependencies.
- Check TypeScript types: `npm run check-types` -- takes 3 seconds.
- Run linting: `npm run lint` -- takes 1 second.
- Full compile: `npm run compile` -- takes 4-5 seconds.
- Production build: `npm run package` -- takes 4-5 seconds.
- **CRITICAL**: Set timeout to 300+ seconds for all build commands.

### Development Workflow
- Start watch mode: `npm run watch` -- starts TypeScript and esbuild watchers in parallel.
- Launch extension: Press `F5` in VS Code to start Extension Development Host.
- Alternative development: Use VS Code's "Run Extension" configuration from launch.json.
- **NEVER CANCEL** watch mode processes - they run continuously during development.

### Testing and Validation
- **WARNING**: Tests require VS Code environment: `npm run test` fails in headless environments due to network restrictions (cannot download VS Code runtime).
- Pre-test setup: `npm run pretest` -- takes 8 seconds, compiles both extension and tests.
- Test compilation only: `npm run compile-tests` -- compiles tests to `out/` directory.
- **MANUAL VALIDATION REQUIREMENT**: Always test extension functionality by loading it in VS Code Extension Development Host.

### Packaging
- Install VSIX packaging tool: `npm install -g @vscode/vsce` -- takes 25 seconds.
- Create VSIX package: `vsce package --no-yarn` -- takes 6 seconds.
- **NOTE**: May need to update `engines.vscode` version to match `@types/vscode` version if packaging fails.

## Validation Scenarios

After making changes, ALWAYS perform these validation steps:

### Basic Functionality Test
1. Start watch mode: `npm run watch`
2. Launch Extension Development Host with `F5`
3. Create a test KQL file: `echo "Resources | limit 10" > test.kql`
4. Open the KQL file in VS Code
5. Right-click and select "bARGE: Run Query from File"
6. Verify the bARGE Results Panel opens

### Command Testing
- Test all bARGE commands via Command Palette (Ctrl+Shift+P).

### Authentication Scenarios
- Verify Azure authentication works (requires Azure CLI or browser auth)
- Test both DefaultAzureCredential and InteractiveBrowserCredential flows

## Key File Locations

### Source Code Structure
- Main extension entry: `src/extension.ts`
- Azure service integration: `src/azureService.ts`
- Results panel management: `src/bargePanel.ts`
- Webview provider: `src/resultsViewProvider.ts`
- Type definitions: `src/types.ts`

### Configuration Files
- Package definition: `package.json` (contains all npm scripts and VS Code extension manifest)
- TypeScript config: `tsconfig.json`
- ESLint config: `eslint.config.mjs`
- Build configuration: `esbuild.js`
- VS Code tasks: `.vscode/tasks.json`
- Debug configuration: `.vscode/launch.json`
- Language support: `language-configuration.json` (for .kql files)

### Build Outputs
- Bundled extension: `dist/extension.js` (esbuild output)
- Test compilation: `out/` directory (TypeScript output)
- VSIX package: `barge-vscode-[version].vsix`

## Common Commands Reference

### Quick Start Commands
```bash
# Full setup and build
npm install && npm run package

# Development workflow
npm run watch
# Then press F5 in VS Code

# Validate changes
npm run lint && npm run check-types && npm run compile

# Create test KQL files
echo "Resources | limit 10" > test.kql
echo "Resources | where type == 'microsoft.storage/storageaccounts' | limit 5" > storage.kql
```

### Complete Development Cycle
```bash
# 1. Initial setup
npm install

# 2. Start development 
npm run watch &
# Launch VS Code and press F5

# 3. After making changes
npm run lint
npm run check-types  
npm run compile

# 4. Package for distribution
vsce package --no-yarn
```

### Timing Expectations (with 50% buffer for timeouts)
- `npm install`: 16 seconds (use 30+ second timeout)
- `npm run check-types`: 3 seconds (use 15+ second timeout)
- `npm run lint`: 1 second (use 10+ second timeout)  
- `npm run compile`: 4-5 seconds (use 15+ second timeout)
- `npm run package`: 4-5 seconds (use 15+ second timeout)
- `npm run pretest`: 8 seconds (use 20+ second timeout)
- `vsce package`: 6 seconds (use 15+ second timeout)
- `npm install -g @vscode/vsce`: 25 seconds (use 60+ second timeout)

## Conventional Commits and Changelog

### Commit Message Format
bARGE follows the [Conventional Commits specification v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for consistent commit messages and automated changelog generation.

#### Basic Structure
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### Commit Types
- **feat**: New feature for the user (triggers minor version bump)
- **fix**: Bug fix for the user (triggers patch version bump)
- **docs**: Documentation changes only
- **style**: Code style changes (formatting, semicolons, etc.) - no code logic changes
- **refactor**: Code changes that neither fix bugs nor add features
- **test**: Add or modify tests
- **chore**: Maintenance tasks, build changes, dependency updates
- **perf**: Performance improvements
- **ci**: CI/CD pipeline changes
- **build**: Build system changes (esbuild, npm scripts, etc.)

#### Breaking Changes
- Add `!` after type/scope for breaking changes: `feat!: redesign authentication API`
- Include `BREAKING CHANGE:` in footer with description
- Triggers major version bump in semantic versioning

#### Examples
```
feat(auth): add Azure account picker with tenant switching

Implements comprehensive account selection dialog with:
- Real-time tenant and subscription listing
- Account change detection and session management
- Improved error handling for authentication failures

Closes #45

fix(results): resolve panel not updating after query execution

The results panel was not refreshing when running queries from
files due to incorrect event listener registration.

refactor(types): simplify QueryScope interface

BREAKING CHANGE: QueryScope.subscriptions is now required array
instead of optional parameter

docs: add conventional commits guidelines to development workflow

chore(deps): update @azure/identity to v4.0.1

test(auth): add unit tests for account selection scenarios
```

#### Scope Guidelines
Common scopes for bARGE:
- `auth`: Authentication and Azure service integration
- `results`: Query results panel and data display
- `panel`: Webview panels and UI components
- `query`: KQL file handling and query execution
- `config`: Configuration and settings
- `build`: Build system and bundling
- `test`: Testing infrastructure
- `docs`: Documentation

### Changelog Generation
- Conventional commits enable automated changelog generation
- Use `npm run changelog` (if available) to generate CHANGELOG.md
- Changes are grouped by type: Features, Bug Fixes, Documentation, etc.
- Breaking changes are prominently highlighted
- Links to commits and issues are automatically included

### Best Practices
1. **Keep commits atomic**: One logical change per commit
2. **Write clear descriptions**: Describe what and why, not how
3. **Use present tense**: "Add feature" not "Added feature"
4. **Reference issues**: Include "Closes #123" or "Fixes #456"
5. **Limit subject line**: 50 characters or less for subject
6. **Include breaking changes**: Always document breaking changes in footer
7. **Consistent scoping**: Use established scopes for better organization

### Development Workflow Integration
```bash
# Before committing changes
npm run lint && npm run check-types

# Commit with conventional format for an example status bar feature implementation
git add .
git commit -m "feat(auth): implement status bar authentication indicator"

# Package and test
npm run package
# Then test in Extension Development Host
```

## Important Notes

### Azure Dependencies
- Uses Azure SDK libraries: `@azure/identity`, `@azure/arm-resourcegraph`, `@azure/arm-subscriptions`
- Authentication requires Azure CLI (`az login`) or browser-based authentication
- Queries Azure Resource Graph across subscriptions and tenants

### VS Code Extension Details
- Registers .kql file language support
- Provides context menu commands for .kql files
- Creates webview panels for query results
- Supports F8 keybinding for running selected queries

### CI/CD Considerations
- Tests cannot run in headless CI environments
- Build and linting work correctly in CI
- VSIX packaging requires alignment between `engines.vscode` and `@types/vscode` versions

## Troubleshooting

### Build Issues
- Ensure Node.js version compatibility (works with v20.19.4)
- Run `npm run check-types` to identify TypeScript issues
- Use `npm run lint` to catch code style problems

### Extension Development
- Always use Extension Development Host for testing
- Check VS Code Developer Tools console for runtime errors  
- Verify Azure authentication is working before testing queries
- Build output size: ~2.7MB for `dist/extension.js`
- Extension supports .kql files with syntax highlighting and IntelliSense

### Version Compatibility
- Keep `engines.vscode` and `@types/vscode` versions aligned
- Update both when targeting newer VS Code versions