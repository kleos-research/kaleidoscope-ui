/**
 * Serving the prebuilt page, and never anything else.
 *
 * This is the one part of the server that turns a string from the network into a filesystem path,
 * which makes it the one part that can be talked into reading a file nobody meant it to read. The
 * whole module is therefore built around a single question asked in one place: **is the file I am
 * about to open inside the directory I am allowed to open files in?**
 */

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { securityHeaders } from './security.mjs';

/**
 * Content types by extension. This is a MIME table, not vocabulary read from the engine — nothing
 * here describes a memory, so nothing here can drift from what the engine knows.
 */
const TYPES = new Map(
	Object.entries({
		'.html': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.mjs': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.webp': 'image/webp',
		'.avif': 'image/avif',
		'.ico': 'image/x-icon',
		'.woff2': 'font/woff2',
		'.txt': 'text/plain; charset=utf-8',
		'.map': 'application/json; charset=utf-8',
	}),
);

/**
 * The message when there is no built page to serve.
 *
 * A blank 404 here is the worst possible answer: the user did everything right, the server is
 * running, the engine is fine, and the browser shows nothing. This says which directory was looked
 * in, what would fill it, and — because it is the question a person actually has — that their vault
 * is untouched.
 */
function missingAssetsMessage(dir) {
	return [
		`The Kaleidoscope UI server is running, but there is no built page to serve.`,
		``,
		`It looked for one in:`,
		`    ${dir}`,
		``,
		`If you are running from a git checkout, build the browser app first:`,
		``,
		`    npm install`,
		`    npm run build`,
		``,
		`If you installed this from npm, the package is missing its prebuilt assets, which`,
		`means the published tarball is broken rather than your install — please report it.`,
		``,
		`The API is up and answering; only the page is missing. Your vault was not read,`,
		`written or changed.`,
		``,
	].join('\n');
}

/**
 * @param {object} options
 * @param {string} options.dir  the ONLY directory this server will ever read a file from
 */
export function createAssetServer({ dir }) {
	const declared = resolve(dir);
	// Resolved once, at startup, and cached. The containment test compares against the CANONICAL
	// base, so a symlinked build directory (which is ordinary) works, and a symlink *inside* it
	// that points somewhere else does not.
	let base = null;
	let baseChecked = false;

	async function canonicalBase() {
		if (baseChecked) return base;
		baseChecked = true;
		try {
			base = await realpath(declared);
		} catch {
			base = null;
		}
		return base;
	}

	/**
	 * Resolve a request path to a file inside the asset directory, or to nothing.
	 *
	 * STOPS: path traversal, in both of the forms that actually work. The lexical `resolve` folds
	 * away `..` segments — including percent-encoded ones, because decoding happens first — so
	 * `/../../etc/passwd` becomes an absolute path that fails the containment test rather than an
	 * escape. And the `realpath` on the result catches the second form, where every segment is
	 * legitimate but one of them is a symbolic link pointing out of the tree.
	 *
	 * Deny by default: anything that cannot be decoded, contains a NUL, or lands outside the base
	 * returns null and is served as a 404. There is no branch here that falls back to a wider
	 * search, because "it found something else" is the failure that cannot be debugged from
	 * outside.
	 */
	async function locate(pathname) {
		const root = await canonicalBase();
		if (!root) return null;

		let decoded;
		try {
			decoded = decodeURIComponent(pathname);
		} catch {
			return null;
		}
		if (decoded.includes('\0')) return null;

		const candidate = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
		if (candidate !== root && !candidate.startsWith(root + sep)) return null;

		let canonical;
		try {
			canonical = await realpath(candidate);
		} catch {
			return null;
		}
		// Asked again after the links are followed, because the first answer was about a name and
		// this one is about a file.
		if (canonical !== root && !canonical.startsWith(root + sep)) return null;

		const stats = await stat(canonical).catch(() => null);
		if (!stats?.isFile()) return null;
		return { path: canonical, size: stats.size };
	}

	async function send(req, res, found) {
		const type = TYPES.get(extname(found.path).toLowerCase()) ?? 'application/octet-stream';
		const headers = securityHeaders(type);
		headers['content-length'] = found.size;
		res.writeHead(200, headers);
		if (req.method === 'HEAD') return res.end();
		createReadStream(found.path).on('error', () => res.destroy()).pipe(res);
	}

	return {
		/** Whether there is a page to serve at all, for the launcher's own report. */
		async available() {
			const root = await canonicalBase();
			if (!root) return false;
			return Boolean(await locate('/index.html'));
		},

		directory: declared,

		/**
		 * Serve one asset, or the app shell at `/`, or say plainly that there is no page.
		 *
		 * THE SHELL IS SERVED FOR `/` AND FOR NOTHING ELSE. The usual single-page fallback — any
		 * path with no file extension gets `index.html` — is deliberately absent, and the reason is
		 * a traversal probe rather than a routing preference. A request for
		 * `/assets/../../../../etc/passwd` is normalised to `/etc/passwd` before it reaches here;
		 * that path has no extension, so a catch-all fallback answers it **200**. Nothing escaped —
		 * the bytes returned are the app's own shell — but a 200 on `/etc/passwd` is
		 * indistinguishable from one, both to a person reading a log and to the test whose whole
		 * job is to tell those two apart. A security control that cannot be measured is a security
		 * control nobody will keep.
		 *
		 * It costs nothing here because this app routes in the URL FRAGMENT, which never reaches a
		 * server: there is no deep path for a reload to land on. A future path-routed screen would
		 * need this fallback back, and it should return then as an allowlist of the app's own
		 * routes rather than as "anything without a dot in it".
		 */
		async serve(req, res, pathname) {
			const direct = await locate(pathname);
			if (direct) return send(req, res, direct);

			if (pathname !== '/') {
				res.writeHead(404, { ...securityHeaders('text/plain; charset=utf-8'), 'content-length': 0 });
				return res.end();
			}

			const shell = await locate('/index.html');
			if (shell) return send(req, res, shell);

			const body = missingAssetsMessage(declared);
			const headers = securityHeaders('text/plain; charset=utf-8');
			headers['content-length'] = Buffer.byteLength(body);
			// 503 rather than 404: the route exists and the server is healthy, the thing that is
			// missing is a build artefact. A 404 here would send someone looking for a wrong URL.
			res.writeHead(503, headers);
			res.end(req.method === 'HEAD' ? undefined : body);
		},
	};
}

export { missingAssetsMessage };

/** The default location of the built page, relative to this package's root. */
export const DEFAULT_ASSET_DIR = (packageRoot) => join(packageRoot, 'dist');
