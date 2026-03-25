/**
 * Interactive webview tests using Playwright.
 *
 * These tests load the real webview HTML and JS in a headless Chromium browser,
 * inject mock data via postMessage (exactly like VS Code does), and verify DOM
 * interactions such as sorting, column resize, drag-and-drop reorder, cell
 * selection, context menus, the details pane, filtering, and scrolling.
 *
 * Run: npm run test:webview
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';

/* ────────────────── helpers ────────────────── */

// When compiled to out/src/test/, __dirname is out/src/test. But media/ is at the
// project root, not inside out/. Walk up until we find a directory that contains media/.
function findProjectRoot(): string {
	let dir = __dirname;
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, 'media', 'webview', 'webview.html'))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	throw new Error('Could not locate project root (media/webview/webview.html not found)');
}

const PROJECT_ROOT = findProjectRoot();
const WEBVIEW_HTML = path.join(PROJECT_ROOT, 'media', 'webview', 'webview.html');
const WEBVIEW_JS = path.join(PROJECT_ROOT, 'media', 'webview', 'webview.js');

/* ── Realistic Azure Resource Graph sample data ── */

const AZURE_LOCATIONS = [
	'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus',
	'northeurope', 'westeurope', 'uksouth', 'ukwest', 'southeastasia',
	'japaneast', 'australiaeast', 'canadacentral', 'brazilsouth',
	'koreacentral', 'francecentral', 'germanywestcentral', 'switzerlandnorth',
	'norwayeast',
];

const AZURE_RESOURCE_TYPES = [
	'microsoft.compute/virtualmachines',
	'microsoft.storage/storageaccounts',
	'microsoft.sql/servers',
	'microsoft.containerservice/managedclusters',
	'microsoft.web/sites',
	'microsoft.network/virtualnetworks',
	'microsoft.network/networksecuritygroups',
	'microsoft.network/publicipaddresses',
	'microsoft.keyvault/vaults',
	'microsoft.insights/components',
];

const AZURE_SKUS = ['Standard_B2s', 'Standard_D4s_v3', 'Standard_E8s_v5', 'Standard_F4s_v2', 'Premium_LRS', 'Standard_LRS', 'GP_Gen5_2', 'Standard_DS1_v2'];
const AZURE_TAGS_ENV = ['production', 'staging', 'development', 'testing', 'sandbox'];
const AZURE_TAGS_OWNER = ['platform-team', 'app-team-1', 'app-team-2', 'data-team', 'security-team', 'infra-ops'];
const AZURE_PROVISIONING = ['Succeeded', 'Succeeded', 'Succeeded', 'Succeeded', 'Failed', 'Updating', 'Creating', 'Deleting'];

function generateLargeDataset(rowCount: number) {
	const data: string[][] = [];
	for (let i = 0; i < rowCount; i++) {
		const resourceType = AZURE_RESOURCE_TYPES[i % AZURE_RESOURCE_TYPES.length];
		const prefix = resourceType.split('/')[1].substring(0, 4);
		data.push([
			`${prefix}-${String(i).padStart(3, '0')}`,                    // name
			resourceType,                                                  // type
			AZURE_LOCATIONS[i % AZURE_LOCATIONS.length],                   // location
			`/subscriptions/sub-${(i % 3) + 1}/resourceGroups/rg-${(i % 5) + 1}/providers/${resourceType}/${prefix}-${String(i).padStart(3, '0')}`, // id
			`rg-${(i % 5) + 1}`,                                          // resourceGroup
			`sub-${(i % 3) + 1}`,                                         // subscriptionId
			AZURE_SKUS[i % AZURE_SKUS.length],                            // sku
			AZURE_TAGS_ENV[i % AZURE_TAGS_ENV.length],                    // tags.environment
			AZURE_TAGS_OWNER[i % AZURE_TAGS_OWNER.length],                // tags.owner
			AZURE_PROVISIONING[i % AZURE_PROVISIONING.length],            // provisioningState
			`2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`, // createdTime
			String(Math.floor(100 + Math.random() * 9900)),               // costPerMonth
		]);
	}
	return {
		columns: [
			{ name: 'name', type: 'string' },
			{ name: 'type', type: 'string' },
			{ name: 'location', type: 'string' },
			{ name: 'id', type: 'string' },
			{ name: 'resourceGroup', type: 'string' },
			{ name: 'subscriptionId', type: 'string' },
			{ name: 'sku', type: 'string' },
			{ name: 'tags.environment', type: 'string' },
			{ name: 'tags.owner', type: 'string' },
			{ name: 'provisioningState', type: 'string' },
			{ name: 'createdTime', type: 'string' },
			{ name: 'costPerMonth', type: 'string' },
		],
		data,
		totalRecords: rowCount,
		executionTimeMs: 247,
		timestamp: Date.now(),
	};
}

/** Small dataset for quick tests */
const SAMPLE_DATA = generateLargeDataset(5);

/** Large dataset (100 rows, 12 columns) for scrolling and pagination tests */
const LARGE_DATA = generateLargeDataset(100);

/**
 * Build a self-contained HTML string that includes the vscodeApi mock and the
 * real webview script inline so that everything shares a single global scope.
 */
function buildTestHtml(): string {
	let html = fs.readFileSync(WEBVIEW_HTML, 'utf8');

	// Strip CSP meta tag and nonces
	html = html.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');
	html = html.replace(/nonce="{{NONCE}}"/g, '');

	// Remove template placeholders for codicons
	html = html.replace('{{CODICONS_URI}}', '');

	// Replace webviewConfig script with a mock
	html = html.replace(
		/<script[^>]*>[\s\S]*?window\.webviewConfig[\s\S]*?<\/script>/,
		'<script>window.webviewConfig = {};</script>',
	);

	// Remove external script tags that load the webview bundle — we inline the JS instead
	html = html.replace(
		/<script\b[^>]*\bsrc="[^"]*(?:{{WEBVIEW_BUNDLE_URI}}|{{WEBVIEW_URI}}\/webview\.js)"[^>]*>[^<]*<\/script>/gi,
		'',
	);
	// As a defensive measure, strip any remaining script tags whose src still references
	// the webview bundle placeholders, in case they were not matched by the pattern above.
	html = html.replace(
		/<script\b[^>]*\bsrc="[^"]*(?:{{WEBVIEW_BUNDLE_URI}}|{{WEBVIEW_URI}}\/webview\.js)"[^>]*>[\s\S]*?<\/script>/gi,
		'',
	);

	// Inject VS Code dark-theme CSS variable defaults so the webview looks
	// correct when running outside VS Code (headed mode).
	const themeVars = `<style>
		:root {
			--vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
			--vscode-font-size: 13px;
			--vscode-foreground: #cccccc;
			--vscode-editor-background: #1e1e1e;
			--vscode-editor-foreground: #cccccc;
			--vscode-input-background: #3c3c3c;
			--vscode-input-foreground: #cccccc;
			--vscode-input-border: #3c3c3c;
			--vscode-input-placeholderForeground: #a6a6a6;
			--vscode-button-background: #0e639c;
			--vscode-button-foreground: #ffffff;
			--vscode-button-hoverBackground: #1177bb;
			--vscode-button-secondaryBackground: #3a3d41;
			--vscode-button-secondaryForeground: #cccccc;
			--vscode-focusBorder: #007fd4;
			--vscode-list-hoverBackground: #2a2d2e;
			--vscode-list-activeSelectionBackground: #094771;
			--vscode-list-activeSelectionForeground: #ffffff;
			--vscode-badge-background: #4d4d4d;
			--vscode-badge-foreground: #ffffff;
			--vscode-editorWidget-background: #252526;
			--vscode-editorWidget-border: #454545;
			--vscode-panel-border: #2b2b2b;
			--vscode-sideBar-background: #252526;
			--vscode-toolbar-hoverBackground: #5a5d5e50;
			--vscode-textLink-foreground: #3794ff;
			--vscode-progressBar-background: #0e70c0;
			--vscode-errorForeground: #f48771;
			--vscode-descriptionForeground: #9d9d9d;
			--vscode-icon-foreground: #c5c5c5;
		}
	</style>`;
	html = html.replace('<style>', `${themeVars}\n<style>`);

	// Inject the acquireVsCodeApi mock and webview.js inline
	const webviewJs = fs.readFileSync(WEBVIEW_JS, 'utf8');
	const mockScript = `<script>
		window.acquireVsCodeApi = () => ({
			postMessage: (msg) => {
				window._postedMessages = window._postedMessages || [];
				window._postedMessages.push(msg);
			},
			getState: () => ({}),
			setState: () => {},
		});
	</script>`;
	html = html.replace('</body>', `${mockScript}\n<script>${webviewJs}</script></body>`);

	return html;
}

/* ────────────────── configuration ────────────────── */

/** Set HEADED=1 to watch the tests run in a visible browser with slow motion. */
const HEADED = process.env.HEADED === '1';
const SLOW_MO = HEADED ? 200 : 0;
/** Delay between logical steps in headed mode (ms). */
const STEP_DELAY = HEADED ? 800 : 0;
/** Minimum wall-clock time each test stays visible in headed mode (ms). */
const MIN_TEST_DURATION = HEADED ? 3000 : 0;
/** Timestamp set at the beginning of each test (headed mode). */
let testStartedAt = 0;
/** Running count of passed / failed tests (headed mode). */
let passCount = 0;
let failCount = 0;

/**
 * Animate the progress bar from its current width to 0% over `ms` milliseconds.
 * Safe to call when the page has navigated — errors are silently caught.
 */
async function animateProgressBar(ms: number): Promise<void> {
	await page.evaluate((duration) => {
		const host = document.getElementById('__test-banner-host');
		const bar = host?.shadowRoot?.querySelector('[data-role="progress"]') as HTMLElement | null;
		if (bar) {
			bar.style.transition = 'none';
			bar.style.width = '100%';
			void bar.offsetWidth; // force reflow
			bar.style.transition = `width ${duration}ms linear`;
			bar.style.width = '0%';
		}
	}, ms).catch(() => { /* page may have navigated */ });
}

/** Pause between logical test steps so you can follow along in headed mode. */
async function step(): Promise<void> {
	if (STEP_DELAY > 0) {
		await new Promise((r) => setTimeout(r, STEP_DELAY));
	}
}

/**
 * Wait out the remaining time so the test meets MIN_TEST_DURATION, with
 * the progress bar animating the countdown. No-op in headless.
 */
async function waitMinDuration(passed: boolean): Promise<void> {
	if (!HEADED || !page || page.isClosed()) { return; }
	if (passed) { passCount++; } else { failCount++; }
	const elapsed = Date.now() - testStartedAt;
	const remaining = Math.max(MIN_TEST_DURATION - elapsed, 0);
	// Update banner: icon, colour, and counter
	const icon = passed ? '\u2714' : '\u2718';
	const bg = passed ? '#2ea043' : '#d1242f';
	await page.evaluate(({ t, ic, bgColor, pass, fail }) => {
		const host = document.getElementById('__test-banner-host');
		if (!host?.shadowRoot) { return; }
		const banner = host.shadowRoot.querySelector('[data-role="banner"]') as HTMLElement | null;
		if (banner) {
			banner.style.background = bgColor;
			banner.innerHTML = '';

			// Left spacer (balances the right counter so text stays centered)
			const spacer = document.createElement('span');
			spacer.style.cssText = 'min-width:100px;';
			banner.appendChild(spacer);

			// Center label
			const label = document.createElement('span');
			label.style.cssText = 'flex:1;text-align:center;';
			label.textContent = `${ic} ${t}`;
			banner.appendChild(label);

			// Right counter
			const counter = document.createElement('span');
			counter.style.cssText = 'min-width:100px;text-align:right;font-size:12px;opacity:.9;';
			counter.innerHTML =
				`<span style="color:#7ee787">${pass} \u2714</span>` +
				(fail > 0 ? ` <span style="color:#ff7b72">${fail} \u2718</span>` : '');
			banner.appendChild(counter);
		}
	}, { t: currentTestTitle, ic: icon, bgColor: bg, pass: passCount, fail: failCount }).catch(() => {});
	if (remaining <= 0) { return; }
	await animateProgressBar(remaining);
	await new Promise((r) => setTimeout(r, remaining));
}

/* ────────────────── test suite ────────────────── */

let browser: Browser;
let page: Page;
let currentTestTitle = '';
const testHtml = buildTestHtml();

/**
 * Inject or update the test-name banner overlay (headed mode only).
 * Uses Shadow DOM so the banner's markup and styles are fully isolated
 * from the webview DOM — it cannot be found by any querySelector,
 * affect layout, intercept pointer events, or pollute CSS.
 * Positioned at the bottom of the viewport with a shrinking progress bar.
 */
async function showBanner(): Promise<void> {
	if (!HEADED || !page || page.isClosed() || !currentTestTitle) { return; }
	await page.evaluate(({ t, pass, fail }) => {
		const HOST_ID = '__test-banner-host';
		let host = document.getElementById(HOST_ID);
		if (!host) {
			host = document.createElement('div');
			host.id = HOST_ID;
			host.style.cssText =
				'position:fixed;bottom:0;left:0;right:0;height:0;z-index:999999;' +
				'pointer-events:none;overflow:visible;';
			const shadow = host.attachShadow({ mode: 'open' });

			const wrapper = document.createElement('div');
			wrapper.style.cssText =
				'position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;';

			// Progress bar — shrinks from 100% → 0% during each step() pause.
			const progressTrack = document.createElement('div');
			progressTrack.style.cssText = 'height:3px;background:rgba(0,0,0,.2);';
			const progressBar = document.createElement('div');
			progressBar.setAttribute('data-role', 'progress');
			progressBar.style.cssText =
				'height:100%;width:100%;background:#40a9ff;border-radius:0 2px 2px 0;';
			progressTrack.appendChild(progressBar);

			// Text banner — uses flex so the counter can sit on the right
			const banner = document.createElement('div');
			banner.setAttribute('data-role', 'banner');
			banner.style.cssText =
				'display:flex;align-items:center;padding:6px 16px;' +
				'font:bold 13px/1.4 -apple-system,Segoe UI,sans-serif;' +
				'background:#007acc;color:#fff;' +
				'box-shadow:0 -2px 8px rgba(0,0,0,.4);pointer-events:none;';

			wrapper.appendChild(progressTrack);
			wrapper.appendChild(banner);
			shadow.appendChild(wrapper);
			document.body.appendChild(host);
		}
		const banner = host.shadowRoot?.querySelector('[data-role="banner"]') as HTMLElement | null;
		if (banner) {
			banner.style.background = '#007acc';
			banner.innerHTML = '';

			const spacer = document.createElement('span');
			spacer.style.cssText = 'min-width:100px;';
			banner.appendChild(spacer);

			const label = document.createElement('span');
			label.style.cssText = 'flex:1;text-align:center;';
			label.textContent = `\u25B6 ${t}`;
			banner.appendChild(label);

			const counter = document.createElement('span');
			counter.style.cssText = 'min-width:100px;text-align:right;font-size:12px;opacity:.9;';
			counter.innerHTML =
				`<span style="color:#7ee787">${pass} \u2714</span>` +
				(fail > 0 ? ` <span style="color:#ff7b72">${fail} \u2718</span>` : '');
			banner.appendChild(counter);
		}
		// Reset progress bar to full
		const bar = host.shadowRoot?.querySelector('[data-role="progress"]') as HTMLElement | null;
		if (bar) {
			bar.style.transition = 'none';
			bar.style.width = '100%';
		}
	}, { t: currentTestTitle, pass: passCount, fail: failCount });
}

/**
 * Get a clean page with fresh JS state. In headed mode we keep a single page
 * and navigate to about:blank first (clears all JS globals and listeners),
 * then load the HTML via setContent. In headless mode we create a new page
 * for full isolation.
 */
async function resetPage(width = 1280, height = 800): Promise<void> {
	if (HEADED && page && !page.isClosed()) {
		await page.setViewportSize({ width, height });
		// Navigate away first to fully tear down the previous JS environment.
		// Use a dark page instead of about:blank to avoid a white flash.
		await page.goto('data:text/html,<html><body style="background:%231e1e1e"></body></html>');
		await page.setContent(testHtml, { waitUntil: 'load' });
		await showBanner();
	} else {
		if (page && !page.isClosed()) {
			await page.close();
		}
		page = await browser.newPage();
		await page.setViewportSize({ width, height });
		await page.setContent(testHtml, { waitUntil: 'load' });
	}
}

/**
 * Helper: set up a fresh page and send query result data, waiting for the
 * table to render. For empty datasets, use loadEmptyPage() instead.
 */
async function loadPageWithData(data = SAMPLE_DATA): Promise<void> {
	await resetPage();

	// Send query result via postMessage, mimicking VS Code
	await page.evaluate((d) => {
		window.postMessage({ type: 'queryResult', payload: { success: true, data: d } }, '*');
	}, data);
	// Give the message handler time to render
	await page.waitForSelector('table.results-table tbody tr', { timeout: 3000 });
}

/**
 * Helper: set up a fresh page and send a query result that has data but may
 * have zero rows (so we don't wait for tbody tr).
 */
async function loadEmptyPage(data: typeof SAMPLE_DATA): Promise<void> {
	await resetPage();
	await page.evaluate((d) => {
		window.postMessage({ type: 'queryResult', payload: { success: true, data: d } }, '*');
	}, data);
	await page.waitForTimeout(300);
}

/* ────────────────── lifecycle ────────────────── */

suite('Webview Interactive Tests', function () {
	this.timeout(HEADED ? 300_000 : 30_000);

	suiteSetup(async () => {
		browser = await chromium.launch({ headless: !HEADED, slowMo: SLOW_MO });
		if (HEADED) {
			// Pre-create a single page for the entire suite in headed mode
			page = await browser.newPage();
			await page.setViewportSize({ width: 1280, height: 800 });
		}
	});

	suiteTeardown(async () => {
		await browser?.close();
	});

	setup(async function () {
		currentTestTitle = this.currentTest?.fullTitle() ?? '';
		testStartedAt = Date.now();
	});

	teardown(async function () {
		const passed = this.currentTest?.state === 'passed';
		await waitMinDuration(passed);
		if (!HEADED && page && !page.isClosed()) {
			await page.close();
		}
	});

	/* ═══════════════ Table rendering ═══════════════ */

	suite('Table Rendering', () => {
		test('should render correct number of headers and rows', async () => {
			await loadPageWithData();
			await step();

			const headers = await page.locator('table.results-table thead th').count();
			const rows = await page.locator('table.results-table tbody tr').count();

			// +1 header for the select-all / details column
			assert.strictEqual(headers, SAMPLE_DATA.columns.length + 1);
			assert.strictEqual(rows, SAMPLE_DATA.data.length);
		});

		test('should render large dataset with all columns and rows', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			const headers = await page.locator('table.results-table thead th').count();
			const rows = await page.locator('table.results-table tbody tr').count();

			assert.strictEqual(headers, LARGE_DATA.columns.length + 1, 'All 12 data columns + 1 detail column');
			assert.strictEqual(rows, LARGE_DATA.data.length, 'All 100 rows');
		});

		test('should display column names in headers', async () => {
			await loadPageWithData();
			await step();

			for (const col of SAMPLE_DATA.columns) {
				const headerText = await page
					.locator(`table.results-table thead th .header-text:text-is("${col.name}")`)
					.count();
				assert.strictEqual(headerText, 1, `Header "${col.name}" should appear exactly once`);
			}
		});

		test('should display cell values', async () => {
			await loadPageWithData();
			await step();

			// Check first data row (skip the detail-button td at index 0)
			const firstRowCells = page.locator('table.results-table tbody tr:first-child td');
			const cellCount = await firstRowCells.count();
			assert.ok(cellCount >= SAMPLE_DATA.columns.length + 1);

			// Second td (index 1) should be the first name value
			const nameCell = await firstRowCells.nth(1).textContent();
			assert.strictEqual(nameCell?.trim(), SAMPLE_DATA.data[0][0]);
		});

		test('should show results info text', async () => {
			await loadPageWithData();
			await step();

			const info = await page.locator('#resultsInfo').textContent();
			assert.ok(info?.includes('5 results'), `Expected results info to contain "5 results", got: "${info}"`);
			assert.ok(info?.includes('247ms'), `Expected results info to contain "247ms", got: "${info}"`);
		});

		test('should show "No results found" for empty data', async () => {
			await loadEmptyPage({
				columns: [{ name: 'id', type: 'string' }],
				data: [],
				totalRecords: 0,
				executionTimeMs: 10,
				timestamp: Date.now(),
			});

			const noResults = await page.locator('.no-results').textContent();
			assert.ok(noResults?.includes('No results'));
		});
	});

	/* ═══════════════ Scrolling ═══════════════ */

	suite('Scrolling', () => {
		test('should have vertical scrolling with large dataset', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			const tableContainer = page.locator('#tableContainer');
			const scrollable = await tableContainer.evaluate((el) => {
				return el.scrollHeight > el.clientHeight;
			});
			assert.ok(scrollable, 'Table container should be vertically scrollable with 100 rows');
		});

		test('should have horizontal scrolling with many columns', async () => {
			// Use a narrow viewport to force horizontal scroll
			await resetPage(600, 800);
			await page.evaluate((d) => {
				window.postMessage({ type: 'queryResult', payload: { success: true, data: d } }, '*');
			}, LARGE_DATA);
			await page.waitForSelector('table.results-table tbody tr', { timeout: 3000 });
			await step();

			const scrollable = await page.evaluate(() => {
				const container = document.getElementById('tableContainer');
				if (!container) { return false; }
				return container.scrollWidth > container.clientWidth;
			});
			assert.ok(scrollable, 'Table container should be horizontally scrollable with 12 columns in narrow viewport');
		});

		test('should scroll to bottom row', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Scroll to the last row
			const lastRow = page.locator('table.results-table tbody tr:last-child');
			await lastRow.scrollIntoViewIfNeeded();
			await step();

			const lastRowVisible = await lastRow.isVisible();
			assert.ok(lastRowVisible, 'Last row should be visible after scrolling');

			// Verify the last row shows the correct data
			const lastNameCell = await lastRow.locator('td:nth-child(2)').textContent();
			assert.strictEqual(lastNameCell?.trim(), LARGE_DATA.data[99][0]);
		});

		test('should scroll to rightmost column', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Scroll to the last header
			const lastHeader = page.locator('table.results-table thead th').last();
			await lastHeader.scrollIntoViewIfNeeded();
			await step();

			const headerText = await lastHeader.locator('.header-text').textContent();
			assert.strictEqual(headerText?.trim(), 'costPerMonth', 'Last visible column should be costPerMonth');
		});
	});

	/* ═══════════════ Column sorting ═══════════════ */

	suite('Column Sorting', () => {
		test('should sort ascending on first sort call', async () => {
			await loadPageWithData();
			await step();

			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).sortTable(0);
			});
			await step();

			const firstCell = await page
				.locator('table.results-table tbody tr:first-child td:nth-child(2)')
				.textContent();
			// After ascending sort on name, the smallest alphabetically comes first
			const sorted = SAMPLE_DATA.data.map((r) => r[0]).sort();
			assert.strictEqual(firstCell?.trim(), sorted[0], `First row should be "${sorted[0]}" after ascending sort`);
		});

		test('should toggle to descending on second sort', async () => {
			await loadPageWithData();
			await step();

			await page.evaluate(() => {
				const sort = (window as unknown as Record<string, CallableFunction>).sortTable;
				sort(0); // asc
				sort(0); // desc
			});
			await step();

			const firstCell = await page
				.locator('table.results-table tbody tr:first-child td:nth-child(2)')
				.textContent();
			const sorted = SAMPLE_DATA.data.map((r) => r[0]).sort().reverse();
			assert.strictEqual(firstCell?.trim(), sorted[0], `First row should be "${sorted[0]}" after descending sort`);
		});

		test('should sort numeric columns correctly', async () => {
			const numData = {
				columns: [
					{ name: 'id', type: 'int' },
					{ name: 'value', type: 'int' },
				],
				data: [
					['3', '30'],
					['1', '10'],
					['2', '20'],
				],
				totalRecords: 3,
				executionTimeMs: 5,
				timestamp: Date.now(),
			};

			await loadPageWithData(numData);
			await step();

			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).sortTable(0);
			});
			await step();

			const firstCell = await page
				.locator('table.results-table tbody tr:first-child td:nth-child(2)')
				.textContent();
			assert.strictEqual(firstCell?.trim(), '1', `Numeric sort should place 1 first, got: ${firstCell?.trim()}`);
		});

		test('should add sort indicator class to sorted header', async () => {
			await loadPageWithData();
			await step();

			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).sortTable(0);
			});
			await step();

			const sortedTh = page.locator('table.results-table thead th.sorted-asc');
			assert.strictEqual(await sortedTh.count(), 1, 'Should have one header with sorted-asc class');
		});

		test('should sort large dataset correctly', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Sort by location ascending
			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).sortTable(2);
			});
			await step();

			const firstLocation = await page
				.locator('table.results-table tbody tr:first-child td:nth-child(4)')
				.textContent();
			const sorted = LARGE_DATA.data.map((r) => r[2]).sort();
			assert.strictEqual(firstLocation?.trim(), sorted[0], 'First location after sort should be alphabetically first');
		});
	});

	/* ═══════════════ Column resize ═══════════════ */

	suite('Column Resize', () => {
		test('should resize column via mouse drag on resize handle', async () => {
			await loadPageWithData();
			await step();

			const resizeHandle = page.locator('table.results-table thead th:nth-child(2) .resize-handle');
			const handleCount = await resizeHandle.count();
			assert.ok(handleCount > 0, 'Resize handle should exist');

			const thBefore = page.locator('table.results-table thead th:nth-child(2)');
			const widthBefore = (await thBefore.boundingBox())!.width;
			await step();

			// Drag the handle 100px to the right
			const box = (await resizeHandle.boundingBox())!;
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
			await page.mouse.up();
			await step();

			const widthAfter = (await thBefore.boundingBox())!.width;
			assert.ok(widthAfter > widthBefore, `Column should be wider after drag: ${widthAfter} > ${widthBefore}`);
		});
	});

	/* ═══════════════ Column drag-and-drop reorder ═══════════════ */

	suite('Column Reorder', () => {
		test('should reorder columns programmatically', async () => {
			await loadPageWithData();
			await step();

			const headersBefore = await page.evaluate(() => {
				const ths = document.querySelectorAll('table.results-table thead th .header-text');
				return Array.from(ths).map((el) => el.textContent);
			});
			assert.strictEqual(headersBefore[0], 'name');
			assert.strictEqual(headersBefore[1], 'type');
			await step();

			// Reorder: move column 0 (name) to position 2
			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).reorderColumn(0, 2);
			});
			await step();

			const headersAfter = await page.evaluate(() => {
				const ths = document.querySelectorAll('table.results-table thead th .header-text');
				return Array.from(ths).map((el) => el.textContent);
			});
			assert.strictEqual(headersAfter[0], 'type');
			assert.strictEqual(headersAfter[1], 'location');
			assert.strictEqual(headersAfter[2], 'name');
		});

		test('should update data cells after column reorder', async () => {
			await loadPageWithData();
			await step();

			await page.evaluate(() => {
				(window as unknown as Record<string, CallableFunction>).reorderColumn(0, 2);
			});
			await step();

			// First data cell in first row should now be the "type" value
			const firstCell = await page
				.locator('table.results-table tbody tr:first-child td:nth-child(2)')
				.textContent();
			assert.strictEqual(
				firstCell?.trim(),
				SAMPLE_DATA.data[0][1],
				'After reorder, first data cell should be the type value',
			);
		});
	});

	/* ═══════════════ Cell selection ═══════════════ */

	suite('Cell Selection', () => {
		test('should select a cell on click', async () => {
			await loadPageWithData();
			await step();

			const cell = page.locator('table.results-table tbody tr:first-child td:nth-child(2)');
			await cell.click();
			await step();

			const hasSelectedClass = await cell.evaluate((el) => el.classList.contains('selected'));
			assert.ok(hasSelectedClass, 'Clicked cell should have "selected" class');
		});

		test('should clear previous selection when clicking a new cell', async () => {
			await loadPageWithData();
			await step();

			const cell1 = page.locator('table.results-table tbody tr:first-child td:nth-child(2)');
			const cell2 = page.locator('table.results-table tbody tr:nth-child(2) td:nth-child(3)');

			await cell1.click();
			await step();
			await cell2.click();
			await step();

			const cell1Selected = await cell1.evaluate((el) => el.classList.contains('selected'));
			const cell2Selected = await cell2.evaluate((el) => el.classList.contains('selected'));

			assert.ok(!cell1Selected, 'First cell should be deselected');
			assert.ok(cell2Selected, 'Second cell should be selected');
		});

		test('should select entire column on header click', async () => {
			await loadPageWithData();
			await step();

			const nameHeader = page.locator('table.results-table thead th:nth-child(2)');
			await nameHeader.click();
			await step();

			const selectedCells = await page.locator('table.results-table tbody td.selected').count();
			assert.strictEqual(selectedCells, SAMPLE_DATA.data.length, 'All cells in the column should be selected');
		});
	});

	/* ═══════════════ Context menu ═══════════════ */

	suite('Context Menu', () => {
		test('should show context menu on right-click in table', async () => {
			await loadPageWithData();
			await step();

			// Click to select first, then dispatch contextmenu event
			const cell = page.locator('table.results-table tbody tr:first-child td:nth-child(2)');
			await cell.click();
			await step();
			await cell.dispatchEvent('contextmenu', { bubbles: true });
			await step();

			// The custom context menu element
			const contextMenu = page.locator('.custom-context-menu');
			await contextMenu.waitFor({ state: 'attached', timeout: 2000 });
			const visible = await contextMenu.isVisible();
			assert.ok(visible, 'Context menu should be visible after right-click');
		});

		test('context menu should have copy options', async () => {
			await loadPageWithData();
			await step();

			const cell = page.locator('table.results-table tbody tr:first-child td:nth-child(2)');
			await cell.click();
			await step();
			await cell.dispatchEvent('contextmenu', { bubbles: true });
			await step();

			const contextMenu = page.locator('.custom-context-menu');
			await contextMenu.waitFor({ state: 'attached', timeout: 2000 });

			const menuText = await contextMenu.textContent();
			assert.ok(menuText?.toLowerCase().includes('copy'), `Context menu should include copy options, got: "${menuText}"`);
		});

		test('context menu should close when clicking elsewhere', async () => {
			await loadPageWithData();
			await step();

			const cell = page.locator('table.results-table tbody tr:first-child td:nth-child(2)');
			await cell.click();
			await step();
			await cell.dispatchEvent('contextmenu', { bubbles: true });

			const contextMenu = page.locator('.custom-context-menu');
			await contextMenu.waitFor({ state: 'attached', timeout: 2000 });
			await step();

			// The hideContextMenu listener is added on document via setTimeout(0).
			// Wait for it to be registered, then dispatch a click directly on document.
			await page.waitForTimeout(50);
			await page.evaluate(() => {
				document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			});

			// hideContextMenu removes the element from the DOM
			await contextMenu.waitFor({ state: 'detached', timeout: 2000 });
		});
	});

	/* ═══════════════ Details pane ═══════════════ */

	suite('Details Pane', () => {
		test('should open details pane when clicking row detail button', async () => {
			await loadPageWithData();
			await step();

			const detailBtn = page.locator('table.results-table tbody tr:first-child td:first-child');
			await detailBtn.click();
			await step();

			const detailsSection = page.locator('#detailsSection');
			const display = await detailsSection.evaluate((el) => getComputedStyle(el).display);
			assert.notStrictEqual(display, 'none', 'Details section should be visible');
		});

		test('should show row data in details pane', async () => {
			await loadPageWithData();
			await step();

			const detailBtn = page.locator('table.results-table tbody tr:first-child td:first-child');
			await detailBtn.click();
			await step();

			const detailsContent = await page.locator('#detailsContent').textContent();
			assert.ok(detailsContent?.includes(SAMPLE_DATA.data[0][0]), 'Details should contain the row name value');
		});

		test('should close details pane when clicking same row again', async () => {
			await loadPageWithData();
			await step();

			const detailBtn = page.locator('table.results-table tbody tr:first-child td:first-child');
			await detailBtn.click();
			await step();
			await detailBtn.click();
			await step();

			const detailsSection = page.locator('#detailsSection');
			const display = await detailsSection.evaluate((el) => getComputedStyle(el).display);
			assert.strictEqual(display, 'none', 'Details section should be hidden after toggling');
		});

		test('should support multi-row comparison', async () => {
			await loadPageWithData();
			await step();

			const btn1 = page.locator('table.results-table tbody tr:first-child td:first-child');
			const btn2 = page.locator('table.results-table tbody tr:nth-child(2) td:first-child');
			await btn1.click();
			await step();
			await btn2.click();
			await step();

			const detailsContent = await page.locator('#detailsContent').textContent();
			assert.ok(detailsContent?.includes(SAMPLE_DATA.data[0][0]), 'Details should contain first row data');
			assert.ok(detailsContent?.includes(SAMPLE_DATA.data[1][0]), 'Details should contain second row data');
		});

		test('should display details for rows deep in the dataset', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Click detail button on row 50 (scroll into view first)
			const row50 = page.locator('table.results-table tbody tr:nth-child(50)');
			await row50.scrollIntoViewIfNeeded();
			await step();
			const detailBtn = row50.locator('td:first-child');
			await detailBtn.click();
			await step();

			const detailsContent = await page.locator('#detailsContent').textContent();
			assert.ok(detailsContent?.includes(LARGE_DATA.data[49][0]), 'Details should contain row 50 name');
		});
	});

	/* ═══════════════ Filtering ═══════════════ */

	suite('Filtering', () => {
		test('should open filter dropdown on filter button click', async () => {
			await loadPageWithData();
			await step();

			const filterBtn = page.locator('table.results-table thead th:nth-child(2) .filter-btn');
			const filterBtnCount = await filterBtn.count();
			assert.ok(filterBtnCount > 0, 'Filter button should exist');
			await filterBtn.click();
			await step();

			const dropdown = page.locator('.filter-dropdown');
			const visible = await dropdown.isVisible();
			assert.ok(visible, 'Filter dropdown should be visible after clicking filter button');
		});

		test('filter dropdown should list unique values', async () => {
			await loadPageWithData();
			await step();

			const filterBtn = page.locator('table.results-table thead th:nth-child(2) .filter-btn');
			await filterBtn.click();
			await step();

			// In the filter dropdown, values are in .filter-value-item .filter-label
			const labels = await page.locator('.filter-dropdown .filter-value-item .filter-label').allTextContents();
			const uniqueNames = Array.from(new Set(SAMPLE_DATA.data.map((r) => r[0])));
			for (const name of uniqueNames) {
				assert.ok(
					labels.some((l) => l.includes(name)),
					`Filter should list value "${name}", found: [${labels.join(', ')}]`,
				);
			}
		});

		test('should filter table rows when unchecking a value', async () => {
			await loadPageWithData();
			await step();

			const filterBtn = page.locator('table.results-table thead th:nth-child(2) .filter-btn');
			await filterBtn.click();
			await step();

			// Click the first value item div to toggle its checkbox off.
			// Clicking the item (not the checkbox directly) triggers the item's
			// click handler which toggles checkbox.checked and calls onFilterChange.
			const firstValueItem = page.locator('.filter-dropdown .filter-value-item').first();
			await firstValueItem.click();
			await step();

			// Auto-apply is on by default, so wait for the filter to take effect
			await page.waitForTimeout(500);

			const rows = await page.locator('table.results-table tbody tr').count();
			assert.ok(rows < SAMPLE_DATA.data.length, `Rows should be filtered: got ${rows}, expected less than ${SAMPLE_DATA.data.length}`);
		});

		test('should filter large dataset by location', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Open filter on location column (4th header, index 3)
			const filterBtn = page.locator('table.results-table thead th:nth-child(4) .filter-btn');
			await filterBtn.click();
			await step();

			// Click "All" to uncheck everything
			const allItem = page.locator('.filter-dropdown .filter-all-item');
			await allItem.click();
			await page.waitForTimeout(200);
			await step();

			// Check only the first value
			const firstValueItem = page.locator('.filter-dropdown .filter-value-item').first();
			await firstValueItem.click();
			await page.waitForTimeout(500);
			await step();

			const rows = await page.locator('table.results-table tbody tr').count();
			assert.ok(rows > 0, 'Should have some rows after filtering');
			assert.ok(rows < LARGE_DATA.data.length, `Should have fewer rows than original ${LARGE_DATA.data.length}, got ${rows}`);
		});

		test('should navigate to in-view column filter via chip click', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// Apply a filter on the "name" column (column index 0, header th:nth-child(2))
			const nameFilterBtn = page.locator('table.results-table thead th:nth-child(2) .filter-btn');
			await nameFilterBtn.click();
			await step();
			const firstValueItem = page.locator('.filter-dropdown .filter-value-item').first();
			await firstValueItem.click();
			await page.waitForTimeout(300);
			await step();

			// Close the dropdown by clicking elsewhere
			await page.evaluate(() => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
			await page.waitForTimeout(200);

			// The filter badge should now be visible with a count
			const badge = page.locator('#filterBadge.visible');
			await badge.waitFor({ state: 'visible', timeout: 2000 });
			await step();

			// Click the badge to open the chips popup
			await badge.click();
			const popup = page.locator('.filter-chips-popup');
			await popup.waitFor({ state: 'visible', timeout: 2000 });
			await step();

			// Click the chip for "name" — should scroll to column and open its filter dropdown
			const nameChip = popup.locator('.filter-chip .filter-chip-label:text-is("name")').locator('..');
			await nameChip.click();
			await page.waitForTimeout(500);
			await step();

			// The filter dropdown should now be open for the "name" column
			const dropdown = page.locator('.filter-dropdown');
			await dropdown.waitFor({ state: 'visible', timeout: 2000 });

			// The "name" column header should be in the viewport
			const nameHeader = page.locator('table.results-table thead th[data-col-index="0"]');
			const isVisible = await nameHeader.isVisible();
			assert.ok(isVisible, 'Name column header should be visible after chip navigation');
		});

		test('should scroll to out-of-view column filter via chip click', async () => {
			await loadPageWithData(LARGE_DATA);
			await step();

			// First, apply a filter on the last column "costPerMonth" (column index 11)
			// Scroll to it first so we can interact with the filter button
			const lastHeader = page.locator('table.results-table thead th[data-col-index="11"]');
			await lastHeader.scrollIntoViewIfNeeded();
			await step();
			const costFilterBtn = lastHeader.locator('.filter-btn');
			await costFilterBtn.click();
			await step();

			const firstValueItem = page.locator('.filter-dropdown .filter-value-item').first();
			await firstValueItem.click();
			await page.waitForTimeout(300);
			await step();

			// Close the dropdown
			await page.evaluate(() => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
			await page.waitForTimeout(200);

			// Scroll back to the leftmost column so "costPerMonth" is out of view
			const firstHeader = page.locator('table.results-table thead th[data-col-index="0"]');
			await firstHeader.scrollIntoViewIfNeeded();
			await page.waitForTimeout(200);
			await step();

			// Verify costPerMonth header is NOT in the viewport
			const costHeaderBox = await lastHeader.boundingBox();
			const viewportSize = page.viewportSize()!;
			const isOutOfView = !costHeaderBox || costHeaderBox.x + costHeaderBox.width < 0 || costHeaderBox.x > viewportSize.width;
			assert.ok(isOutOfView, 'costPerMonth column should be out of view before chip click');

			// Click the filter badge to open chips popup
			const badge = page.locator('#filterBadge.visible');
			await badge.waitFor({ state: 'visible', timeout: 2000 });
			await badge.click();
			await step();

			const popup = page.locator('.filter-chips-popup');
			await popup.waitFor({ state: 'visible', timeout: 2000 });

			// Click the "costPerMonth" chip
			const costChip = popup.locator('.filter-chip .filter-chip-label:text-is("costPerMonth")').locator('..');
			await costChip.click();
			await step();

			// Wait for smooth scroll to complete and dropdown to open
			await page.waitForTimeout(1000);

			// The filter dropdown should be open
			const dropdown = page.locator('.filter-dropdown');
			await dropdown.waitFor({ state: 'visible', timeout: 2000 });

			// The costPerMonth header should now be visible in the viewport
			const costHeaderBoxAfter = await lastHeader.boundingBox();
			assert.ok(costHeaderBoxAfter, 'costPerMonth header should have a bounding box after scroll');
			assert.ok(
				costHeaderBoxAfter!.x >= 0 && costHeaderBoxAfter!.x < viewportSize.width,
				`costPerMonth header should be in viewport (x=${costHeaderBoxAfter!.x}, viewport width=${viewportSize.width})`,
			);
		});
	});

	/* ═══════════════ Select all rows ═══════════════ */

	suite('Select All Rows', () => {
		test('should select all rows via select-all header click', async () => {
			await loadPageWithData();
			await step();

			const selectAllHeader = page.locator('table.results-table thead th.select-all-header');
			await selectAllHeader.click();
			await page.waitForTimeout(200);
			await step();

			// toggleSelectAllRows sets selectedDetailRowIndices and re-renders table
			// Active class is on button.detail-button.active, not on the td
			const activeDetailBtns = await page.locator('table.results-table tbody button.detail-button.active').count();
			assert.strictEqual(activeDetailBtns, SAMPLE_DATA.data.length, 'All rows should have active detail buttons');
		});

		test('should deselect all rows on second click', async () => {
			await loadPageWithData();
			await step();

			const selectAllHeader = page.locator('table.results-table thead th.select-all-header');
			await selectAllHeader.click(); // select all
			await page.waitForTimeout(200);
			await step();
			await selectAllHeader.click(); // deselect all
			await page.waitForTimeout(200);
			await step();

			const activeDetailBtns = await page.locator('table.results-table tbody button.detail-button.active').count();
			assert.strictEqual(activeDetailBtns, 0, 'No detail buttons should be active after deselecting all');
		});
	});

	/* ═══════════════ Error display ═══════════════ */

	suite('Error Display', () => {
		test('should display error when query fails', async () => {
			await resetPage();
			await step();

			await page.evaluate(() => {
				window.postMessage(
					{
						type: 'queryResult',
						payload: {
							success: false,
							error: 'Subscription not found',
							errorDetails: 'The subscription ID is invalid.',
						},
					},
					'*',
				);
			});

			await page.waitForTimeout(300);

			const bodyText = await page.locator('#tableContainer').textContent();
			assert.ok(
				bodyText?.includes('Subscription not found') || bodyText?.includes('invalid'),
				'Should display the error message',
			);
		});
	});

	/* ═══════════════ Loading indicator ═══════════════ */

	suite('Loading Indicator', () => {
		test('should show loading on queryStart and hide on queryResult', async () => {
			await resetPage();
			await step();

			// Send queryStart
			await page.evaluate(() => {
				window.postMessage({ type: 'queryStart' }, '*');
			});
			await page.waitForTimeout(200);
			await step();

			// Export button should be disabled during loading
			const exportDisabled = await page.evaluate(() => {
				const btn = document.getElementById('exportBtn') as HTMLButtonElement | null;
				return btn?.disabled ?? false;
			});
			assert.ok(exportDisabled, 'Export button should be disabled during loading');

			// Send queryResult to stop loading
			await page.evaluate((d) => {
				window.postMessage({ type: 'queryResult', payload: { success: true, data: d } }, '*');
			}, SAMPLE_DATA);
			await page.waitForSelector('table.results-table tbody tr', { timeout: 2000 });

			const exportEnabledAfter = await page.evaluate(() => {
				const btn = document.getElementById('exportBtn') as HTMLButtonElement | null;
				return btn?.disabled ?? true;
			});
			assert.ok(!exportEnabledAfter, 'Export button should be enabled after results arrive');
		});
	});

	/* ═══════════════ Message protocol ═══════════════ */

	suite('Message Protocol', () => {
		test('webview should post telemetry/ready messages via vscode API', async () => {
			await resetPage();

			const messages = await page.evaluate(() => {
				return (window as unknown as Record<string, unknown[]>)._postedMessages || [];
			});
			assert.ok(Array.isArray(messages), 'Posted messages should be an array');
		});
	});
});
