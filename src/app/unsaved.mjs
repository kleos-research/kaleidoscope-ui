import { createContext, useContext, useEffect } from 'react';

/**
 * HOW A SCREEN SAYS "A RELOAD WOULD COST SOMETHING HERE".
 *
 * There is exactly one thing in this app that throws the whole page away and rebuilds it: switching
 * vaults. Every screen under it is unmounted, every buffer in memory goes with them, and this
 * product has no undo — so the switch has to be able to ask before it does that, and it cannot ask
 * about state it cannot see. `App` holds the router and the shell; it does not hold the editor's
 * buffer, and it must not, because a shell that knew what was in the editor would be an application
 * rather than a shell (see `focus-actions.mjs`, which solved the mirror-image problem).
 *
 * So a screen DECLARES, in two words that are deliberately not one:
 *
 *   `unsaved`  there are words here that exist nowhere else. Ask before discarding them.
 *   `busy`     a call is in flight. Do not discard OR interrupt: wait for it to land.
 *
 * They are separate because the remedies are opposite. Unsaved work is the user's to abandon, and a
 * confirmation is the right shape for it. A write in flight is not theirs to abandon — the vault is
 * mid-change, and tearing the server down under it would leave a state nobody can report on.
 *
 * The default is a no-op rather than a throw: a screen rendered without the provider — a test, a
 * future harness — should render, and lose its guard, rather than crash.
 */
export const UnsavedContext = createContext(() => {});

/**
 * Declare this screen's state, and take the declaration back when it unmounts.
 *
 * The unmount clear is the load-bearing half. A screen that vanished while it was declaring unsaved
 * work would leave the guard armed over a page with nothing on it, and the next switch would ask
 * about typing that no longer exists — which teaches a reader to dismiss the question, which is
 * exactly what a confirmation must not do.
 *
 * @param {{unsaved?: boolean, busy?: boolean}} state
 */
export function useUnsaved({ unsaved = false, busy = false } = {}) {
	const declare = useContext(UnsavedContext);
	useEffect(() => {
		declare({ unsaved, busy });
		return () => declare({ unsaved: false, busy: false });
	}, [declare, unsaved, busy]);
}
