import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Playwright-based webview tests run separately via `npm run test:webview`
	exclude: ['**/webview.interactive.test.js'],
});
