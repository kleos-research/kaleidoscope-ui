import { createContext, useContext, useEffect } from 'react';

/**
 * HOW A FOCUS SCREEN PUTS ITS CONTROLS IN THE ONE BAR.
 *
 * `FocusBar` takes an `actions` node and `App` renders the bar, but the controls belong to the
 * screen underneath it: Details / Cancel / Save are the editor's, and only the editor knows whether
 * a save is in flight, whether anything is unsaved, and whether pressing Save right now would write
 * a second memory. The alternative — App holding that state so it can draw the buttons — is exactly
 * how a shell becomes an application, and the shell's own file says so.
 *
 * So the screen hands its controls UP, once, and the bar draws them. Two rules make that safe:
 *
 *   - the node is rebuilt only when something in it would look different, because it is produced
 *     inside an effect with the screen's own dependency list;
 *   - it is cleared on unmount, so a screen's Save button cannot outlive the screen and end up over
 *     a list it would write nothing to.
 *
 * The default is a no-op rather than a throw. A screen rendered without the provider — a test, a
 * future harness — should render its content and lose its bar controls, not crash.
 */
export const FocusActionsContext = createContext(() => {});

/**
 * @param render  () => the controls, called inside the effect so it closes over current state.
 * @param deps    what changes the controls. Everything the buttons read must be in here.
 */
export function useFocusActions(render, deps) {
	const setActions = useContext(FocusActionsContext);
	useEffect(() => {
		setActions(render());
		return () => setActions(null);
		// The render function is deliberately not a dependency: it is a new closure on every render,
		// and depending on it would rebuild the bar on every keystroke in the note.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
