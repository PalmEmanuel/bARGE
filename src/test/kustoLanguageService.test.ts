import * as assert from 'assert';
import * as vscode from 'vscode';
import { KustoLanguageServiceProvider } from '../kustoLanguageService';

suite('KustoLanguageService Tests', () => {

	let provider: KustoLanguageServiceProvider;

	setup(() => {
		provider = new KustoLanguageServiceProvider();
	});

	teardown(() => {
		provider.dispose();
	});

	suite('context detection helpers (via reflection)', () => {

		test('isStartOfStatement should detect empty lines', () => {
			const method = (provider as any).isStartOfStatement.bind(provider);
			assert.strictEqual(method(''), true);
			assert.strictEqual(method('  '), true);
		});

		test('isStartOfStatement should detect single word at start', () => {
			const method = (provider as any).isStartOfStatement.bind(provider);
			assert.strictEqual(method('Resources'), true);
			assert.strictEqual(method('  Res'), true);
		});

		test('isStartOfStatement should detect comment lines', () => {
			const method = (provider as any).isStartOfStatement.bind(provider);
			assert.strictEqual(method('  // comment'), true);
		});

		test('isStartOfStatement should return false for complex expressions', () => {
			const method = (provider as any).isStartOfStatement.bind(provider);
			assert.strictEqual(method('| where type =='), false);
			assert.strictEqual(method('name == "test"'), false);
		});

		test('isResourceTypeContext should detect type comparisons', () => {
			const method = (provider as any).isResourceTypeContext.bind(provider);
			assert.strictEqual(method("type == 'microsoft.compute"), true);
			assert.strictEqual(method('type =~ "microsoft.storage'), true);
			assert.strictEqual(method('type =='), true);
		});

		test('isResourceTypeContext should return false for other contexts', () => {
			const method = (provider as any).isResourceTypeContext.bind(provider);
			assert.strictEqual(method('name == "test"'), false);
			assert.strictEqual(method('| where'), false);
		});

		test('isOrderByContext should detect order/sort keyword', () => {
			const method = (provider as any).isOrderByContext.bind(provider);
			assert.strictEqual(method('sort b'), true);
			assert.strictEqual(method('order b'), true);
			assert.strictEqual(method('sort '), true);
		});

		test('isOrderByContext should return false for unrelated context', () => {
			const method = (provider as any).isOrderByContext.bind(provider);
			assert.strictEqual(method('| where'), false);
		});

		test('isJoinContext should detect join keyword', () => {
			const method = (provider as any).isJoinContext.bind(provider);
			assert.strictEqual(method('join k'), true);
			assert.strictEqual(method('join '), true);
		});

		test('isKindContext should detect kind= keyword', () => {
			const method = (provider as any).isKindContext.bind(provider);
			assert.strictEqual(method('kind='), true);
			assert.strictEqual(method('kind ='), true);
			assert.strictEqual(method('kind= inner'), true);
		});

		test('isAfterPipe should detect pipe context', () => {
			const method = (provider as any).isAfterPipe.bind(provider);
			assert.strictEqual(method('| '), true);
			assert.strictEqual(method('| whe'), true);
			assert.strictEqual(method('|'), true);
		});

		test('isInsideQuotes should detect quote context', () => {
			const method = (provider as any).isInsideQuotes.bind(provider);
			assert.strictEqual(method("'microsoft.compute"), true);
			assert.strictEqual(method('"microsoft.compute'), true);
			assert.strictEqual(method("'microsoft.compute'"), false); // even number of quotes
			assert.strictEqual(method('no quotes here'), false);
		});
	});

	suite('word detection', () => {
		test('getCurrentWord should extract word at end of line prefix', () => {
			const method = (provider as any).getCurrentWord.bind(provider);
			assert.strictEqual(method('| where name'), 'name');
			assert.strictEqual(method('| project '), '');
			assert.strictEqual(method('Resources'), 'Resources');
			assert.strictEqual(method(''), '');
		});

		test('getCurrentWord should handle KQL operators with special chars', () => {
			const method = (provider as any).getCurrentWord.bind(provider);
			assert.strictEqual(method('| where name !contains'), '!contains');
			assert.strictEqual(method('| mv-apply'), 'mv-apply');
			assert.strictEqual(method('| project-away'), 'project-away');
		});

		test('isValidWordChar should match alphanumeric and underscore', () => {
			const method = (provider as any).isValidWordChar.bind(provider);
			assert.strictEqual(method('a'), true);
			assert.strictEqual(method('Z'), true);
			assert.strictEqual(method('5'), true);
			assert.strictEqual(method('_'), true);
			assert.strictEqual(method('-'), false);
			assert.strictEqual(method(' '), false);
			assert.strictEqual(method('!'), false);
		});

		test('isValidKQLWord should validate KQL word patterns', () => {
			const method = (provider as any).isValidKQLWord.bind(provider);
			assert.strictEqual(method('where'), true);
			assert.strictEqual(method('project'), true);
			assert.strictEqual(method('!contains'), true);
			assert.strictEqual(method('mv-apply'), true);
			assert.strictEqual(method('project-away'), true);
			assert.strictEqual(method('contains~'), true);
			assert.strictEqual(method('!contains~'), true);
			assert.strictEqual(method('123'), false);
			assert.strictEqual(method(''), false);
		});
	});

	suite('formatting', () => {
		test('formatKQL should add pipe on new lines', () => {
			const method = (provider as any).formatKQL.bind(provider);
			const input = 'Resources | where type == "microsoft.compute/virtualmachines" | limit 10';
			const result = method(input, { tabSize: 4, insertSpaces: true });

			// After formatting, pipes should be on their own lines
			assert.ok(result.includes('| where'), 'Should have pipe with where on its own line');
			assert.ok(result.includes('| limit'), 'Should have pipe with limit on its own line');
		});

		test('formatKQL should preserve blank lines', () => {
			const method = (provider as any).formatKQL.bind(provider);
			const input = 'Resources\n\nResourceContainers';
			const result = method(input, { tabSize: 4, insertSpaces: true });
			assert.ok(result.includes('\n\n'), 'Should preserve blank lines between queries');
		});

		test('formatKQL should handle already-formatted KQL', () => {
			const method = (provider as any).formatKQL.bind(provider);
			const input = 'Resources\n| where type == "vm"\n| limit 10';
			const result = method(input, { tabSize: 4, insertSpaces: true });
			// Already formatted - should remain similar
			assert.ok(result.includes('Resources'), 'Should preserve table name');
			assert.ok(result.includes('| where'), 'Should preserve where clause');
		});

		test('formatKQL should handle empty string', () => {
			const method = (provider as any).formatKQL.bind(provider);
			const result = method('', { tabSize: 4, insertSpaces: true });
			assert.strictEqual(result, '');
		});
	});

	suite('similarity calculation', () => {
		test('calculateSimilarity should return 1.0 for identical strings', () => {
			const method = (provider as any).calculateSimilarity.bind(provider);
			assert.strictEqual(method('resources', 'resources'), 1);
		});

		test('calculateSimilarity should return 0 for completely different strings', () => {
			const method = (provider as any).calculateSimilarity.bind(provider);
			const result = method('abc', 'xyz');
			assert.ok(result < 0.5, 'Should be low similarity for different strings');
		});

		test('calculateSimilarity should return high value for similar strings', () => {
			const method = (provider as any).calculateSimilarity.bind(provider);
			const result = method('resources', 'resourcess');
			assert.ok(result > 0.8, 'Should be high similarity for near-identical strings');
		});
	});

	suite('random example selection', () => {
		test('selectRandomExamples should return all examples when fewer than count', () => {
			const method = (provider as any).selectRandomExamples.bind(provider);
			const examples = ['example1'];
			const result = method('test', examples, 2);
			assert.strictEqual(result.length, 1);
		});

		test('selectRandomExamples should return requested count', () => {
			const method = (provider as any).selectRandomExamples.bind(provider);
			const examples = ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'];
			const result = method('test2', examples, 2);
			assert.strictEqual(result.length, 2);
		});

		test('selectRandomExamples should return empty for empty array', () => {
			const method = (provider as any).selectRandomExamples.bind(provider);
			const result = method('test3', [], 2);
			assert.strictEqual(result.length, 0);
		});

		test('selectRandomExamples should cache results for same hover', () => {
			const method = (provider as any).selectRandomExamples.bind(provider);
			const examples = ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'];

			const result1 = method('cacheTest', examples, 2);
			const result2 = method('cacheTest', examples, 2);

			// Second call should return the same cached results
			assert.deepStrictEqual(result1, result2, 'Cached results should be identical');
		});
	});

	suite('hover state management', () => {
		test('resetHoverState should clear hover tracking', () => {
			const resetMethod = (provider as any).resetHoverState.bind(provider);
			// Should not throw
			resetMethod();
			assert.strictEqual((provider as any).isHovering, false);
			assert.strictEqual((provider as any).currentHoverWord, '');
		});
	});
});
