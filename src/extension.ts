// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AzureService } from './azure/azureService';
import { BargePanel } from './bargePanel';
import { StatusBarManager } from './statusBar';
import { error } from 'console';

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
		BargePanel.createOrShow(context.extensionUri, azureService);
	});

	// Register command to run query from current file
	const runQueryFromFileCommand = vscode.commands.registerCommand('barge.runQueryFromFile', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active file found');
			return;
		}

		const document = activeEditor.document;
		const query = document.getText().trim();
		
		if (!query) {
			vscode.window.showErrorMessage('File is empty or contains no query');
			return;
		}

		await runQueryInPanel(query, 'file', document.fileName);
	});

	// Register command to run query from selection
	const runQueryFromSelectionCommand = vscode.commands.registerCommand('barge.runQueryFromSelection', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('No active file found');
			return;
		}

		const selection = activeEditor.selection;
		const query = activeEditor.document.getText(selection).trim();
		
		if (!query) {
			vscode.window.showErrorMessage('No text selected or selection is empty');
			return;
		}

		await runQueryInPanel(query, 'selection', activeEditor.document.fileName);
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
		await azureService.authenticate();
	});

	// Helper function to run query in panel
	async function runQueryInPanel(query: string, source: 'file' | 'selection', fileName?: string) {
		try {
			// Ensure authentication
			if (!azureService.isAuthenticated()) {
				const authResult = await azureService.authenticate();
				if (!authResult) {
					return;
				}
			}

			// Create or show the panel
			BargePanel.createOrShow(context.extensionUri, azureService);
			
			// Run the query
			if (BargePanel.currentPanel) {
				await BargePanel.currentPanel.runQuery(query, source, fileName);
			}
			
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
		statusBar // Add status bar for proper cleanup
	);

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
