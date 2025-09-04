
import * as vscode from 'vscode';
import { TokenCredential } from '@azure/identity';

// VS Code credential wrapper that uses built-in Microsoft authentication
export class VSCodeCredential implements TokenCredential {
    private currentSession: vscode.AuthenticationSession | null = null;

    async forceNewSession(account?: vscode.AuthenticationSessionAccountInformation): Promise<vscode.AuthenticationSession | null> {
        try {
            const session = await vscode.authentication.getSession(
                'microsoft',
                ['https://management.azure.com/.default'],
                {
                    forceNewSession: true,
                    account: account
                }
            );
            this.currentSession = session;
            return session;
        } catch (error) {
            console.error('Failed to force new authentication session:', error);
            return null;
        }
    }

    getCurrentSession(): vscode.AuthenticationSession | null {
        return this.currentSession;
    }

    async getToken(scopes?: string | string[], options?: any): Promise<{ token: string; expiresOnTimestamp: number } | null> {
        try {
            // Ensure we have a valid scopes array, default to Azure management scope
            const scopesArray = Array.isArray(scopes) 
                ? scopes 
                : scopes 
                    ? [scopes] 
                    : ['https://management.azure.com/.default'];

            // Get current session or create new one silently
            const session = await vscode.authentication.getSession(
                'microsoft',
                scopesArray,
                { createIfNone: true }
            );

            if (!session) {
                return null;
            }

            this.currentSession = session;

            // Parse token expiration from JWT
            let expiresOnTimestamp = Date.now() + (60 * 60 * 1000); // Default 1 hour
            try {
                const tokenParts = session.accessToken.split('.');
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
                token: session.accessToken,
                expiresOnTimestamp
            };
        } catch (error) {
            console.error('Failed to get token from VS Code authentication:', error);
            return null;
        }
    }
}
