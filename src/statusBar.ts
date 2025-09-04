import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private sessionChangeListener: vscode.Disposable;

    constructor(onAuthSessionChange?: () => Promise<void>) {
        // Create status bar item with compass icon on the right side
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            150 // Priority (higher numbers appear more to the left)
        );

        // Set the compass icon and command
        this.statusBarItem.command = 'barge.authenticate';
        this.statusBarItem.tooltip = 'bARGE: Click to sign in or switch account';
        
        // Show as not authenticated initially
        this.updateStatusNotAuthenticated();
        this.statusBarItem.show();

        // Listen for Microsoft authentication session changes
        this.sessionChangeListener = vscode.authentication.onDidChangeSessions(async (e: vscode.AuthenticationSessionsChangeEvent) => {
            if (e.provider.id === 'microsoft' && onAuthSessionChange) {
                try {
                    await onAuthSessionChange();
                } catch (error) {
                    console.error('bARGE: Error handling authentication session change:', error);
                }
            }
        });
    }

    public updateStatusAuthenticated(accountName: string): void {
        this.statusBarItem.text = `$(compass-active) ${accountName}`;
        this.statusBarItem.tooltip = `bARGE: Authenticated as ${accountName}. Click to switch account`;
        this.statusBarItem.backgroundColor = undefined; // Clear any error background
    }

    public updateStatusNotAuthenticated(): void {
        this.statusBarItem.text = `$(compass) Not signed in`;
        this.statusBarItem.tooltip = 'bARGE: Click to sign in';
        this.statusBarItem.backgroundColor = undefined; // Clear any error background
    }

    public updateStatusLoading(message: string): void {
        this.statusBarItem.text = `$(loading~spin) ${message}`;
        this.statusBarItem.tooltip = `bARGE: ${message}`;
        this.statusBarItem.backgroundColor = undefined; // Clear any error background
    }

    public updateStatusError(message: string): void {
        this.statusBarItem.text = `$(compass-dot) Authentication Error`;
        this.statusBarItem.tooltip = `bARGE: ${message}. Click to retry`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    public dispose(): void {
        this.statusBarItem.dispose();
        this.sessionChangeListener.dispose();
    }
}
