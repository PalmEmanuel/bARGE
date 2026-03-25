import * as assert from 'assert';
import * as vscode from 'vscode';
import { StatusBarManager } from '../statusBar';

suite('StatusBarManager Tests', () => {

	let statusBar: StatusBarManager;

	setup(() => {
		statusBar = new StatusBarManager();
	});

	teardown(() => {
		statusBar.dispose();
	});

	test('should create status bar item on construction', () => {
		// StatusBarManager creates an item on construction - verify it doesn't throw
		assert.ok(statusBar, 'StatusBarManager should be created successfully');
	});

	test('should update status to authenticated', () => {
		// This should not throw
		statusBar.updateStatusAuthenticated('testuser@example.com');
	});

	test('should update status to not authenticated', () => {
		// This should not throw
		statusBar.updateStatusNotAuthenticated();
	});

	test('should update status to loading', () => {
		// This should not throw
		statusBar.updateStatusLoading('Signing in...');
	});

	test('should update status to error', () => {
		// This should not throw
		statusBar.updateStatusError('Authentication failed');
	});

	test('should dispose without errors', () => {
		const tempStatusBar = new StatusBarManager();
		// Should not throw
		tempStatusBar.dispose();
	});

	test('should accept auth session change callback', () => {
		let callbackCalled = false;
		const statusBarWithCallback = new StatusBarManager(async () => {
			callbackCalled = true;
		});
		// Verify it doesn't throw during construction
		assert.ok(statusBarWithCallback, 'StatusBarManager with callback should be created');
		statusBarWithCallback.dispose();
	});

	test('should handle multiple status updates in sequence', () => {
		statusBar.updateStatusNotAuthenticated();
		statusBar.updateStatusLoading('Loading...');
		statusBar.updateStatusAuthenticated('user@test.com');
		statusBar.updateStatusError('Error occurred');
		statusBar.updateStatusNotAuthenticated();
		// Should complete without errors
	});
});
