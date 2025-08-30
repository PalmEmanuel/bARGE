// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { BargePanel } from './bargePanel';
import { AzureService } from './azureService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "barge-vscode" is now active!');

	// Initialize Azure service
	const azureService = new AzureService();

	// Register command to open the bARGE explorer
	const openExplorerCommand = vscode.commands.registerCommand('barge.openExplorer', () => {
		BargePanel.createOrShow(context.extensionUri, azureService);
	});

	// Register command to run a query (this can be used later for keyboard shortcuts or other triggers)
	const runQueryCommand = vscode.commands.registerCommand('barge.runQuery', async () => {
		// If panel is open, focus it and potentially run the current query
		if (BargePanel.currentPanel) {
			BargePanel.currentPanel.reveal();
		} else {
			// Open panel if not already open
			BargePanel.createOrShow(context.extensionUri, azureService);
		}
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

	// Helper function to run query in panel
	async function runQueryInPanel(query: string, source: 'file' | 'selection', fileName?: string) {
		// Open panel if not already open
		if (!BargePanel.currentPanel) {
			BargePanel.createOrShow(context.extensionUri, azureService);
		}

		// Send query to panel
		if (BargePanel.currentPanel) {
			BargePanel.currentPanel.runFileQuery(query, source, fileName);
		}
	}

	// Add commands to subscriptions for proper cleanup
	context.subscriptions.push(
		openExplorerCommand, 
		runQueryCommand, 
		runQueryFromFileCommand, 
		runQueryFromSelectionCommand
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
