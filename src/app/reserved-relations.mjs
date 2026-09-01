/**
 * THE ONE LIST IN THIS REPOSITORY THAT IS WRITTEN DOWN, AND IT IS A DENIAL LIST.
 *
 * Every other vocabulary in this app is read from the engine at launch, because a value transcribed
 * into a control drifts from the engine without anyone noticing and the records written through it
 * still look like data. This file is the exception, and the reason is the direction it fails in.
 *
 *   A stale DENIAL list fails SAFE: it refuses something that has since become permitted, the user
 *   sees a message, and nothing is written wrong.
 *
 *   A stale ALLOW list fails OPEN: it offers something the engine has since started refusing, the
 *   write is accepted, and the damage is silent.
 *
 * These names are emitted by the engine itself and refused from a writer. Typing one does not
 * produce a clean refusal — the memory COMMITS and its graph entry fails, under its own error code,
 * with no published operation that repairs it. So the relation control excludes them and refuses
 * them on submit, and it does so from the union of this list and the one the engine printed a
 * moment ago, not from either alone.
 *
 * The runtime list is authoritative and this one is a floor under it. `deniedRelations()` unions the
 * two, and a test asserts the runtime set is a SUPERSET of this file — so drift is detected rather
 * than assumed away. If that test goes red, the engine has stopped printing a name that is on this
 * list: check whether it became permitted before deleting the entry.
 *
 * Everything here is printed verbatim by `kscope schema remember` on a released build, which is
 * published surface. Nothing about how the engine decides anything is in it.
 */

/**
 * The reserved names, and for each one whether it means *these two names are the same thing*.
 *
 * The distinction is not decoration. The identity-merge names are the most natural thing in the
 * world to type when a user is looking at one thing spelled two ways, which is the single most
 * common reason a person opens this editor at all. They get a redirect to the operation that
 * actually does that job rather than a flat refusal, because a refusal with no route out is a user
 * who types a bare synonym instead and fragments the graph the other way.
 */
export const RESERVED_RELATIONS = [
	{ name: 'contradicts', means_identity: false },
	{ name: 'justified_by', means_identity: false },
	{ name: 'not_same_as', means_identity: true },
	{ name: 'possibly_same_as', means_identity: true },
	{ name: 'same_as', means_identity: true },
	{ name: 'supersedes', means_identity: false },
];

/** Just the names, for the superset test and for anything that only needs membership. */
export const RESERVED_RELATION_NAMES = RESERVED_RELATIONS.map((entry) => entry.name);

const IDENTITY_NAMES = new Set(
	RESERVED_RELATIONS.filter((entry) => entry.means_identity).map((entry) => entry.name),
);

/**
 * Every relation name a writer may not author: the engine's own list, unioned with the floor above.
 *
 * @param {Record<string, string[]>} denied  the `denied` map from the runtime write contract
 * @returns {Set<string>}
 */
export function deniedRelations(denied) {
	const names = new Set(RESERVED_RELATION_NAMES);
	for (const values of Object.values(denied ?? {})) {
		for (const value of values ?? []) names.add(value);
	}
	return names;
}

/**
 * What to tell someone who typed a reserved name.
 *
 * The two sentences are different because the two situations are: one is a name the engine writes
 * for itself, and the other is a job this screen genuinely cannot do and another one can.
 */
export function reservedRelationAdvice(name) {
	if (IDENTITY_NAMES.has(name)) {
		return (
			`"${name}" is one of the names kscope writes for itself, and a memory that authors it ` +
			`commits with no graph entry at all — which nothing repairs. Saying two names are the ` +
			`same thing is a rename, across every memory that uses either spelling, and it is not ` +
			`something one memory can state. This build has no rename screen yet, so the honest ` +
			`route today is a relation of your own that says what you mean.`
		);
	}
	return (
		`"${name}" is one of the names kscope writes for itself and refuses from a writer. A memory ` +
		`that authors it commits and its graph entry fails, and no published operation repairs ` +
		`that. Choose a different relation.`
	);
}
