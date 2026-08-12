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

### Schema Generation

In the file `scripts/generate-arg-schema.js`, a schema is generated for the Azure Resource Graph, used for IntelliSense and hover information.

There must be no hard-coded table names, resource types or properties in the source code or the generation script. All schema data must come from the generated schema file at `src/schema/arg-schema.json` which is regularly updated.

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

All commits and pull request titles are validated towards the configuration in `commitlint.config.js` using `@commitlint/config-conventional`.

All commits and pull request titles **MUST** have a subject in normal sentence case (capitalized first letter).

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
- **chore**: Maintenance tasks, build changes
- **deps**: Dependency updates
- **perf**: Performance improvements
- **ci**: CI/CD pipeline changes
- **build**: Build system changes (esbuild, npm scripts, etc.)

#### Breaking Changes
- Add `!` after type/scope for breaking changes: `feat!: Redesign authentication API`
- Include `BREAKING CHANGE:` in footer with description

#### Examples
```
feat(auth): Add Azure account picker with tenant switching

Implements comprehensive account selection dialog with:
- Real-time tenant and subscription listing
- Account change detection and session management
- Improved error handling for authentication failures

Closes #45

fix(results): Resolve panel not updating after query execution

The results panel was not refreshing when running queries from
files due to incorrect event listener registration.

refactor(types): Simplify QueryScope interface

BREAKING CHANGE: QueryScope.subscriptions is now required array
instead of optional parameter

docs: Add conventional commits guidelines to development workflow

chore(deps): Update @azure/identity to v4.0.1

test(auth): Add unit tests for account selection scenarios
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
2. **Sentence casing**: Capitalize the first letter of the subject
3. **Write clear descriptions**: Describe what and why, not how
4. **Use present tense**: "Add feature" not "Added feature"
5. **Reference issues**: Include "Closes #123" or "Fixes #456"
6. **Limit subject line**: 50 characters or less for subject
7. **Include breaking changes**: Always document breaking changes in footer
8. **Consistent scoping**: Use established scopes for better organization

### Automated Validation
- **Commitlint**: Automatically validates commit messages using `@commitlint/config-conventional` with specific config found in `commitlint.config.js`
- **Git Hooks**: Husky prevents commits that don't follow conventional format
- **CI Validation**: Use `npm run commit-lint-ci` to validate PR commits
- **Manual Check**: Use `npm run commit-lint` to validate recent commits

### Development Workflow Integration
```bash
# Before committing changes
npm run lint && npm run check-types

# Commit with conventional format (automatically validated by commitlint)
git add .
git commit -m "feat(auth): implement status bar authentication indicator"

# Validate recent commits manually (optional)
npm run commit-lint

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

## GIF Recording Scenarios

Scenarios are Bash scripts in `scripts/record-gifs/scenarios/`. They are sourced by `record.sh` inside a running recording session — all helpers from `record.sh` are available.

### How a Scenario Works

```
record.sh starts Xvfb → installs extension → calls run_scenario:
  start_recording()        ← ffmpeg begins capturing
  source scenario.sh       ← your script runs here
  stop_recording()
  convert_to_gif()         ← trims boot frames, encodes GIF
```

The GIF is trimmed to `VSCODE_BOOT_SECONDS` — the wall-clock elapsed from recording start until `wait_for_vscode_window` returns. Everything before that is cut; the GIF starts with VS Code fully loaded.

**Critical**: Recording starts BEFORE VS Code launches. Delaying `start_recording` until after the window appears always produces black output.

**Critical**: Everything that happens AFTER `wait_for_vscode_window` is visible in the final GIF, including any scanning/probing clicks. Keep visible actions clean.

### Scenario Template

```bash
#!/usr/bin/env bash
FIXTURE_WORKSPACE="${SCRIPT_DIR}/fixtures/workspace"
mkdir -p "${FIXTURE_WORKSPACE}"

# Inject scenario-specific VS Code settings before launching
add_setting "barge.autoAuthenticate" "false"
add_setting "barge.hideLoginMessages" "false"

code \
    --user-data-dir "${VSCODE_USER_DATA_DIR}" \
    --extensions-dir "${VSCODE_EXTENSIONS_DIR}" \
    --disable-gpu --use-gl=swiftshader --no-sandbox --disable-telemetry \
    --disable-extension github.copilot \
    --disable-extension github.copilot-chat \
    "${FIXTURE_WORKSPACE}" \
    > /dev/null 2>&1 &
VSCODE_PID=$!

# Sets up layout (sidebar right, Explorer open, Chat closed) and pauses 0.5s.
wait_for_vscode_window

# --- actions ---

close_vscode
```

### Available Helpers

| Helper | Description |
|---|---|
| `wait_for_vscode_window` | Waits for window, sizes it, opens Explorer, closes Chat, sleeps 0.5s |
| `click_and_verify x y [threshold] [crop_region]` | Clicks at (x,y), screenshots before/after cropped region, returns 0 if screen changed |
| `click_status_bar` | Scans outward from x=1480 to find bARGE item; validates by checking top 300px changed (auth picker opened); exports `BARGE_STATUS_BAR_X`; returns 1 on failure |
| `move_mouse_smooth x1 y1 x2 y2 [ms]` | Moves mouse naturally via quadratic Bézier curve with ease-in/ease-out and micro-jitter over `ms` milliseconds (default 1000). Lands exactly on target. |
| `add_setting key value` | Injects a JSON key/value into VS Code settings.json before launch (call before `code`) |
| `close_vscode` | Sends Ctrl+Q, waits for process exit |
| `screen_changed before.png after.png [threshold]` | Returns 0 if ImageMagick diff stddev exceeds threshold |

### Click Verification Pattern

Always use `click_and_verify` (or `click_status_bar`) for clicks that should trigger a visible UI change. If the screen does not change, the script fails before GIF conversion — no silent bad GIFs.

**Use a `crop_region` to avoid false positives.** Full-screen diffs trigger on tooltips, hover states, and animations. Crop to only the region where the expected UI change should appear:

```bash
# Good: verified click with crop to quick-pick area (top 300px)
click_and_verify 960 400 "0.005" "1920x300+0+0" || { echo "Error" >&2; close_vscode; exit 1; }

# click_status_bar already uses the top-300px crop internally
click_status_bar || { echo "Error: status bar item not found" >&2; close_vscode; exit 1; }
```

### Mouse Movement Pattern

For natural-looking demos, always smooth-move the mouse from a starting position to the target. The glide **end position must match where the scan will confirm** — mismatches cause visible jumps:

```bash
SB_Y=$((DISPLAY_HEIGHT - 11))

# Start mouse in editor, glide to status bar, then click
xdotool mousemove 960 500
move_mouse_smooth 960 500 1480 $SB_Y 800
click_status_bar || { echo "Error" >&2; close_vscode; exit 1; }

# Glide from confirmed click position up to quick pick
move_mouse_smooth $BARGE_STATUS_BAR_X $SB_Y 917 89 700
```

### Known Coordinates at 1920×1080

All scenarios run at a fixed `1920×1080` Xvfb display with VS Code at `0,0`. Coordinates are deterministic.

| Element | x | y | Notes |
|---|---|---|---|
| bARGE status bar item | ~1480 | `DISPLAY_HEIGHT - 11` = 1069 | `click_status_bar` scans outward from 1480 |
| Quick pick center | 917 | — | VS Code centers quick pick slightly left of screen center |
| Quick pick item 1 (DefaultAzureCredential) | 917 | 89 | First non-separator item |
| Quick pick item 2 | 917 | 139 | Second item |
| Quick pick item height | — | ~50px | Add 50 per additional item |

If quick pick positions feel off, add `sleep 0.2` before interacting to let the animation settle, then adjust y values by ±10.

### Debugging Click Detection

When `click_status_bar` or `click_and_verify` gives false positives or misses, add debug artifacts to see exactly what the image comparison is seeing. In `record.sh`, save before/after crops and upload them:

```bash
# In click_and_verify, after cropping:
mkdir -p /tmp/barge-debug
cp "$before_crop" "/tmp/barge-debug/before-x${x}.png"
cp "$after_crop"  "/tmp/barge-debug/after-x${x}.png"
```

```yaml
# In the workflow, after the Record GIFs step:
- name: Upload debug screenshots
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: debug-screenshots
    path: /tmp/barge-debug/
    retention-days: 3
    if-no-files-found: ignore
```

Remove after debugging. This pattern revealed that x=1480 was the correct bARGE status bar position and that the top-300px crop correctly detects the auth picker opening.

### Per-Scenario Settings

Use `add_setting key value` to override VS Code or bARGE settings for a specific scenario without affecting the shared base settings. Call it before launching `code`:

```bash
# Show sign-in notification and disable auto-authenticate for sign-in scenario
add_setting "barge.autoAuthenticate" "false"
add_setting "barge.hideLoginMessages" "false"
```

Common bARGE settings: `barge.autoAuthenticate` (default: `true`), `barge.hideLoginMessages` (default: `false`).

### Cursor Theme

The CI display uses the **Quintom Snow** cursor theme, installed from GitLab. Key notes:
- Install the theme subdirectory (`Quintom_Snow Cursors/Quintom_Snow/`), not the parent folder
- Needs both `index.theme` (for XCursor) and `~/.config/gtk-3.0/settings.ini` (for VS Code/Electron)
- Set `XCURSOR_THEME` env var and `xrdb -merge` with `Xcursor.theme` after Xvfb starts
- **Heredocs in YAML `run:` blocks break YAML parsing** if content isn't indented — use `printf` instead

### CI Screenshot Capture

Two concurrent `ffmpeg x11grab` instances on the same Xvfb display cause VS Code/Electron to stop painting — both frames become identical and diffs return 0. Use `xwd` (from `x11-apps` package) for single-frame captures instead; it uses the XGetImage protocol and doesn't conflict with the recording ffmpeg.

### Adding a New Scenario

1. Create `scripts/record-gifs/scenarios/<name>.sh`
2. Follow the template above; use `add_setting` for any scenario-specific overrides
3. Use `click_and_verify` / `click_status_bar` with appropriate `crop_region` for all meaningful clicks
4. Glide the mouse smoothly to the target before clicking — match glide endpoint to expected scan confirmation point
5. Run locally with `./scripts/record-gifs/record.sh <name>` (Linux/Xvfb required) or trigger CI
6. The scenario name becomes the GIF filename: `media/readme/gifs/<name>.gif`
7. If click detection is unreliable, add debug artifacts (see above) to inspect what the diff is seeing



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