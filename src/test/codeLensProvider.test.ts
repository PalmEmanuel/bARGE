import * as assert from 'assert';
import * as vscode from 'vscode';
import { BargeCodeLensProvider } from '../codeLensProvider';

suite('BargeCodeLensProvider Tests', () => {

	let provider: BargeCodeLensProvider;

	setup(() => {
		provider = new BargeCodeLensProvider();
	});

	suite('provideCodeLenses', () => {
		test('should return CodeLens items for single query block', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| where type == "microsoft.compute/virtualmachines"\n| limit 10'
			});

			const lenses = provider.provideCodeLenses(doc);

			// Should have 2 lenses (Run and Run New Tab) for the single block
			assert.strictEqual(lenses.length, 2, 'Should have 2 CodeLens items for one query block');

			// Verify commands
			assert.strictEqual(lenses[0].command?.command, 'barge.runQueryFromCodeLens');
			assert.strictEqual(lenses[0].command?.title, '► Run');
			assert.strictEqual(lenses[1].command?.command, 'barge.runQueryFromCodeLensNewTab');
			assert.strictEqual(lenses[1].command?.title, '► Run (New Tab)');
		});

		test('should return CodeLens items for multiple query blocks separated by blank lines', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| limit 10\n\nResourceContainers\n| limit 5'
			});

			const lenses = provider.provideCodeLenses(doc);

			// Should have 4 lenses (2 per block × 2 blocks)
			assert.strictEqual(lenses.length, 4, 'Should have 4 CodeLens items for two query blocks');
		});

		test('should return empty array for empty document', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: ''
			});

			const lenses = provider.provideCodeLenses(doc);
			assert.strictEqual(lenses.length, 0, 'Should return no lenses for empty document');
		});

		test('should return empty array for document with only blank lines', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: '\n\n\n'
			});

			const lenses = provider.provideCodeLenses(doc);
			assert.strictEqual(lenses.length, 0, 'Should return no lenses for blank-only document');
		});

		test('should handle document with trailing blank lines', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| limit 10\n\n\n'
			});

			const lenses = provider.provideCodeLenses(doc);
			assert.strictEqual(lenses.length, 2, 'Should have 2 lenses for one block with trailing blanks');
		});

		test('should pass query text and filename as arguments', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources | limit 5'
			});

			const lenses = provider.provideCodeLenses(doc);
			assert.ok(lenses.length >= 2, 'Should have lenses');

			const runLens = lenses[0];
			assert.ok(runLens.command?.arguments, 'Should have arguments');
			assert.strictEqual(runLens.command?.arguments?.[0], 'Resources | limit 5');
			assert.strictEqual(runLens.command?.arguments?.[1], doc.fileName);
		});

		test('should handle three separate query blocks', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| limit 1\n\nResourceContainers\n| limit 2\n\nAdvisorResources\n| limit 3'
			});

			const lenses = provider.provideCodeLenses(doc);
			// 3 blocks × 2 lenses each = 6
			assert.strictEqual(lenses.length, 6, 'Should have 6 CodeLens items for three query blocks');
		});

		test('should handle multiline query blocks correctly', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources\n| where type == "microsoft.compute/virtualmachines"\n| where location == "eastus"\n| project name, type, location\n| limit 10'
			});

			const lenses = provider.provideCodeLenses(doc);
			assert.strictEqual(lenses.length, 2, 'Should have 2 lenses for one multiline block');

			// The range should cover the full block
			const lens = lenses[0];
			assert.strictEqual(lens.range.start.line, 0, 'Block should start at line 0');
			assert.strictEqual(lens.range.end.line, 4, 'Block should end at line 4');
		});
	});

	suite('refresh', () => {
		test('should fire onDidChangeCodeLenses event', () => {
			let eventFired = false;
			provider.onDidChangeCodeLenses(() => {
				eventFired = true;
			});

			provider.refresh();
			assert.strictEqual(eventFired, true, 'Should fire the event');
		});
	});

	suite('configuration handling', () => {
		test('should respect enableRunQueryCodeLens setting when disabled', async () => {
			const doc = await vscode.workspace.openTextDocument({
				language: 'kql',
				content: 'Resources | limit 10'
			});

			// Get current config, disable the setting
			const config = vscode.workspace.getConfiguration('barge');
			const original = config.get<boolean>('enableRunQueryCodeLens');

			try {
				await config.update('enableRunQueryCodeLens', false, vscode.ConfigurationTarget.Global);
				const lenses = provider.provideCodeLenses(doc);
				assert.strictEqual(lenses.length, 0, 'Should return no lenses when disabled');
			} finally {
				// Restore original setting
				await config.update('enableRunQueryCodeLens', original, vscode.ConfigurationTarget.Global);
			}
		});
	});
});
