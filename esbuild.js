const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const copySchemaPlugin = {
	name: 'copy-schema',
	setup(build) {
		build.onEnd(async (result) => {
			// Copy schema files to dist
			const srcSchemaDir = path.join(__dirname, 'src', 'schema');
			const distSchemaDir = path.join(__dirname, 'dist', 'schema');
			
			try {
				// Create dist/schema directory if it doesn't exist
				if (!fs.existsSync(distSchemaDir)) {
					fs.mkdirSync(distSchemaDir, { recursive: true });
				}
				
				// Copy all JSON files from src/schema to dist/schema
				if (fs.existsSync(srcSchemaDir)) {
					const files = fs.readdirSync(srcSchemaDir);
					for (const file of files) {
						if (file.endsWith('.json')) {
							const srcFile = path.join(srcSchemaDir, file);
							const distFile = path.join(distSchemaDir, file);
							fs.copyFileSync(srcFile, distFile);
						}
					}
					console.log('[schema] copied schema files to dist');
				}
			} catch (error) {
				console.error('[schema] failed to copy schema files:', error);
			}
		});
	},
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			copySchemaPlugin,
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
