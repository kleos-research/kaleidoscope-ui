import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The browser half of the sidecar, built to a directory the sidecar serves and nothing else.
 *
 * React and Vite are devDependencies and the published package's runtime dependency set is empty:
 * what ships is `dist/`, a folder of static files, plus a server written against `node:` builtins.
 * `npx` therefore installs no runtime tree, which is the whole reason this is not a framework.
 */
export default defineConfig({
	plugins: [react()],

	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2022',
		// Vite's module-preload polyfill is injected as an INLINE <script>, and the sidecar serves
		// `script-src 'self'` with no `'unsafe-inline'`. With the polyfill on, the built page is
		// blocked by the app's own security header — a failure that appears only in the packaged
		// build and never in `vite dev`. Every browser this product supports handles modulepreload
		// natively, so the polyfill buys nothing and costs the CSP.
		modulePreload: { polyfill: false },
		// One stylesheet, linked rather than inlined, for the same reason: `style-src 'self'`.
		cssCodeSplit: false,
		sourcemap: false,
	},

	server: {
		// Development only. The packaged app is same-origin with the sidecar and never proxies.
		// The port comes from the environment because the sidecar binds an ephemeral one by design.
		proxy: {
			'/api': {
				target: `http://127.0.0.1:${process.env.KALEIDOSCOPE_UI_PORT ?? 7777}`,
				changeOrigin: false,
			},
		},
	},
});
