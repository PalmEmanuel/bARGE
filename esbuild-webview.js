const esbuild = require("esbuild");

/**
 * Build webview bundle with Lottie
 */
async function buildWebview() {
    const ctx = await esbuild.context({
        entryPoints: ['src/webview/webview-with-lottie.js'],
        bundle: true,
        format: 'iife', // Immediately Invoked Function Expression for webview
        minify: true,
        platform: 'browser',
        outfile: 'media/webview/webview-bundle.js',
        logLevel: 'info',
        // Include lottie-web in the bundle
        external: [], // Don't externalize anything - bundle everything
    });

    await ctx.rebuild();
    await ctx.dispose();
    console.log('[webview] Lottie bundle created successfully');
}

buildWebview().catch(e => {
    console.error(e);
    process.exit(1);
});
