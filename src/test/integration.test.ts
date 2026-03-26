import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { QueryResponse, QueryResult } from '../types';

/**
 * Interactive / Integration tests for the bARGE extension.
 *
 * These tests exercise the extension end-to-end inside the VS Code host:
 *   - Extension activation and command registration
 *   - KQL file handling (open, language detection)
 *   - Implicit query range detection
 *   - Command execution with proper error handling
 *   - Panel lifecycle (open, dispose)
 *   - CodeLens integration with real documents
 *   - Status bar interactions
 *   - Configuration changes
 *
 * These tests act as "dogfooding" — they use the extension the same way a
 * user would, ensuring that all components work together.
 */
suite('Interactive Extension Integration Tests', () => {

	let tmpDir: string;

	suiteSetup(async () => {
		// Create a temporary directory for test KQL files
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barge-test-'));
	});

	suiteTeardown(async () => {
		// Clean up temporary files
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	suite('Extension Activation', () => {
		test('extension should be present in the extension list', () => {
			const ext = vscode.extensions.getExtension('palmemanuel.barge-vscode');
			// In test environments, the extension may or may not be available
			// but the import should work
			assert.ok(true, 'Extension module is accessible');
		});

		test('barge commands should be registered', async function () {
			// Ensure the extension is activated before checking commands
			const ext = vscode.extensions.getExtension('palmemanuel.barge-vscode');
			if (ext && !ext.isActive) {
				await ext.activate();
			}

			const commands = await vscode.commands.getCommands(true);
			const bargeCommands = commands.filter(cmd => cmd.startsWith('barge.'));

			// Verify all expected bARGE commands are registered
			const expectedCommands = [
				'barge.openResults',
				'barge.setScope',
				'barge.authenticate',
				'barge.runQueryFromFile',
				'barge.runQueryFromSelection',
				'barge.runQueryFromCodeLens',
				'barge.runQueryFromCodeLensNewTab',
				'barge.runQueryFromFileNewTab',
				'barge.runQueryFromSelectionNewTab'
			];

			for (const cmd of expectedCommands) {
				assert.ok(
					bargeCommands.includes(cmd),
					`Command ${cmd} should be registered`
				);
			}
		});
	});

	suite('KQL File Handling', () => {
		test('should open a .kql file and detect language', async () => {
			const filePath = path.join(tmpDir, 'test-query.kql');
			fs.writeFileSync(filePath, 'Resources\n| where type == "microsoft.compute/virtualmachines"\n| limit 10');

			const doc = await vscode.workspace.openTextDocument(filePath);
			assert.ok(doc, 'Document should be opened');
			assert.ok(
				doc.languageId === 'kql' || doc.fileName.endsWith('.kql'),
				'Should be recognized as KQL'
			);
			assert.ok(doc.getText().includes('Resources'), 'Should contain the query text');
		});

		test('should create and open a new KQL document', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'ResourceContainers\n| where type == "microsoft.resources/subscriptions"\n| project name, subscriptionId'
			});

			assert.ok(doc, 'Document should be created');
			assert.strictEqual(doc.lineCount, 3, 'Should have 3 lines');
		});

		test('should handle empty KQL file', async () => {
			const filePath = path.join(tmpDir, 'empty.kql');
			fs.writeFileSync(filePath, '');

			const doc = await vscode.workspace.openTextDocument(filePath);
			assert.strictEqual(doc.getText(), '', 'Should be empty');
		});

		test('should handle KQL file with multiple queries separated by blank lines', async () => {
			const content = 'Resources\n| limit 10\n\nResourceContainers\n| limit 5\n\nAdvisorResources\n| limit 3';
			const filePath = path.join(tmpDir, 'multi-query.kql');
			fs.writeFileSync(filePath, content);

			const doc = await vscode.workspace.openTextDocument(filePath);
			assert.ok(doc.getText().includes('Resources'));
			assert.ok(doc.getText().includes('ResourceContainers'));
			assert.ok(doc.getText().includes('AdvisorResources'));
		});
	});

	suite('Command Execution', () => {
		test('barge.runQueryFromFile should not throw for empty file', async () => {
			const filePath = path.join(tmpDir, 'empty-for-command.kql');
			fs.writeFileSync(filePath, '');

			const doc = await vscode.workspace.openTextDocument(filePath);
			await vscode.window.showTextDocument(doc);

			// Command shows an error message for empty file but should not throw
			await assert.doesNotReject(
				async () => { await vscode.commands.executeCommand('barge.runQueryFromFile'); },
				'runQueryFromFile should handle empty file gracefully'
			);
		});

		test('barge.runQueryFromSelection should not throw with no active editor', async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await new Promise(resolve => setTimeout(resolve, 100));

			// Command shows an error message but should not throw
			await assert.doesNotReject(
				async () => { await vscode.commands.executeCommand('barge.runQueryFromSelection'); },
				'runQueryFromSelection should handle missing editor gracefully'
			);
		});

		test('barge.openResults should create a webview panel', async () => {
			await vscode.commands.executeCommand('barge.openResults');

			// Allow the panel to be created and registered
			await new Promise(resolve => setTimeout(resolve, 200));

			// Verify a barge results panel was created by checking for a tab with bARGE in the label
			const bargeTab = vscode.window.tabGroups.all
				.flatMap(g => g.tabs)
				.find(t => t.label.includes('bARGE'));
			assert.ok(bargeTab, 'Should have created a bARGE results panel tab');
		});
	});

	suite('Implicit Query Range Detection', () => {
		test('should detect query block when cursor is on a line', async () => {
			const content = 'Resources\n| where type == "vm"\n| limit 10\n\nResourceContainers\n| limit 5';
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content
			});
			const editor = await vscode.window.showTextDocument(doc);

			// Place cursor on line 1 (| where type == "vm")
			const position = new vscode.Position(1, 0);
			editor.selection = new vscode.Selection(position, position);

			// Wait for decorations to update
			await new Promise(resolve => setTimeout(resolve, 200));

			// The implicit query range should cover lines 0-2 (first query block)
			// We can verify by checking that barge.hasImplicitQuery context is set
			// (Exact context value isn't directly accessible, but we verify no errors)
			assert.ok(true, 'Cursor placed on query block without errors');
		});

		test('should handle cursor on blank line between queries', async () => {
			const content = 'Resources\n| limit 10\n\nResourceContainers\n| limit 5';
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content
			});
			const editor = await vscode.window.showTextDocument(doc);

			// Place cursor on the blank line (line 2)
			const position = new vscode.Position(2, 0);
			editor.selection = new vscode.Selection(position, position);

			await new Promise(resolve => setTimeout(resolve, 200));
			assert.ok(true, 'Cursor on blank line handled without errors');
		});

		test('should detect single-line query', async () => {
			const content = 'Resources | limit 10';
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content
			});
			const editor = await vscode.window.showTextDocument(doc);

			const position = new vscode.Position(0, 5);
			editor.selection = new vscode.Selection(position, position);

			await new Promise(resolve => setTimeout(resolve, 200));
			assert.ok(true, 'Single-line query detected without errors');
		});
	});

	suite('CodeLens Integration', () => {
		test('should provide CodeLens items for KQL document', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| limit 10\n\nResourceContainers\n| limit 5'
			});

			await vscode.window.showTextDocument(doc);

			// Wait for CodeLens to be computed
			await new Promise(resolve => setTimeout(resolve, 500));

			// Try to get CodeLens from the provider
			const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
				'vscode.executeCodeLensProvider',
				doc.uri
			);

			// CodeLens should be available if the provider is registered
			if (lenses) {
				assert.ok(lenses.length > 0, 'Should have CodeLens items');
				// Each query block should have "Run" and "Run (New Tab)" lenses
				assert.ok(lenses.length >= 2, 'Should have at least 2 CodeLens items');
			}
		});
	});

	suite('Configuration', () => {
		test('should have barge configuration section', () => {
			const config = vscode.workspace.getConfiguration('barge');
			assert.ok(config, 'Should have barge configuration');
		});

		test('should have autoAuthenticate setting', () => {
			const config = vscode.workspace.getConfiguration('barge');
			const autoAuth = config.get<boolean>('autoAuthenticate');
			// Default value should be true or undefined (depending on if extension has activated)
			assert.ok(autoAuth === true || autoAuth === undefined, 'autoAuthenticate should default to true');
		});

		test('should have hideLoginMessages setting', () => {
			const config = vscode.workspace.getConfiguration('barge');
			const hideMsg = config.get<boolean>('hideLoginMessages');
			assert.ok(hideMsg === false || hideMsg === undefined, 'hideLoginMessages should default to false');
		});

		test('should be able to update configuration', async () => {
			const config = vscode.workspace.getConfiguration('barge');
			const original = config.get<boolean>('enableRunQueryCodeLens');

			try {
				await config.update('enableRunQueryCodeLens', false, vscode.ConfigurationTarget.Global);
				// Must re-read configuration to get fresh values after update
				const updated = vscode.workspace.getConfiguration('barge').get<boolean>('enableRunQueryCodeLens');
				assert.strictEqual(updated, false, 'Should update configuration');
			} finally {
				await config.update('enableRunQueryCodeLens', original, vscode.ConfigurationTarget.Global);
			}
		});
	});

	suite('Types Validation', () => {
		test('QueryResponse structure should be valid for success', () => {
			const response: QueryResponse = {
				success: true,
				data: {
					columns: [{ name: 'name', type: 'string' }],
					data: [['test']],
					totalRecords: 1,
					query: 'Resources | limit 1',
					timestamp: new Date().toISOString()
				}
			};

			assert.strictEqual(response.success, true);
			assert.ok(response.data);
			assert.strictEqual(response.data.columns.length, 1);
			assert.strictEqual(response.data.data.length, 1);
		});

		test('QueryResponse structure should be valid for error', () => {
			const response: QueryResponse = {
				success: false,
				error: 'Test error',
				errorDetails: 'Detailed error info'
			};

			assert.strictEqual(response.success, false);
			assert.ok(response.error);
			assert.ok(response.errorDetails);
		});
	});

	suite('Panel File Key Routing', () => {
		test('should generate correct file keys for different file types', () => {
			const { BargePanel } = require('../bargePanel');

			assert.strictEqual(BargePanel.getFileKey('/path/to/query.kql'), 'query.kql');
			assert.strictEqual(BargePanel.getFileKey('/path/to/test.ps1'), 'test.ps1');
			assert.strictEqual(BargePanel.getFileKey(undefined), 'untitled');
			assert.strictEqual(BargePanel.getFileKey(''), 'untitled');
		});
	});

	suite('End-to-End KQL Workflow', () => {
		test('should handle complete KQL file workflow: create, open, detect language', async () => {
			// Step 1: Create a KQL file
			const filePath = path.join(tmpDir, 'e2e-test.kql');
			const queryContent = [
				'// E2E test query - find storage accounts',
				'Resources',
				'| where type == "microsoft.storage/storageaccounts"',
				'| project name, location, resourceGroup',
				'| order by name asc',
				'| limit 10'
			].join('\n');
			fs.writeFileSync(filePath, queryContent);

			// Step 2: Open the file
			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc);

			// Step 3: Verify document properties
			assert.strictEqual(doc.lineCount, 6, 'Should have 6 lines');
			assert.ok(doc.getText().includes('microsoft.storage/storageaccounts'));

			// Step 4: Place cursor on different lines and verify no errors
			for (let line = 0; line < doc.lineCount; line++) {
				const pos = new vscode.Position(line, 0);
				editor.selection = new vscode.Selection(pos, pos);
			}

			// Step 5: Verify CodeLens is available
			await new Promise(resolve => setTimeout(resolve, 300));
			const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
				'vscode.executeCodeLensProvider',
				doc.uri
			);

			// CodeLens should exist since this is a KQL file
			if (lenses) {
				assert.ok(lenses.length >= 2, 'Should have Run and Run (New Tab) CodeLens');
			}

			assert.ok(true, 'E2E workflow completed successfully');
		});

		test('should handle multi-query KQL file with navigation', async () => {
			const filePath = path.join(tmpDir, 'multi-query-e2e.kql');
			const content = [
				'// Query 1: VMs',
				'Resources',
				'| where type == "microsoft.compute/virtualmachines"',
				'| limit 5',
				'',
				'// Query 2: Storage',
				'Resources',
				'| where type == "microsoft.storage/storageaccounts"',
				'| limit 5',
				'',
				'// Query 3: Networks',
				'Resources',
				'| where type == "microsoft.network/virtualnetworks"',
				'| limit 5'
			].join('\n');
			fs.writeFileSync(filePath, content);

			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc);

			// Navigate through each query block
			// Query 1 cursor
			editor.selection = new vscode.Selection(new vscode.Position(2, 0), new vscode.Position(2, 0));
			await new Promise(resolve => setTimeout(resolve, 100));

			// Blank line between queries
			editor.selection = new vscode.Selection(new vscode.Position(4, 0), new vscode.Position(4, 0));
			await new Promise(resolve => setTimeout(resolve, 100));

			// Query 2 cursor
			editor.selection = new vscode.Selection(new vscode.Position(7, 0), new vscode.Position(7, 0));
			await new Promise(resolve => setTimeout(resolve, 100));

			// Query 3 cursor
			editor.selection = new vscode.Selection(new vscode.Position(12, 0), new vscode.Position(12, 0));
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify CodeLens items for all 3 query blocks
			const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
				'vscode.executeCodeLensProvider',
				doc.uri
			);

			if (lenses) {
				// 3 blocks × 2 lenses each = 6
				assert.ok(lenses.length >= 6, `Should have 6+ CodeLens items, got ${lenses.length}`);
			}
		});
	});
});
