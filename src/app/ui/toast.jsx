import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { Button } from './button.jsx';
import { cx } from './cx.mjs';

/**
 * A toast is for something that HAPPENED and is over.
 *
 * "The filter was cleared." "A copy was kept." "Six memories were rewritten." It is a receipt, not
 * a channel — and this product has two things that specifically must NOT be toasts, so the rule is
 * written here where it can be found:
 *
 *   * A REFUSAL IS NEVER A TOAST. A write the engine declined, a listing too large to load, a
 *     conflict — each of those is a state the screen is in, and the reader has to do something
 *     about it. A message that disappears on a timer is the worst possible carrier for one.
 *   * A CAVEAT IS NEVER A TOAST. "This drawing is a reconstruction", "asking is recorded in the
 *     vault" — those must be readable at the moment they matter, which is not five seconds after
 *     the screen opened.
 *
 * What is left is genuinely small, and it goes here.
 */

const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
	const [toasts, setToasts] = useState([]);

	const dismiss = useCallback((id) => {
		setToasts((current) => current.filter((toast) => toast.id !== id));
	}, []);

	const toast = useCallback(
		({ title, description = null, tone = 'neutral', action = null, duration = 6000 }) => {
			const id = (nextId += 1);
			setToasts((current) => [...current, { id, title, description, tone, action, duration }]);
			return id;
		},
		[],
	);

	const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

	return (
		<ToastContext.Provider value={value}>
			<RadixToast.Provider swipeDirection="right">
				{children}
				{toasts.map((entry) => (
					<RadixToast.Root
						key={entry.id}
						duration={entry.duration}
						onOpenChange={(open) => {
							if (!open) dismiss(entry.id);
						}}
						className={cx('toast', entry.tone === 'warn' && 'toast-warn')}
					>
						<div className="toast-body">
							<RadixToast.Title className="toast-title">{entry.title}</RadixToast.Title>
							{entry.description ? (
								<RadixToast.Description className="toast-description">
									{entry.description}
								</RadixToast.Description>
							) : null}
						</div>
						{entry.action ? (
							<RadixToast.Action asChild altText={entry.action.label}>
								<Button tone="quiet" onClick={entry.action.onSelect}>
									{entry.action.label}
								</Button>
							</RadixToast.Action>
						) : null}
					</RadixToast.Root>
				))}
				<RadixToast.Viewport className="toast-viewport" />
			</RadixToast.Provider>
		</ToastContext.Provider>
	);
}

/**
 * `const { toast } = useToast()`.
 *
 * Returns a no-op outside the provider rather than throwing. A screen rendered in isolation — a
 * test, a future storybook — should not crash because it announced something.
 */
export function useToast() {
	return useContext(ToastContext) ?? { toast: () => null, dismiss: () => {} };
}
