import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Where the record of what actually landed in the bundle is written. Outside `dist/`, because
 * `dist/` is shipped and this is a build note; gitignored, because it is derived.
 */
export const BUNDLED_PACKAGES_FILE = resolve(ROOT, '.bundled-packages.json');

/** `/a/b/node_modules/@scope/name/lib/x.js` → `@scope/name`. Everything else → null. */
export function packageNameFor(moduleId) {
	const marker = '/node_modules/';
	const at = moduleId.lastIndexOf(marker);
	if (at === -1) return null;
	const parts = moduleId.slice(at + marker.length).split('/').filter(Boolean);
	if (parts.length === 0) return null;
	return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Record which third-party packages are actually in the output.
 *
 * THIRD_PARTY_NOTICES.md has to be generated from what shipped, not from what is installed — the
 * install tree is the whole build toolchain and attributing all of it would be a document that is
 * wrong in both directions at once, naming compilers the user never receives and hiding the four
 * libraries they do. The only thing that knows the difference is the bundler, so it says so here,
 * from `generateBundle`, which sees the modules that survived tree-shaking rather than every
 * module the graph touched.
 */
function recordBundledPackages() {
	return {
		name: 'record-bundled-packages',
		generateBundle(_options, bundle) {
			const names = new Set();
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				for (const moduleId of Object.keys(output.modules ?? {})) {
					const name = packageNameFor(moduleId);
					if (name) names.add(name);
				}
			}
			writeFileSync(
				BUNDLED_PACKAGES_FILE,
				`${JSON.stringify({ packages: [...names].sort() }, null, 2)}\n`,
			);
		},
	};
}

/**
 * The browser half of the sidecar, built to a directory the sidecar serves and nothing else.
 *
 * React and Vite are devDependencies and the published package's runtime dependency set is empty:
 * what ships is `dist/`, a folder of static files, plus a server written against `node:` builtins.
 * `npx` therefore installs no runtime tree, which is the whole reason this is not a framework.
 */
export default defineConfig({
	plugins: [react(), recordBundledPackages()],

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
