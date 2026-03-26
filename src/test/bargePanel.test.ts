import * as assert from 'assert';
import { BargePanel } from '../bargePanel';

suite('BargePanel Tests', () => {

	suite('getFileKey', () => {
		test('should return basename for a full file path', () => {
			assert.strictEqual(BargePanel.getFileKey('/home/user/projects/query.kql'), 'query.kql');
		});

		test('should return basename for Windows-style path', () => {
			assert.strictEqual(BargePanel.getFileKey('C:\\Users\\test\\query.kql'), 'query.kql');
		});

		test('should return "untitled" for undefined input', () => {
			assert.strictEqual(BargePanel.getFileKey(undefined), 'untitled');
		});

		test('should return "untitled" for empty string', () => {
			assert.strictEqual(BargePanel.getFileKey(''), 'untitled');
		});

		test('should return "untitled" for Untitled documents', () => {
			assert.strictEqual(BargePanel.getFileKey('Untitled-1'), 'untitled');
			assert.strictEqual(BargePanel.getFileKey('Untitled-2'), 'untitled');
		});

		test('should return basename for relative path', () => {
			assert.strictEqual(BargePanel.getFileKey('src/queries/test.kql'), 'test.kql');
		});

		test('should return filename when no directory', () => {
			assert.strictEqual(BargePanel.getFileKey('simple.kql'), 'simple.kql');
		});

		test('should handle paths with special characters', () => {
			assert.strictEqual(BargePanel.getFileKey('/path/to/my query.kql'), 'my query.kql');
		});
	});

	suite('static panel management', () => {
		test('getTargetForFile should not throw for non-existent file key', () => {
			BargePanel.getTargetForFile('nonexistent.kql');
		});

		test('setActiveFileKey should not throw', () => {
			// Should not throw for any input
			BargePanel.setActiveFileKey('test.kql');
			// Should not throw for any input
			BargePanel.setActiveFileKey('test.kql');
			BargePanel.setActiveFileKey(undefined);
			BargePanel.setActiveFileKey('another.kql');
		});

		test('handleFileRename should handle same key without error', () => {
			// Renaming to same key should be a no-op
			BargePanel.handleFileRename('test.kql', 'test.kql');
		});

		test('handleFileRename should handle non-existent keys without error', () => {
			BargePanel.handleFileRename('nonexistent-old.kql', 'nonexistent-new.kql');
		});
	});
});
