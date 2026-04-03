import * as vscode from 'vscode';
import { AzureService } from './azure/azureService';
import { BargePanel } from './bargePanel';
import { StatusBarManager } from './statusBar';
import { KustoLanguageServiceProvider } from './kustoLanguageService';
import { BargeCodeLensProvider } from './codeLensProvider';
import { registerMcpTools } from './mcpTools';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Initialize status bar first
	const statusBar = new StatusBarManager(async () => {
		// When VS Code authentication sessions change, verify if our session is still valid
		try {
			const isStillValid = await azureService.verifyAuthentication();
			
			if (!isStillValid) {
				statusBar.updateStatusNotAuthenticated();
			}
		} catch (error) {
			console.error('bARGE: Session verification failed:', error);
			statusBar.updateStatusNotAuthenticated();
		}
	});

	// Initialize Azure service with auth and loading callbacks
	const azureService = new AzureService(
		// Auth status callback
		(authenticated: boolean, accountName: string | null) => {
			if (authenticated && accountName) {
				statusBar.updateStatusAuthenticated(accountName);
			} else {
				statusBar.updateStatusNotAuthenticated();
			}
		},
		// Loading status callback
		(isLoading: boolean, message?: string) => {
			if (isLoading && message) {
				statusBar.updateStatusLoading(message);
			} else {
				// When loading stops, restore the appropriate auth status
				if (azureService.isAuthenticated()) {
					const accountName = azureService.getCurrentAccount();
					if (accountName) {
						statusBar.updateStatusAuthenticated(accountName);
					} else {
						statusBar.updateStatusNotAuthenticated();
					}
				} else {
					statusBar.updateStatusNotAuthenticated();
				}
			}
		}
	);

	// Register command to open results panel
	const openResultsCommand = vscode.commands.registerCommand('barge.openResults', () => {
		const fileKey = getActiveFileKey();
		BargePanel.getOrCreateForFile(context.extensionUri, azureService, fileKey);
	});

	// Register command to run query from current file
	const runQueryFromFileCommand = vscode.commands.registerCommand('barge.runQueryFromFile', async (uri?: vscode.Uri) => {
		let document: vscode.TextDocument;
		let fileName: string;

		if (uri) {
			// Called from explorer context - uri is provided
			try {
				document = await vscode.workspace.openTextDocument(uri);
				fileName = uri.fsPath;
			} catch (error) {
				const errorMsg = (error && typeof error === 'object' && 'message' in error) ? (error as Error).message : '';
				vscode.window.showErrorMessage(`Failed to open file. Please check the file path and permissions.${errorMsg ? ' Error: ' + errorMsg : ''}`);
				return;
			}
		} else {
			// Called from editor context - use active editor
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				vscode.window.showErrorMessage('No active file found');
				return;
			}
			document = activeEditor.document;
			fileName = document.fileName;
		}

		const query = document.getText().trim();
		
		if (!query) {
			vscode.window.showErrorMessage('File is empty or contains no query');
			return;
		}

		await runQueryInPanel(query, 'file', fileName);
	});

	// Register command to run query from selection
	const runQueryFromSelectionCommand = vscode.commands.registerCommand('barge.runQueryFromSelection', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active file found');
			return;
		}

		const selection = activeEditor.selection;
		let selectedText = activeEditor.document.getText(selection);
		let queryText = selectedText.trim();

		// If there's no explicit selection
		// compute the implicit query range based on blank lines above/below the cursor.
		if (!selectedText) {
			const implicitRange = getImplicitQueryRange(activeEditor.document, selection.active);
			if (!implicitRange) {
				vscode.window.showErrorMessage('No text selected and no implicit query selection found');
				return;
			}
			queryText = activeEditor.document.getText(implicitRange).trim();
		}

		if (!queryText) {
			vscode.window.showErrorMessage('No text selected and no implicit query selection found');
			return;
		}

		await runQueryInPanel(queryText, 'selection', activeEditor.document.fileName);
	});

	// Register scope setting command
	const setScopeCommand = vscode.commands.registerCommand('barge.setScope', async () => {
		if (!azureService.isAuthenticated()) {
			const authResult = await azureService.authenticateWithDefaultCredential();
			if (!authResult) {
				vscode.window.showErrorMessage('Authentication failed, cannot set scope!');
				return;
			}
		}
		await azureService.setScope();
	});

	// Register VS Code authentication command
	const authenticateCommand = vscode.commands.registerCommand('barge.authenticate', async () => {
		statusBar.suppressTooltip();
		await azureService.authenticate();
	});

	// Register CodeLens command to run a query directly from the lens
	const runFromCodeLensCommand = vscode.commands.registerCommand('barge.runQueryFromCodeLens', async (queryText: string, fileName: string) => {
		await runQueryInPanel(queryText, 'selection', fileName);
	});

	// Register CodeLens command to run a query in a new tab
	const runFromCodeLensNewTabCommand = vscode.commands.registerCommand('barge.runQueryFromCodeLensNewTab', async (queryText: string, fileName: string) => {
		await runQueryInNewTab(queryText, 'selection', fileName);
	});

	// Register command to run query from file in a new tab
	const runQueryFromFileNewTabCommand = vscode.commands.registerCommand('barge.runQueryFromFileNewTab', async (uri?: vscode.Uri) => {
		let document: vscode.TextDocument;
		let fileName: string;

		if (uri) {
			try {
				document = await vscode.workspace.openTextDocument(uri);
				fileName = uri.fsPath;
			} catch (error) {
				const errorMsg = (error && typeof error === 'object' && 'message' in error) ? (error as Error).message : '';
				vscode.window.showErrorMessage(`Failed to open file.${errorMsg ? ' Error: ' + errorMsg : ''}`);
				return;
			}
		} else {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				vscode.window.showErrorMessage('No active file found');
				return;
			}
			document = activeEditor.document;
			fileName = document.fileName;
		}

		const query = document.getText().trim();
		if (!query) {
			vscode.window.showErrorMessage('File is empty or contains no query');
			return;
		}

		await runQueryInNewTab(query, 'file', fileName);
	});

	// Register command to run query from selection in a new tab
	const runQueryFromSelectionNewTabCommand = vscode.commands.registerCommand('barge.runQueryFromSelectionNewTab', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active file found');
			return;
		}

		const selection = activeEditor.selection;
		let selectedText = activeEditor.document.getText(selection);
		let queryText = selectedText.trim();

		if (!selectedText) {
			const implicitRange = getImplicitQueryRange(activeEditor.document, selection.active);
			if (!implicitRange) {
				vscode.window.showErrorMessage('No text selected and no implicit query selection found');
				return;
			}
			queryText = activeEditor.document.getText(implicitRange).trim();
		}

		if (!queryText) {
			vscode.window.showErrorMessage('No text selected and no implicit query selection found');
			return;
		}

		await runQueryInNewTab(queryText, 'selection', activeEditor.document.fileName);
	});

	// Derive the file key for panel routing from the active editor
	function getActiveFileKey(): string {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return BargePanel.getFileKey(); }
		return BargePanel.getFileKey(editor.document.fileName);
	}

	// Helper function to run query in the target panel for its source file
	async function runQueryInPanel(query: string, source: 'file' | 'selection', fileName?: string) {
		try {
			if (!azureService.isAuthenticated()) {
				const authResult = await azureService.authenticate();
				if (!authResult) { return; }
			}

			const fileKey = BargePanel.getFileKey(fileName);
			const panel = BargePanel.getOrCreateForFile(context.extensionUri, azureService, fileKey);
			await panel.runQuery(query, source, fileName);
		} catch (error) {
			vscode.window.showErrorMessage(`Query execution failed: ${error}`);
		}
	}

	// Helper function to run query in a brand-new tab (promoted to target)
	async function runQueryInNewTab(query: string, source: 'file' | 'selection', fileName?: string) {
		try {
			if (!azureService.isAuthenticated()) {
				const authResult = await azureService.authenticate();
				if (!authResult) { return; }
			}

			const fileKey = BargePanel.getFileKey(fileName);
			const panel = BargePanel.createNewForFile(context.extensionUri, azureService, fileKey);
			await panel.runQuery(query, source, fileName);
		} catch (error) {
			vscode.window.showErrorMessage(`Query execution failed: ${error}`);
		}
	}

	// Add commands to subscriptions for proper cleanup
	context.subscriptions.push(
		openResultsCommand,
		runQueryFromFileCommand, 
		runQueryFromSelectionCommand,
		setScopeCommand,
		authenticateCommand,
		runFromCodeLensCommand,
		runFromCodeLensNewTabCommand,
		runQueryFromFileNewTabCommand,
		runQueryFromSelectionNewTabCommand,
		statusBar // Add status bar for proper cleanup
	);

	// Register enhanced Kusto language service (includes hover, completion, signature help, formatting)
	const kustoLanguageService = new KustoLanguageServiceProvider();
	kustoLanguageService.register(context);

	// Register CodeLens provider for "Run Query" buttons above query blocks
	const codeLensProvider = new BargeCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: 'kql' },
			codeLensProvider
		)
	);

	// Refresh CodeLens when the setting changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('barge.enableRunQueryCodeLens')) {
				codeLensProvider.refresh();
			}
		})
	);

	// Track the active editor so panel titles show the focus indicator.
	// When editor is undefined a non-editor view (e.g. a bARGE webview) has focus;
	// the panel's own onDidChangeViewState handles that case, so we leave the key alone.
	function updateActiveFileKeyFromEditor(editor?: vscode.TextEditor): void {
		if (!editor) { return; }

		const langId = editor.document.languageId;
		const isSupported = langId === 'kql'
			|| editor.document.fileName.endsWith('.kql')
			|| langId === 'powershell'
			|| editor.document.fileName.endsWith('.ps1')
			|| langId === 'plaintext';
		BargePanel.setActiveFileKey(isSupported ? BargePanel.getFileKey(editor.document.fileName) : undefined);
	}

	// Set initial state and subscribe to editor changes
	updateActiveFileKeyFromEditor(vscode.window.activeTextEditor);
	const activeEditorTracker = vscode.window.onDidChangeActiveTextEditor(updateActiveFileKeyFromEditor);
	context.subscriptions.push(activeEditorTracker);

	// Re-key panels when source files are renamed
	const renameTracker = vscode.workspace.onDidRenameFiles(e => {
		for (const { oldUri, newUri } of e.files) {
			const oldKey = BargePanel.getFileKey(oldUri.fsPath);
			const newKey = BargePanel.getFileKey(newUri.fsPath);
			BargePanel.handleFileRename(oldKey, newKey);
		}
	});
	context.subscriptions.push(renameTracker);

	// Slight, subtle highlight used to indicate the implicit query under cursor.
	let implicitQueryDecoration: vscode.TextEditorDecorationType | undefined;

	function createImplicitDecoration() {
		// Dispose previous decoration if present
		if (implicitQueryDecoration) {
			implicitQueryDecoration.dispose();
		}

		// Choose background color based on theme kind
		const themeKind = vscode.window.activeColorTheme.kind;
		let backgroundColor: string;

		switch (themeKind) {
			case vscode.ColorThemeKind.Light:
				// Light theme: very subtle dark grey
				backgroundColor = 'rgba(0, 0, 0, 0.04)';
				break;
			case vscode.ColorThemeKind.Dark:
				// Dark theme: very subtle light grey
				backgroundColor = 'rgba(255, 255, 255, 0.04)';
				break;
			case vscode.ColorThemeKind.HighContrastLight:
				// High contrast light: more visible dark overlay
				backgroundColor = 'rgba(0, 0, 0, 0.12)';
				break;
			case vscode.ColorThemeKind.HighContrast:
				// High contrast dark: more visible light overlay
				backgroundColor = 'rgba(255, 255, 255, 0.16)';
				break;
			default:
				// Fallback to dark theme color
				backgroundColor = 'rgba(255, 255, 255, 0.04)';
				break;
		}

		implicitQueryDecoration = vscode.window.createTextEditorDecorationType({
			backgroundColor: backgroundColor
		});

		return implicitQueryDecoration;
	}

	// Create initial decoration
	createImplicitDecoration();

	// When the active color theme changes recreate the decoration so theme token
	// changes are picked up immediately (some themes may map tokens differently).
	const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
		createImplicitDecoration();
		updateImplicitDecoration();
	});

	function getImplicitQueryRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
		const totalLines = document.lineCount;
		let line = position.line;

		// If the cursor is on an empty line, check if the line above has content.
		// If so, include this empty line as the trailing line of the query above.
		if (document.lineAt(line).text.trim() === '') {
			if (line > 0 && document.lineAt(line - 1).text.trim() !== '') {
				// The line above has content, so find the start of that query
				let prevEmpty = -1;
				for (let i = line - 2; i >= 0; i--) {
					if (document.lineAt(i).text.trim() === '') {
						prevEmpty = i;
						break;
					}
				}
				const startLine = prevEmpty === -1 ? 0 : prevEmpty + 1;
				
				// Include the current empty line as the end
				const startPos = new vscode.Position(startLine, 0);
				const endPos = document.lineAt(line).range.end;
				return new vscode.Range(startPos, endPos);
			}
			// Otherwise, no implicit selection on empty lines
			return null;
		}

		// Find the nearest empty line strictly above the cursor
		let prevEmpty = -1;
		for (let i = line - 1; i >= 0; i--) {
			if (document.lineAt(i).text.trim() === '') {
				prevEmpty = i;
				break;
			}
		}
		const startLine = prevEmpty === -1 ? 0 : prevEmpty + 1;

		// Find the nearest empty line strictly below the cursor
		let nextEmpty = -1;
		for (let i = line + 1; i < totalLines; i++) {
			if (document.lineAt(i).text.trim() === '') {
				nextEmpty = i;
				break;
			}
		}
		const endLine = nextEmpty === -1 ? totalLines - 1 : nextEmpty - 1;

		let s = startLine;
		let e = endLine;
		// Trim any accidental empty lines at the boundaries
		while (s <= e && document.lineAt(s).text.trim() === '') {
			s++;
		}
		while (e >= s && document.lineAt(e).text.trim() === '') {
			e--;
		}
		if (s > e) {
			return null;
		}

		const startPos = new vscode.Position(s, 0);
		const endPos = document.lineAt(e).range.end;
		return new vscode.Range(startPos, endPos);
	}

	function updateImplicitDecoration(editor?: vscode.TextEditor) {
		const active = editor ?? vscode.window.activeTextEditor;
		if (!active) {
			// Clear context when no active editor
			vscode.commands.executeCommand('setContext', 'barge.hasImplicitQuery', false);
			return;
		}

		// Determine if we should show the implicit decoration
		let rangeToDecorate: vscode.Range | null = null;

		// Only apply to KQL or .kql files
		const langId = active.document.languageId;
		const isKqlFile = langId === 'kql' || active.document.fileName.endsWith('.kql');

		// Only show decoration if: it's a KQL file, no text is selected, and we found a valid range
		if (isKqlFile && active.selection.isEmpty) {
			const cursor = active.selection.active;
			rangeToDecorate = getImplicitQueryRange(active.document, cursor);
		}

		// Set context for command visibility (whether text is selected OR implicit query exists)
		const hasSelectionOrImplicit = isKqlFile && (!active.selection.isEmpty || rangeToDecorate !== null);
		vscode.commands.executeCommand('setContext', 'barge.hasImplicitQuery', hasSelectionOrImplicit);

		// Apply decoration: either the range or empty array to clear
		active.setDecorations(implicitQueryDecoration!, rangeToDecorate ? [rangeToDecorate] : []);
	}

	// Update decoration on selection, active editor change, and document edits
	const selListener = vscode.window.onDidChangeTextEditorSelection(e => updateImplicitDecoration(e.textEditor));
	const activeListener = vscode.window.onDidChangeActiveTextEditor(editor => updateImplicitDecoration(editor));
	const docListener = vscode.workspace.onDidChangeTextDocument(e => {
		if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
			updateImplicitDecoration(vscode.window.activeTextEditor);
		}
	});

	// Run an initial update for the active editor on activation
	updateImplicitDecoration(vscode.window.activeTextEditor);

	context.subscriptions.push(implicitQueryDecoration!, selListener, activeListener, docListener, themeListener);

	// Register MCP / Language Model tools for GitHub Copilot integration
	registerMcpTools(context, azureService);

	// Auto-authenticate if configured
	const config = vscode.workspace.getConfiguration('barge');
	if (config.get('autoAuthenticate', true)) {
		// Try to authenticate silently on activation
		azureService.authenticateWithDefaultCredential().catch(() => {
			// Silent failure - user can manually authenticate if needed
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
