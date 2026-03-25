import * as assert from 'assert';
import { isGuid, isGuidColumn, extractUniqueGuids, isLikelyIdentityColumn, shouldShowResolveButton, IDENTITY_GUID_COLUMN_NAMES } from '../guidUtils';

suite('GUID Utilities Tests', () => {

	suite('isGuid', () => {
		test('should return true for valid lowercase v4 GUID', () => {
			assert.strictEqual(isGuid('550e8400-e29b-41d4-a716-446655440000'), true);
		});

		test('should return true for valid uppercase GUID', () => {
			assert.strictEqual(isGuid('550E8400-E29B-41D4-A716-446655440000'), true);
		});

		test('should return true for valid mixed-case GUID', () => {
			assert.strictEqual(isGuid('550e8400-E29B-41d4-A716-446655440000'), true);
		});

		test('should return false for non-string input', () => {
			assert.strictEqual(isGuid(12345), false);
			assert.strictEqual(isGuid(null), false);
			assert.strictEqual(isGuid(undefined), false);
			assert.strictEqual(isGuid({}), false);
			assert.strictEqual(isGuid([]), false);
			assert.strictEqual(isGuid(true), false);
		});

		test('should return false for empty string', () => {
			assert.strictEqual(isGuid(''), false);
		});

		test('should return false for string without dashes', () => {
			assert.strictEqual(isGuid('550e8400e29b41d4a716446655440000'), false);
		});

		test('should return false for string with wrong format', () => {
			assert.strictEqual(isGuid('not-a-guid-at-all-here'), false);
			assert.strictEqual(isGuid('550e8400-e29b-41d4-a716'), false);
			assert.strictEqual(isGuid('550e8400-e29b-41d4-a716-446655440000-extra'), false);
		});

		test('should return false for GUID with invalid version digit', () => {
			// Version digit (position 13) must be 1-5
			assert.strictEqual(isGuid('550e8400-e29b-01d4-a716-446655440000'), false);
			assert.strictEqual(isGuid('550e8400-e29b-61d4-a716-446655440000'), false);
		});

		test('should return false for GUID with invalid variant digit', () => {
			// Variant digit (position 17) must be 8, 9, a, or b
			assert.strictEqual(isGuid('550e8400-e29b-41d4-0716-446655440000'), false);
			assert.strictEqual(isGuid('550e8400-e29b-41d4-c716-446655440000'), false);
		});
	});

	suite('isGuidColumn', () => {
		test('should return true when all values are GUIDs', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8',
				'6ba7b811-9dad-11d1-80b4-00c04fd430c8'
			];
			assert.strictEqual(isGuidColumn(data), true);
		});

		test('should return true when above threshold percentage are GUIDs', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8',
				'6ba7b811-9dad-11d1-80b4-00c04fd430c8',
				'not-a-guid' // 75% are GUIDs, threshold is 70%
			];
			assert.strictEqual(isGuidColumn(data), true);
		});

		test('should return false when below threshold percentage are GUIDs', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				'not-a-guid-1',
				'not-a-guid-2',
				'not-a-guid-3' // 25% are GUIDs
			];
			assert.strictEqual(isGuidColumn(data), false);
		});

		test('should return false for empty array', () => {
			assert.strictEqual(isGuidColumn([]), false);
		});

		test('should return false for null/undefined input', () => {
			assert.strictEqual(isGuidColumn(null as any), false);
			assert.strictEqual(isGuidColumn(undefined as any), false);
		});

		test('should ignore null/undefined values in data', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				null,
				undefined,
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8'
			];
			// Non-null values are both GUIDs (100%)
			assert.strictEqual(isGuidColumn(data), true);
		});

		test('should return false when all values are null/undefined', () => {
			const data = [null, undefined, null];
			assert.strictEqual(isGuidColumn(data), false);
		});

		test('should respect custom threshold', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				'not-a-guid' // 50% are GUIDs
			];
			assert.strictEqual(isGuidColumn(data, 0.5), true);
			assert.strictEqual(isGuidColumn(data, 0.6), false);
		});
	});

	suite('extractUniqueGuids', () => {
		test('should extract unique GUIDs from array', () => {
			const data = [
				'550e8400-e29b-41d4-a716-446655440000',
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8',
				'550e8400-e29b-41d4-a716-446655440000', // duplicate
				'not-a-guid'
			];
			const result = extractUniqueGuids(data);
			assert.strictEqual(result.length, 2);
			assert.ok(result.includes('550e8400-e29b-41d4-a716-446655440000'));
			assert.ok(result.includes('6ba7b810-9dad-11d1-80b4-00c04fd430c8'));
		});

		test('should return empty array for no GUIDs', () => {
			const data = ['not-a-guid', 'also-not', 123];
			assert.deepStrictEqual(extractUniqueGuids(data), []);
		});

		test('should handle empty array', () => {
			assert.deepStrictEqual(extractUniqueGuids([]), []);
		});
	});

	suite('isLikelyIdentityColumn', () => {
		test('should return true for known identity column names', () => {
			assert.strictEqual(isLikelyIdentityColumn('principalId'), true);
			assert.strictEqual(isLikelyIdentityColumn('objectId'), true);
			assert.strictEqual(isLikelyIdentityColumn('userId'), true);
			assert.strictEqual(isLikelyIdentityColumn('groupId'), true);
			assert.strictEqual(isLikelyIdentityColumn('applicationId'), true);
			assert.strictEqual(isLikelyIdentityColumn('servicePrincipalId'), true);
			assert.strictEqual(isLikelyIdentityColumn('clientId'), true);
			assert.strictEqual(isLikelyIdentityColumn('assignedTo'), true);
			assert.strictEqual(isLikelyIdentityColumn('createdBy'), true);
			assert.strictEqual(isLikelyIdentityColumn('modifiedBy'), true);
			assert.strictEqual(isLikelyIdentityColumn('ownerId'), true);
		});

		test('should be case-insensitive', () => {
			assert.strictEqual(isLikelyIdentityColumn('PRINCIPALID'), true);
			assert.strictEqual(isLikelyIdentityColumn('PrincipalId'), true);
			assert.strictEqual(isLikelyIdentityColumn('principalid'), true);
		});

		test('should handle columns with separators', () => {
			assert.strictEqual(isLikelyIdentityColumn('principal_id'), true);
			assert.strictEqual(isLikelyIdentityColumn('principal-id'), true);
			assert.strictEqual(isLikelyIdentityColumn('principal id'), true);
		});

		test('should return true for columns ending with "id"', () => {
			assert.strictEqual(isLikelyIdentityColumn('somethingId'), true);
			assert.strictEqual(isLikelyIdentityColumn('customEntityId'), true);
		});

		test('should return false for non-identity columns', () => {
			assert.strictEqual(isLikelyIdentityColumn('name'), false);
			assert.strictEqual(isLikelyIdentityColumn('location'), false);
			assert.strictEqual(isLikelyIdentityColumn('type'), false);
			assert.strictEqual(isLikelyIdentityColumn('resourceGroup'), false);
		});
	});

	suite('shouldShowResolveButton', () => {
		test('should return true when column is likely identity AND contains GUIDs', () => {
			const guidData = [
				'550e8400-e29b-41d4-a716-446655440000',
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8'
			];
			assert.strictEqual(shouldShowResolveButton('principalId', guidData), true);
		});

		test('should return false when column name is not identity-related', () => {
			const guidData = [
				'550e8400-e29b-41d4-a716-446655440000',
				'6ba7b810-9dad-11d1-80b4-00c04fd430c8'
			];
			assert.strictEqual(shouldShowResolveButton('name', guidData), false);
		});

		test('should return false when data does not contain GUIDs', () => {
			const nonGuidData = ['not-a-guid', 'also-not'];
			assert.strictEqual(shouldShowResolveButton('principalId', nonGuidData), false);
		});

		test('should return false when both conditions fail', () => {
			assert.strictEqual(shouldShowResolveButton('name', ['not-a-guid']), false);
		});
	});

	suite('IDENTITY_GUID_COLUMN_NAMES', () => {
		test('should be a non-empty array', () => {
			assert.ok(Array.isArray(IDENTITY_GUID_COLUMN_NAMES));
			assert.ok(IDENTITY_GUID_COLUMN_NAMES.length > 0);
		});

		test('should contain expected column name patterns', () => {
			assert.ok(IDENTITY_GUID_COLUMN_NAMES.includes('principalid'));
			assert.ok(IDENTITY_GUID_COLUMN_NAMES.includes('objectid'));
			assert.ok(IDENTITY_GUID_COLUMN_NAMES.includes('userid'));
		});
	});
});
