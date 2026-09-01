#!/usr/bin/env node
//
// THIRD_PARTY_NOTICES.md, generated from what is actually in the bundle.
//
// It is generated rather than written because a hand-written attribution file is correct on the day
// it is written and silently wrong from the next dependency bump onwards — and wrong in the
// direction that matters, since the version and the copyright line are the two parts a reader would
// have to check against the tarball to notice.
//
// The set of packages comes from the BUNDLER, not from `npm ls`. The install tree here is the whole
// build toolchain — compilers, a bundler, a browser-data table — and the user receives none of it:
// `dependencies` is `{}` and what ships is `dist/` plus a server written against `node:` builtins.
// A notices file generated from the install tree would name dozens of packages nobody receives and
// would still be right about the seven that ship, which is a document that cannot be checked. So
// `vite.config.mjs` writes down which packages survived into the output, and this reads that.
//
// The licence TEXT is reproduced, not just named. Every licence here is a notice licence: MIT,
// BSD and Apache-2.0 all condition redistribution on carrying the copyright notice and the
// permission text with it, so naming the licence and not carrying it is the one failure this file
// exists to prevent.
//
//   node scripts/third-party-notices.mjs            write the file
//   node scripts/third-party-notices.mjs --check    fail if the file on disk is not what this
//                                                   would write, and print the difference
//
// Exit 0 written/current; 1 stale under --check; 2 the generator could not run — a missing bundle
// record, an unresolvable package, or a licence this project has not decided about. There is no
// skip path: a notices generator that shrugs when it cannot see the bundle produces its most
// confident output at the moment it knows the least.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_RECORD = join(ROOT, '.bundled-packages.json');
const OUTPUT = join(ROOT, 'THIRD_PARTY_NOTICES.md');

/**
 * The licences this project accepts in anything it ships.
 *
 * This is an ALLOW list and it is the one place that is safe to be, because it does not describe
 * the engine's vocabulary — it describes a decision this repository made about itself, and its
 * failure mode is a build that stops on a licence nobody has looked at yet. Copyleft is absent
 * deliberately: a copyleft library inside a launcher for a proprietary engine is an argument
 * nobody wants to have, and this is where it would be cheapest to notice.
 */
const ALLOWED_LICENCES = new Set([
	'MIT',
	'Apache-2.0',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'CC0-1.0',
	'0BSD',
]);

/** Filenames a package may carry its licence text under. Checked in this order. */
const LICENCE_FILENAMES = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;

/**
 * Packages whose PUBLISHED TARBALL omits the licence file their repository carries.
 *
 * This is a real and common npm packaging gap: the licence is declared in `package.json`, the text
 * exists upstream, and `files` simply never listed it. Refusing to attribute such a package is the
 * right default — it is what stops a notice being invented — but refusing to SHIP it would mean
 * dropping a library over somebody else's `.npmignore`.
 *
 * So the exception is an explicit, per-package table with the exact source of the text, checked in
 * to `scripts/licences/`, and the generated file MARKS every entry that came from here. It is an
 * allow list and it is safe to be one because it grants nothing except "look in this file instead":
 * the licence identifier is still read from the package, still checked against ALLOWED_LICENCES,
 * and a package added here with no file beside it still stops the build.
 */
const TRANSCRIBED = {
	'react-remove-scroll-bar': {
		file: 'react-remove-scroll-bar.LICENSE.txt',
		source: 'https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE',
		why: 'the published tarball ships README, dist and package.json only.',
	},
};

function stop(code, message) {
	process.stderr.write(`third-party-notices: ${message}\n`);
	process.exit(code);
}

function readBundleRecord() {
	if (!existsSync(BUNDLE_RECORD)) {
		stop(
			2,
			'there is no record of what the bundle contains, so there is nothing to attribute.\n' +
				'  Run `npm run build` first: the record is written by the build, from the modules that\n' +
				'  survived into dist/, and generating this file from anything else would be a guess.',
		);
	}
	let record;
	try {
		record = JSON.parse(readFileSync(BUNDLE_RECORD, 'utf8'));
	} catch (error) {
		stop(2, `the bundle record is not readable JSON: ${error.message}`);
	}
	const packages = record?.packages;
	if (!Array.isArray(packages) || packages.length === 0) {
		stop(
			2,
			'the bundle record names no packages. Either the build changed shape or the browser app\n' +
				'  now bundles nothing, and both are worth looking at before publishing an empty file.',
		);
	}
	return packages;
}

/**
 * A package's own licence text, from the package itself.
 *
 * Read off disk rather than reconstructed from the SPDX id, because the text is what carries the
 * copyright holder and the year — the parts that differ between two packages under "MIT" and the
 * parts a redistributor is required to keep.
 */
function readLicenceText(directory) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		stop(2, `could not read ${directory}: ${error.message}`);
	}
	const found = entries
		.filter((entry) => entry.isFile() && LICENCE_FILENAMES.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	if (found.length === 0) return null;
	return readFileSync(join(directory, found[0]), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

function describe(name) {
	const directory = join(ROOT, 'node_modules', ...name.split('/'));
	const manifestPath = join(directory, 'package.json');
	if (!existsSync(manifestPath)) {
		stop(
			2,
			`the bundle contains ${name} and it is not installed at ${manifestPath}.\n` +
				'  Run `npm install` and rebuild; attributing a package that is not on disk would mean\n' +
				'  transcribing its version from somewhere other than the thing that shipped.',
		);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const licence =
		typeof manifest.license === 'string'
			? manifest.license
			: (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? null);

	if (!licence) {
		stop(2, `${name}@${manifest.version} declares no licence. It cannot be shipped unattributed.`);
	}
	if (!ALLOWED_LICENCES.has(licence)) {
		stop(
			2,
			`${name}@${manifest.version} is ${licence}, which is not on this project's allow list.\n` +
				`  Allowed: ${[...ALLOWED_LICENCES].join(', ')}.\n` +
				'  This gate runs over what is BUNDLED, not over the production dependency tree — that\n' +
				'  tree is empty by design, so a gate scoped to it would inspect nothing and pass.',
		);
	}

	let text = readLicenceText(directory);
	let transcribed = null;

	if (!text && TRANSCRIBED[name]) {
		const entry = TRANSCRIBED[name];
		const path = join(ROOT, 'scripts', 'licences', entry.file);
		if (!existsSync(path)) {
			stop(
				2,
				`${name}@${manifest.version} is listed as transcribed and ${entry.file} is not in\n` +
					'  scripts/licences/. An exception with no text behind it attributes nothing.',
			);
		}
		text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
		transcribed = entry;
	}

	if (!text) {
		stop(
			2,
			`${name}@${manifest.version} is ${licence} and carries no licence file, so there is no\n` +
				'  copyright notice to reproduce. Every licence on the allow list conditions\n' +
				'  redistribution on carrying one. If the text exists upstream and the tarball simply\n' +
				'  omits it, add it to scripts/licences/ and name it in TRANSCRIBED.',
		);
	}

	return {
		name,
		version: manifest.version,
		licence,
		homepage: manifest.homepage ?? repositoryUrl(manifest) ?? null,
		text,
		transcribed,
	};
}

function repositoryUrl(manifest) {
	const repository = manifest.repository;
	const url = typeof repository === 'string' ? repository : repository?.url;
	if (!url) return null;
	return url
		.replace(/^git\+/, '')
		.replace(/\.git$/, '')
		.replace(/^git:\/\//, 'https://');
}

function render(packages) {
	const lines = [];
	lines.push('# Third-party notices');
	lines.push('');
	lines.push(
		'This file is **generated** by `scripts/third-party-notices.mjs` from the packages the build',
		'actually put into `dist/`. Do not edit it by hand — run `npm run build && npm run notices`.',
		'A test asserts that what is here is what the generator would write today.',
	);
	lines.push('');
	lines.push(
		'The published package declares **no runtime dependencies**: `dependencies` is `{}` and',
		'installing it installs nothing else. The libraries below are compiled into the prebuilt',
		'browser application that ships in `dist/`, which is why they are redistributed and therefore',
		'why their notices are here. Nothing in this list is fetched at run time, and nothing in it is',
		'the `kscope` memory engine — that is a separate, closed-source program you install yourself,',
		'and it is not covered by this file or by this package’s licence.',
	);
	lines.push('');
	lines.push('| package | version | licence |');
	lines.push('| --- | --- | --- |');
	for (const pkg of packages) {
		const label = pkg.homepage ? `[${pkg.name}](${pkg.homepage})` : pkg.name;
		lines.push(`| ${label} | ${pkg.version} | ${pkg.licence} |`);
	}
	lines.push('');
	lines.push(
		'Each licence below is reproduced in full, because every one of them conditions',
		'redistribution on carrying its copyright notice and permission text along with the code.',
	);
	lines.push('');

	for (const pkg of packages) {
		lines.push('---');
		lines.push('');
		lines.push(`## ${pkg.name} ${pkg.version}`);
		lines.push('');
		lines.push(`Licence: ${pkg.licence}`);
		lines.push('');
		if (pkg.transcribed) {
			// Said in the shipped file, not only in the generator: a reader checking this attribution
			// against the tarball would otherwise find no such file and have no way to tell whether
			// the text below was fetched or invented.
			lines.push(
				`The text below is not in this package's published tarball — ${pkg.transcribed.why} ` +
					`It is reproduced from ${pkg.transcribed.source} and is kept in this repository at ` +
					`\`scripts/licences/${pkg.transcribed.file}\`.`,
			);
			lines.push('');
		}
		lines.push('```');
		lines.push(pkg.text);
		lines.push('```');
		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

/** The document this repository would publish today, as a string. Exported so a test can diff it. */
export function generateNotices() {
	const names = readBundleRecord();
	return render(names.map(describe));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const wanted = generateNotices();
	const check = process.argv.includes('--check');

	if (!check) {
		writeFileSync(OUTPUT, wanted);
		process.stdout.write(
			`third-party-notices: wrote THIRD_PARTY_NOTICES.md — ` +
				`${wanted.split('\n## ').length - 1} bundled packages.\n`,
		);
		process.exit(0);
	}

	const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : null;
	if (current === wanted) {
		process.stdout.write('third-party-notices: current.\n');
		process.exit(0);
	}

	// A diff by line, not a "they differ" — the whole value of a generated file is that the reason
	// it went stale is legible without running the generator twice by hand.
	const before = (current ?? '').split('\n');
	const after = wanted.split('\n');
	process.stderr.write('third-party-notices: THIRD_PARTY_NOTICES.md is not what the build says.\n');
	for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
		if (before[i] === after[i]) continue;
		if (before[i] !== undefined) process.stderr.write(`  -${i + 1} ${before[i]}\n`);
		if (after[i] !== undefined) process.stderr.write(`  +${i + 1} ${after[i]}\n`);
	}
	process.stderr.write('\n  Run `npm run build && npm run notices` and commit the result.\n');
	process.exit(1);
}
