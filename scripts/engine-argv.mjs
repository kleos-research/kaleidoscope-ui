// The argv a dev script or test uses to call the engine directly, outside the app.
//
// Newer engines print a text receipt from `call search` and `call remember` unless `--json` is on
// the line; older engines read `--json` as the durability argument and exit 2. Anything here that
// spawns the engine itself and parses its output has to ask for JSON on the first and must not on
// the second.
//
// This is deliberately a SECOND implementation of the rule in src/engine/call.mjs, not an import of
// it. Dev tooling and tests that shared the product's own detector would inherit any mistake in it
// and agree with it; an independent one disagrees, which is how a mistake gets seen. The product's
// detector is pinned by test/json-flag.test.mjs. It is synchronous because every caller here is.
//
// Not shipped: scripts/ is outside the package's `files`.

import { spawnSync } from 'node:child_process';

const supports = new Map();

/** Whether this engine documents `--json` in its help — the engine's own statement of support. */
export function takesJsonFlag(engine) {
	if (!supports.has(engine)) {
		const help = spawnSync(engine, ['--help'], { encoding: 'utf8', shell: false });
		supports.set(engine, help.status === 0 && `${help.stdout}\n${help.stderr}`.includes('--json'));
	}
	return supports.get(engine);
}

/** `['call', op]`, with `--json` BEFORE the verb when the engine takes it and the verb needs it. */
export function callArgv(engine, operation) {
	const receipt = operation === 'search' || operation === 'remember';
	return receipt && takesJsonFlag(engine) ? ['call', '--json', operation] : ['call', operation];
}
