
import * as vscode from 'vscode';
import { TokenCredential } from '@azure/identity';

// VS Code credential wrapper that uses built-in Microsoft authentication
export class VSCodeCredential implements TokenCredential {
    private currentSession: vscode.AuthenticationSession;

    constructor(session: vscode.AuthenticationSession) {
        this.currentSession = session;
    }

    getCurrentSession(): vscode.AuthenticationSession {
        return this.currentSession;
    }

    async getToken(scopes?: string | string[], options?: any): Promise<{ token: string; expiresOnTimestamp: number } | null> {
        try {
            const token = this.currentSession.accessToken;

            // Parse token expiration from JWT
            let expiresOnTimestamp = Date.now() + (60 * 60 * 1000); // Default 1 hour
            try {
                const tokenParts = token.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    if (payload.exp) {
                        expiresOnTimestamp = payload.exp * 1000;
                    }
                }
            } catch (error) {
                console.warn('Could not parse token expiration:', error);
            }

            return {
                token: token,
                expiresOnTimestamp
            };
        } catch (error) {
            console.error('Failed to get token from VS Code authentication:', error);
            return null;
        }
    }
}
