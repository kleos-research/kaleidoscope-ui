import { Slot } from '@radix-ui/react-slot';

import { cx } from './cx.mjs';

/**
 * The one button.
 *
 * FOUR TONES, AND THE RULE ABOUT THE FIRST ONE. `primary` is the filled control and every approved
 * mockup has exactly one on screen — Edit, or Save, or "Ask the way your agent does". That is what
 * makes it findable in a screen made mostly of text. A second filled control on the same screen is
 * not a stronger call to action, it is two.
 *
 * `warn` is what a destructive control gets, and it is deliberately NOT a red fill. Removal in this
 * product hides a memory and keeps a copy of it; a red button says "gone", which is the one thing
 * removal does not mean. The word on the button is the warning.
 *
 * `asChild` renders the caller's element with these classes instead of a `<button>`, which is how a
 * link gets a button's shape without a `<button>` wrapped in an `<a>` — the shape a keyboard cannot
 * make sense of.
 */
export function Button({
	tone = 'default',
	size = 'md',
	block = false,
	asChild = false,
	className,
	type,
	...rest
}) {
	const Root = asChild ? Slot : 'button';
	return (
		<Root
			// A <button> inside a <form> submits it unless told otherwise, and this app has forms.
			// Defaulting to "button" means a control has to ask to submit rather than ask not to.
			type={asChild ? undefined : (type ?? 'button')}
			className={cx('btn', `btn-${tone}`, size === 'sm' && 'btn-sm', block && 'btn-block', className)}
			{...rest}
		/>
	);
}

/**
 * A square icon-only control — the 32×32 buttons in the top bar.
 *
 * `label` is REQUIRED and is not optional in spirit either: this renders no text, so without it the
 * control is announced as "button" and the icon is announced as nothing at all. It doubles as the
 * tooltip, which is why it is a sentence a person would say rather than a noun.
 */
export function IconButton({ label, children, className, ...rest }) {
	return (
		<button type="button" className={cx('btn', 'btn-icon', className)} aria-label={label} {...rest}>
			{children}
		</button>
	);
}
