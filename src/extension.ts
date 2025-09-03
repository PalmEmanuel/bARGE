// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AzureService } from './azureService';
import { BargePanel } from './bargePanel';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Initialize Azure service
	const azureService = new AzureService();

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
			const authResult = await azureService.authenticate();
			if (!authResult) {
				vscode.window.showErrorMessage('Authentication failed. Cannot set scope.');
				return;
			}
		}
		await azureService.setScope();
	});

	// Register VS Code authentication command
	const authenticateWithVSCodeCommand = vscode.commands.registerCommand('barge.authenticateWithVSCode', async () => {
		await azureService.authenticateWithVSCode();
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
		authenticateWithVSCodeCommand
	);

	// Auto-authenticate if configured
	const config = vscode.workspace.getConfiguration('barge');
	if (config.get('autoAuthenticate', true)) {
		// Try to authenticate silently on activation
		azureService.authenticate().catch(error => {
			console.log('Auto-authentication failed:', error);
			// Don't show error to user for silent auth failure
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
