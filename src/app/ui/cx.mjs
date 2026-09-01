/**
 * Join class names, dropping anything falsy.
 *
 * Four lines rather than a dependency, because that is genuinely all it is. `clsx` and
 * `tailwind-merge` earn their place in a codebase where class strings carry conflicting utilities
 * that have to be resolved by precedence; here a component has one base class and a variant, and
 * there is nothing to merge.
 */
export function cx(...parts) {
	return parts.filter(Boolean).join(' ');
}
