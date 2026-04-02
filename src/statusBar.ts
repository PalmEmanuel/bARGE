import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private sessionChangeListener: vscode.Disposable;
    private tooltipSuppressTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (this.tooltipSuppressTimer) {
            return;
        }
        this.statusBarItem.tooltip = value;
    }

    /**
     * Suppress tooltip updates for a period (e.g. while a quick pick is open
     * and during the subsequent auth flow). Prevents the tooltip from flashing
     * when the status bar item still has focus after the picker closes.
     */
    public suppressTooltip(durationMs: number = 10000): void {
        this.statusBarItem.tooltip = '';
        if (this.tooltipSuppressTimer) {
            clearTimeout(this.tooltipSuppressTimer);
        }
        this.tooltipSuppressTimer = setTimeout(() => {
            this.tooltipSuppressTimer = undefined;
        }, durationMs);
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
        if (this.tooltipSuppressTimer) {
            clearTimeout(this.tooltipSuppressTimer);
        }
        this.statusBarItem.dispose();
        this.sessionChangeListener.dispose();
    }
}
