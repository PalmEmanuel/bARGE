import * as assert from 'assert';
import { VSCodeCredential } from '../azure/vsCodeCredential';

suite('VSCodeCredential Tests', () => {

	// Create a mock session for testing
	function createMockSession(accessToken?: string): any {
		return {
			id: 'test-session-id',
			accessToken: accessToken || 'mock-access-token',
			account: {
				id: 'test-account-id',
				label: 'test@example.com'
			},
			scopes: ['https://management.azure.com/.default']
		};
	}

	suite('constructor and getCurrentSession', () => {
		test('should store and return the session', () => {
			const mockSession = createMockSession();
			const credential = new VSCodeCredential(mockSession);

			const session = credential.getCurrentSession();
			assert.strictEqual(session.id, 'test-session-id');
			assert.strictEqual(session.account.label, 'test@example.com');
		});
	});

	suite('getToken', () => {
		test('should return token from session', async () => {
			const mockSession = createMockSession('my-test-token');
			const credential = new VSCodeCredential(mockSession);

			const result = await credential.getToken();
			assert.ok(result, 'Should return a token result');
			assert.strictEqual(result!.token, 'my-test-token');
			assert.ok(result!.expiresOnTimestamp > 0, 'Should have a valid expiration timestamp');
		});

		test('should return default expiration when token is not a valid JWT', async () => {
			const mockSession = createMockSession('not-a-jwt-token');
			const credential = new VSCodeCredential(mockSession);

			const result = await credential.getToken();
			assert.ok(result, 'Should return a token result');
			// Default expiration is 1 hour from now
			const oneHourFromNow = Date.now() + (60 * 60 * 1000);
			assert.ok(
				Math.abs(result!.expiresOnTimestamp - oneHourFromNow) < 5000,
				'Should default to approximately 1 hour expiration'
			);
		});

		test('should parse expiration from valid JWT payload', async () => {
			// Create a mock JWT with exp claim
			const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
			const payload = JSON.stringify({ exp: futureExp, sub: 'test' });
			const encodedPayload = Buffer.from(payload).toString('base64url');
			const mockJwt = `header.${encodedPayload}.signature`;

			const mockSession = createMockSession(mockJwt);
			const credential = new VSCodeCredential(mockSession);

			const result = await credential.getToken();
			assert.ok(result, 'Should return a token result');
			assert.strictEqual(result!.expiresOnTimestamp, futureExp * 1000, 'Should parse exp from JWT');
		});

		test('should handle unparseable JWT payload gracefully', async () => {
			// Token with valid base64 but invalid JSON to exercise the catch path
			// without triggering alarming InvalidCharacterError from atob
			const invalidPayload = Buffer.from('not-json').toString('base64');
			const token = `header.${invalidPayload}.signature`;
			const mockSession = createMockSession(token);
			const credential = new VSCodeCredential(mockSession);

			const result = await credential.getToken();
			assert.ok(result, 'Should still return a token result');
			assert.strictEqual(result!.token, token);
			// Should fall back to default expiration
			const oneHourFromNow = Date.now() + (60 * 60 * 1000);
			assert.ok(
				Math.abs(result!.expiresOnTimestamp - oneHourFromNow) < 5000,
				'Should fall back to default expiration on unparseable JWT'
			);
		});

		test('should handle scopes parameter', async () => {
			const mockSession = createMockSession('test-token');
			const credential = new VSCodeCredential(mockSession);

			// Should work with string scope
			const result1 = await credential.getToken('https://management.azure.com/.default');
			assert.ok(result1, 'Should return token with string scope');

			// Should work with array of scopes
			const result2 = await credential.getToken(['https://management.azure.com/.default']);
			assert.ok(result2, 'Should return token with array scope');
		});
	});
});
