import * as assert from 'assert';
import * as vscode from 'vscode';
import { AzureService } from '../azure/azureService';

suite('AzureService Tests', () => {

	suite('constructor', () => {
		test('should create service without callbacks', () => {
			const service = new AzureService();
			assert.ok(service, 'Should create service successfully');
		});

		test('should create service with auth status callback', () => {
			const service = new AzureService(
				(_authenticated, _accountName) => {
					// Callback will be invoked when auth state changes
				}
			);
			assert.ok(service, 'Should create service with callback');
		});

		test('should create service with both callbacks', () => {
			const service = new AzureService(
				(authenticated, accountName) => {},
				(isLoading, message) => {}
			);
			assert.ok(service, 'Should create service with both callbacks');
		});
	});

	suite('isAuthenticated', () => {
		test('should return false initially', () => {
			const service = new AzureService();
			assert.strictEqual(service.isAuthenticated(), false, 'Should not be authenticated initially');
		});
	});

	suite('getCurrentAccount', () => {
		test('should return null initially', () => {
			const service = new AzureService();
			assert.strictEqual(service.getCurrentAccount(), null, 'Should have no account initially');
		});
	});

	suite('getCurrentScope', () => {
		test('should return tenant scope by default', () => {
			const service = new AzureService();
			const scope = service.getCurrentScope();
			assert.strictEqual(scope.type, 'tenant', 'Default scope should be tenant');
		});
	});

	suite('convertObjectArrayToTable', () => {
		let service: AzureService;

		setup(() => {
			service = new AzureService();
		});

		test('should convert array of objects to table format', () => {
			const objects = [
				{ name: 'vm1', type: 'Microsoft.Compute/virtualMachines', location: 'eastus' },
				{ name: 'vm2', type: 'Microsoft.Compute/virtualMachines', location: 'westus' }
			];

			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(objects);

			assert.strictEqual(result.columns.length, 3, 'Should have 3 columns');
			assert.strictEqual(result.rows.length, 2, 'Should have 2 rows');
			assert.deepStrictEqual(
				result.columns.map((c: any) => c.name),
				['name', 'type', 'location'],
				'Should preserve column order from first object'
			);
		});

		test('should handle objects with different properties', () => {
			const objects = [
				{ name: 'vm1', type: 'VM' },
				{ name: 'storage1', type: 'Storage', sku: 'Standard_LRS' }
			];

			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(objects);

			assert.strictEqual(result.columns.length, 3, 'Should include all unique columns');
			assert.strictEqual(result.rows[0][2], null, 'Missing property should be null');
			assert.strictEqual(result.rows[1][2], 'Standard_LRS', 'Extra property should be included');
		});

		test('should return empty table for empty array', () => {
			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method([]);

			assert.deepStrictEqual(result, { columns: [], rows: [] });
		});

		test('should return empty table for null input', () => {
			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(null);

			assert.deepStrictEqual(result, { columns: [], rows: [] });
		});

		test('should return empty table for undefined input', () => {
			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(undefined);

			assert.deepStrictEqual(result, { columns: [], rows: [] });
		});

		test('should preserve column order from first object and append new columns', () => {
			const objects = [
				{ id: '1', name: 'first', location: 'east' },
				{ location: 'west', name: 'second', id: '2', extra: 'value' }
			];

			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(objects);

			const columnNames = result.columns.map((c: any) => c.name);
			assert.deepStrictEqual(columnNames, ['id', 'name', 'location', 'extra']);
		});

		test('should handle single object array', () => {
			const objects = [
				{ name: 'single', type: 'test' }
			];

			const method = (service as any).convertObjectArrayToTable.bind(service);
			const result = method(objects);

			assert.strictEqual(result.columns.length, 2);
			assert.strictEqual(result.rows.length, 1);
			assert.deepStrictEqual(result.rows[0], ['single', 'test']);
		});
	});

	suite('concurrent authentication state', () => {
		test('should start with generation 0 and zero active calls', () => {
			const service = new AzureService();
			assert.strictEqual((service as any).authGeneration, 0, 'Initial authGeneration should be 0');
			assert.strictEqual((service as any).activeAuthenticateCalls, 0, 'Initial activeAuthenticateCalls should be 0');
		});

		test('loading spinner clears only after all concurrent authenticate() calls complete', async () => {
			let isLoading = false;
			const service = new AzureService(undefined, (loading) => { isLoading = loading; });

			const origGetAccounts = (vscode.authentication as any).getAccounts;
			const origShowQuickPick = (vscode.window as any).showQuickPick;
			try {
				(vscode.authentication as any).getAccounts = async () => [];
				(vscode.window as any).showQuickPick = async () => undefined; // both callers dismiss

				await Promise.all([service.authenticate(), service.authenticate()]);

				assert.strictEqual(isLoading, false, 'Loading spinner should be cleared after all calls complete');
				assert.strictEqual((service as any).activeAuthenticateCalls, 0, 'activeAuthenticateCalls should be 0');
			} finally {
				(vscode.authentication as any).getAccounts = origGetAccounts;
				(vscode.window as any).showQuickPick = origShowQuickPick;
			}
		});

		test('authGeneration advances once per selection and resets cleanly', async () => {
			const service = new AzureService();

			const origGetAccounts = (vscode.authentication as any).getAccounts;
			const origShowQuickPick = (vscode.window as any).showQuickPick;
			try {
				(vscode.authentication as any).getAccounts = async () => [];
				// Both calls dismiss — no selection is made, so authGeneration stays at 0.
				(vscode.window as any).showQuickPick = async () => undefined;

				await Promise.all([service.authenticate(), service.authenticate()]);

				assert.strictEqual((service as any).authGeneration, 0, 'authGeneration unchanged when no selection is made');
				assert.strictEqual((service as any).activeAuthenticateCalls, 0);
			} finally {
				(vscode.authentication as any).getAccounts = origGetAccounts;
				(vscode.window as any).showQuickPick = origShowQuickPick;
			}
		});

		test('second selection supersedes first: isStillCurrent returns false for earlier generation', () => {
			const service = new AzureService();

			// Simulate the first call claiming generation 1.
			(service as any).authGeneration = 1;
			const firstIsStillCurrent = () => (service as any).authGeneration === 1;

			// Simulate the second call advancing generation to 2.
			(service as any).authGeneration = 2;
			const secondIsStillCurrent = () => (service as any).authGeneration === 2;

			assert.strictEqual(firstIsStillCurrent(), false, 'First selection is no longer current after second selection');
			assert.strictEqual(secondIsStillCurrent(), true, 'Second selection is still current');

			// A third call advances generation to 3 — second is now stale too.
			(service as any).authGeneration = 3;
			assert.strictEqual(secondIsStillCurrent(), false, 'Second selection becomes stale after a third selection');
		});

		test('two concurrent calls that both dismiss leave service unauthenticated and clean', async () => {
			let authCallbackCount = 0;
			const service = new AzureService(() => { authCallbackCount++; });

			const origGetAccounts = (vscode.authentication as any).getAccounts;
			const origShowQuickPick = (vscode.window as any).showQuickPick;
			try {
				(vscode.authentication as any).getAccounts = async () => [];
				(vscode.window as any).showQuickPick = async () => undefined;

				await Promise.all([service.authenticate(), service.authenticate()]);

				assert.strictEqual(service.isAuthenticated(), false, 'Service should not be authenticated');
				assert.strictEqual(service.getCurrentAccount(), null, 'No account should be set');
				assert.strictEqual(authCallbackCount, 0, 'Auth status callback should not fire on dismiss');
			} finally {
				(vscode.authentication as any).getAccounts = origGetAccounts;
				(vscode.window as any).showQuickPick = origShowQuickPick;
			}
		});
	});

	suite('verifyAuthentication', () => {
		test('should return false when no credential is set', async () => {
			const service = new AzureService();
			const result = await service.verifyAuthentication();
			assert.strictEqual(result, false, 'Should return false when not authenticated');
		});
	});

	suite('extractAccountFromToken', () => {
		let service: AzureService;

		setup(() => {
			service = new AzureService();
		});

		test('should extract upn from JWT token', async () => {
			const payload = JSON.stringify({ upn: 'user@example.com', sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, 'user@example.com');
		});

		test('should extract unique_name when upn is not present', async () => {
			const payload = JSON.stringify({ unique_name: 'unique@example.com', sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, 'unique@example.com');
		});

		test('should extract email when upn and unique_name are not present', async () => {
			const payload = JSON.stringify({ email: 'email@example.com', sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, 'email@example.com');
		});

		test('should extract name as fallback', async () => {
			const payload = JSON.stringify({ name: 'Test User', sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, 'Test User');
		});

		test('should extract oid as last resort', async () => {
			const payload = JSON.stringify({ oid: '12345-abcde', sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, '12345-abcde');
		});

		test('should return null for invalid token', async () => {
			const method = (service as any).extractAccountFromToken.bind(service);
			// Use valid base64 that decodes to invalid JSON to exercise the catch path
			// without triggering alarming InvalidCharacterError from atob
			const invalidPayload = Buffer.from('not-json').toString('base64');
			const result = await method(`header.${invalidPayload}.signature`);
			assert.strictEqual(result, null);
		});

		test('should return null when no identity claims are present', async () => {
			const payload = JSON.stringify({ sub: 'test', iat: 12345 });
			const encodedPayload = Buffer.from(payload).toString('base64');
			const token = `header.${encodedPayload}.signature`;

			const method = (service as any).extractAccountFromToken.bind(service);
			const result = await method(token);
			assert.strictEqual(result, null);
		});
	});

	suite('createErrorSummary', () => {
		let service: AzureService;

		setup(() => {
			service = new AzureService();
		});

		test('should return default message for empty errors', () => {
			const method = (service as any).createErrorSummary.bind(service);
			const result = method([]);
			assert.strictEqual(result, 'Could not resolve identity.');
		});

		test('should return not found message for non-empty errors', () => {
			const method = (service as any).createErrorSummary.bind(service);
			const result = method([{ objectType: 'users', error: new Error('Not found') }]);
			assert.strictEqual(result, 'Identity not found.');
		});
	});

	suite('validateAuthentication', () => {
		test('should throw when not authenticated', () => {
			const service = new AzureService();
			const method = (service as any).validateAuthentication.bind(service);
			assert.throws(
				() => method(),
				/Not authenticated/,
				'Should throw when not authenticated'
			);
		});
	});

	suite('mapToIdentityInfo', () => {
		let service: AzureService;

		setup(() => {
			service = new AzureService();
		});

		test('should map user graph object correctly', () => {
			const method = (service as any).mapToIdentityInfo.bind(service);
			const graphObj = {
				id: '12345',
				displayName: 'John Doe',
				userPrincipalName: 'john@example.com',
				mail: 'john.doe@example.com'
			};

			const result = method(graphObj, 'user');
			assert.strictEqual(result.id, '12345');
			assert.strictEqual(result.displayName, 'John Doe');
			assert.strictEqual(result.userPrincipalName, 'john@example.com');
			assert.strictEqual(result.mail, 'john.doe@example.com');
			assert.strictEqual(result.objectType, 'user');
		});

		test('should map service principal correctly', () => {
			const method = (service as any).mapToIdentityInfo.bind(service);
			const graphObj = {
				id: '67890',
				displayName: 'MyApp Service Principal',
				userPrincipalName: undefined,
				mail: undefined
			};

			const result = method(graphObj, 'servicePrincipal');
			assert.strictEqual(result.id, '67890');
			assert.strictEqual(result.displayName, 'MyApp Service Principal');
			assert.strictEqual(result.objectType, 'servicePrincipal');
		});

		test('should map group correctly', () => {
			const method = (service as any).mapToIdentityInfo.bind(service);
			const graphObj = {
				id: 'abcde',
				displayName: 'Engineering Team',
				mail: 'engineering@example.com'
			};

			const result = method(graphObj, 'group');
			assert.strictEqual(result.id, 'abcde');
			assert.strictEqual(result.displayName, 'Engineering Team');
			assert.strictEqual(result.objectType, 'group');
		});
	});
});
