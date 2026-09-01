/**
 * The entire network attack surface of this product.
 *
 * The engine has no listener at all — it is a program that reads stdin and writes stdout. The
 * moment this repository opens a TCP socket, every network-facing risk in the product becomes
 * ours, and the origin holding the token has total read access to the user's most sensitive local
 * store. So the controls land WHOLE, in the first commit, rather than being retrofitted: a Host
 * check added later is a Host check that gets half done, and half a rebinding defence is none.
 *
 * Each export below says what it stops. That is not decoration — a control whose reason is not
 * written down is a control the next contributor deletes because it was "in the way".
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 32 bytes from the platform CSPRNG, base64url so it survives a URL fragment untouched.
 *
 * STOPS: any other process on this machine from reading the vault. Loopback is not a permission
 * boundary — every local user, every local process and every page in the user's browser can open a
 * socket to 127.0.0.1. The token is the only thing that distinguishes the app from all of them,
 * which is why it is mandatory rather than belt-and-braces.
 *
 * Minted per launch and never persisted: nothing writes it to a file, so there is no file to leak,
 * and a sidecar that has exited cannot be talked to with yesterday's token.
 */
export const mintToken = () => randomBytes(32).toString('base64url');

/**
 * Constant-time comparison.
 *
 * STOPS: recovering the token one byte at a time by timing a few thousand requests against a
 * loopback socket, where the noise floor is microseconds rather than milliseconds.
 *
 * Both sides are digested first. `timingSafeEqual` throws on unequal lengths, and that throw is
 * itself a timing signal — it would tell an attacker the token's length before they had guessed a
 * single byte of it. Two digests are always 32 bytes.
 */
export function tokenMatches(presented, expected) {
	if (typeof presented !== 'string' || typeof expected !== 'string') return false;
	const a = createHash('sha256').update(presented, 'utf8').digest();
	const b = createHash('sha256').update(expected, 'utf8').digest();
	return timingSafeEqual(a, b);
}

/**
 * The token, from the `Authorization` header and from nowhere else.
 *
 * STOPS: simple-request forgery. A cross-origin page can make the browser send a form post or load
 * an image against this server, and both of those carry cookies automatically — but neither one
 * can set a request header. Reading the credential ONLY from a header means the forged request
 * arrives unauthenticated no matter what the browser has stored.
 *
 * Deliberately does not look at cookies (attached automatically, so they reintroduce forgery) or
 * at the query string (it lands in browser history, in the `Referer` of every outbound link, and
 * in every screenshot pasted into a bug report).
 */
export function bearerToken(req) {
	const header = req.headers.authorization;
	if (typeof header !== 'string') return null;
	const match = /^Bearer[ ]+(\S+)$/.exec(header.trim());
	return match ? match[1] : null;
}

/**
 * The reserved parameter names no endpoint may ever accept.
 *
 * STOPS: this becoming an arbitrary local-file reader. A parameter naming a vault root is the
 * whole difference between a memory browser and a program that will read any directory a page
 * asks it to. The vault is resolved once, at launch, from the engine's own address door, and it is
 * not a parameter of anything. Rejecting these by name is louder than ignoring them: an endpoint
 * that quietly drops `?root=` looks, to whoever adds the next one, like an endpoint that took it.
 */
export const RESERVED_PARAMETERS = ['root', 'vault', 'path', 'profile', 'dir', 'cwd', 'workspace'];

/**
 * The Host values this server answers to, computed from what was ACTUALLY bound.
 *
 * Never written down as a constant. The port is chosen at bind time — possibly not the one that
 * was asked for — so an allowlist typed into a file is an allowlist that is wrong exactly when the
 * fallback fires.
 */
export function allowedHosts({ address, port }) {
	// A bare IPv6 literal is bracketed in a Host header; an IPv4 literal is not.
	const literal = address.includes(':') ? `[${address}]` : address;
	return new Set([`${literal}:${port}`, `localhost:${port}`]);
}

/**
 * The Host check. Runs FIRST, before routing and before authentication.
 *
 * STOPS: DNS rebinding, which is the attack this whole file exists for. A hostile page the user
 * merely visits can publish a DNS name with a one-second TTL, let the browser connect to the real
 * server once, then re-answer that name with 127.0.0.1. The browser now considers
 * `http://evil.example/` and this server to be the SAME ORIGIN, so it hands the page full
 * read/write access — and because the request is same-origin as far as the browser is concerned,
 * **it carries no `Origin` header at all**. An Origin check cannot see this. The `Host` header
 * still names `evil.example`, and that is the one thing that gives it away.
 *
 * Checking Origin and not Host is the exact shape of a defence that looks complete and stops
 * nothing.
 *
 * Deny by default: an absent Host (an HTTP/1.0 client) is rejected rather than waved through.
 */
export function hostAllowed(req, hosts) {
	const host = req.headers.host;
	if (typeof host !== 'string' || host.length === 0) return false;
	// The hostname is case-insensitive; the port is not, and is digits either way.
	return hosts.has(host.toLowerCase());
}

/**
 * The Origin and fetch-metadata check. Runs second, before authentication.
 *
 * STOPS: a cross-origin page driving this server with the user's browser. It is the second half of
 * the pair — `Host` catches the rebinding case where the browser thinks it is same-origin, this
 * catches the ordinary case where the browser knows it is not and says so.
 *
 * Four rules, and the reason each one is here:
 *
 *   - `Origin`, when present, must be one of the loopback origins this server is bound to. A
 *     legitimate same-origin GET from the app sends no Origin at all; a cross-origin `fetch` sends
 *     one. So presence is not required, but a wrong value is fatal.
 *   - `Origin: null` is REJECTED rather than treated as absent. `null` is what a sandboxed iframe,
 *     a `data:` URL and a file redirected cross-site send — it is an origin that has been
 *     deliberately made unattributable, which is the opposite of a reason to trust it.
 *   - Anything that is not a simple GET must carry a matching Origin. There is no state-changing
 *     route in this milestone, and this is what keeps it that way: a write route added later
 *     inherits the check instead of needing to remember it.
 *   - `Sec-Fetch-Site` outside `same-origin`/`none` is rejected, and `Sec-Fetch-Mode: no-cors` is
 *     rejected outright. `no-cors` is the shape an `<img>`, a `<script>` tag and a plain form post
 *     arrive in — requests a page can make cross-origin without the browser asking permission
 *     first. `Sec-Fetch-Site: none` is a user typing the URL or opening a bookmark, which is
 *     exactly how this app is launched.
 *
 * Browsers that send no fetch-metadata headers are not rejected for their absence; the token and
 * the Host check still stand. A control that breaks a supported browser gets removed, and the
 * direction of any revision here is "add a control", never "drop one".
 */
export function originAllowed(req, hosts) {
	const origin = req.headers.origin;
	const method = (req.method ?? 'GET').toUpperCase();
	const simple = method === 'GET' || method === 'HEAD';

	if (typeof origin === 'string' && origin.length > 0) {
		if (origin === 'null') return false;
		let parsed;
		try {
			parsed = new URL(origin);
		} catch {
			return false;
		}
		if (parsed.protocol !== 'http:') return false;
		if (!hosts.has(parsed.host.toLowerCase())) return false;
	} else if (!simple) {
		// A state-changing request with no Origin is either a very old client or a forgery. There
		// is no version of this app that produces one.
		return false;
	}

	const site = req.headers['sec-fetch-site'];
	if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;

	const mode = req.headers['sec-fetch-mode'];
	if (typeof mode === 'string' && (mode === 'no-cors' || mode === 'websocket')) return false;

	return true;
}

/**
 * The Content-Security-Policy, as one string.
 *
 * STOPS two things. First, script injected through vault content: every field this app renders was
 * written by an agent that read the open web, and script executing on this page runs inside the
 * origin that holds the token to the whole vault. `default-src 'none'` with `script-src 'self'`
 * means an injected `<script>` has nothing it can load and no inline it can run.
 *
 * Second — and this is the one a README cannot do — it ENFORCES the offline claim. `connect-src
 * 'self'` means no telemetry, no update check, no CDN and no remote font can be added to this app
 * without the browser refusing it. The product's central promise is that it makes no network call;
 * this is that promise asserted in a header rather than in a sentence.
 *
 * `frame-ancestors 'none'` stops a hostile page framing the app and clickjacking a control.
 * `form-action 'none'` and `base-uri 'none'` stop injected markup from redirecting a submission or
 * rewriting where relative URLs resolve.
 *
 * `font-src 'self'` IS THE ONE DIRECTIVE HERE THAT WAS ADDED BECAUSE IT WAS MISSING, and the way it
 * was missing is the reason it is worth a paragraph. The app bundles its three typefaces so it can
 * render with no network, and every one of them was silently refused by this header: `font-src` was
 * never set, so it fell back to `default-src 'none'`. Nothing broke. The page rendered in the
 * fallback stack, looked entirely reasonable, and the design shipped in whatever the reader's
 * system happened to have — which is the same class of failure as a channel that abstains quietly.
 * It was found by reading the browser console, not by any test, and there is now an assertion for
 * it in `test/server.test.mjs`.
 *
 * `'self'` and nothing else, deliberately. A font host here would be the single easiest way to
 * reintroduce the network call the rest of this header exists to prevent, and it would be invisible
 * to anyone who had the font cached.
 */
export const CONTENT_SECURITY_POLICY = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' data:",
	"font-src 'self'",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

/**
 * The headers on EVERY response, including the refusals.
 *
 * NOTE WHAT IS NOT HERE: there is no `Access-Control-Allow-Origin`, and there never is one, on any
 * response, in any code path. The browser's same-origin policy is the defence that makes the token
 * hard to steal; a CORS header is the app asking the browser to switch that defence off. There is
 * no origin this server wants to be reachable from other than itself, so there is no value that
 * header could take that would be an improvement.
 *
 * `X-Content-Type-Options: nosniff` STOPS a response the app meant as data being re-interpreted as
 * a script or a document by content sniffing. `Referrer-Policy: no-referrer` STOPS the loopback
 * URL — and anything ever appended to it — leaking through an outbound link.
 *
 * `Cache-Control: no-store` STOPS vault content coming to rest in the browser's disk cache, where
 * it outlives the session and the token that authorised reading it.
 */
export function securityHeaders(contentType) {
	return {
		'content-type': contentType,
		'content-security-policy': CONTENT_SECURITY_POLICY,
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cache-control': 'no-store',
		// The socket is closed on every refusal path below, so keep-alive is not promised here.
		vary: 'Origin',
	};
}
