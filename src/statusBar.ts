import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private sessionChangeListener: vscode.Disposable;
    private tooltipSuppressed = false;
    private lastTextBeforeSuppress: string | undefined;

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

    private setTooltip(value: string): void {
        if (this.tooltipSuppressed) {
            // Lift suppression once the status bar text changes from what it
            // was when suppression started (i.e. the auth state transitioned).
            if (this.statusBarItem.text !== this.lastTextBeforeSuppress) {
                this.tooltipSuppressed = false;
            } else {
                return;
            }
        }
        this.statusBarItem.tooltip = value;
    }

    /**
     * Suppress tooltip updates until the status bar text changes, preventing
     * the tooltip from flashing when the item still has focus after a quick
     * pick closes.
     */
    public suppressTooltip(): void {
        this.statusBarItem.tooltip = '';
        this.tooltipSuppressed = true;
        this.lastTextBeforeSuppress = this.statusBarItem.text;
    }

    public updateStatusAuthenticated(accountName: string): void {
        this.statusBarItem.text = `$(compass-active) ${accountName}`;
        this.setTooltip(`bARGE: Authenticated as ${accountName}. Click to switch account`);
        this.statusBarItem.backgroundColor = undefined;
    }

    public updateStatusNotAuthenticated(): void {
        this.statusBarItem.text = `$(compass) Not signed in`;
        this.setTooltip('bARGE: Click to sign in');
        this.statusBarItem.backgroundColor = undefined;
    }

    public updateStatusLoading(message: string): void {
        this.statusBarItem.text = `$(loading~spin) ${message}`;
        this.setTooltip(`bARGE: ${message}`);
        this.statusBarItem.backgroundColor = undefined;
    }

    public updateStatusError(message: string): void {
        this.statusBarItem.text = `$(compass-dot) Authentication Error`;
        this.setTooltip(`bARGE: ${message}. Click to retry`);
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    public dispose(): void {
        this.statusBarItem.dispose();
        this.sessionChangeListener.dispose();
    }
}
