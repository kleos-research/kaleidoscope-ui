/*
 * The icon set: inline stroke SVG on a 24 viewbox, drawn from the approved mockups.
 *
 * WHY THESE ARE NOT AN ICON PACKAGE. Two reasons, and the first is the smaller one: every icon
 * library worth having ships a thousand glyphs and this product uses eleven, so what would arrive
 * is a tree-shaking problem in exchange for a dependency. The real reason is that the mockups draw
 * these glyphs with specific geometry — the refresh arc, the three-dot spacing, the chevron
 * proportions — and an imported set would silently substitute a different drawing for a design
 * that has been approved.
 *
 * NO EMOJI ANYWHERE. An emoji is a font-dependent picture that changes shape per platform, cannot
 * take a colour, and is read aloud by a screen reader as its CLDR name. These are `aria-hidden`
 * marks that inherit `currentColor`, and every control that carries one also carries a word or an
 * `aria-label`.
 *
 * STROKE WEIGHT IS A FUNCTION OF SIZE, not a prop. The mockups hand-tune it — 2.5 on a 12px
 * chevron, 2.2 on a 15px one, 2.0 on a 16px search — because a constant stroke on a shrinking glyph
 * reads as a lighter icon. The formula reproduces that so a screen never has to know it.
 */

/** Optically constant weight: heavier line on a smaller glyph. Bounded so it never goes cartoonish. */
const strokeFor = (size) => Math.min(2.6, Math.max(1.9, 32 / size));

function Glyph({ size = 15, title = null, children, ...rest }) {
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeFor(size)}
			strokeLinecap="round"
			strokeLinejoin="round"
			// An icon beside a word is decoration; an icon that IS the control gets a title, and the
			// control it sits in gets the aria-label. Nothing here is ever the only label.
			aria-hidden={title ? undefined : 'true'}
			role={title ? 'img' : undefined}
			focusable="false"
			{...rest}
		>
			{title ? <title>{title}</title> : null}
			{children}
		</svg>
	);
}

export function ChevronDown(props) {
	return (
		<Glyph {...props}>
			<polyline points="6 9 12 15 18 9" />
		</Glyph>
	);
}

export function ChevronRight(props) {
	return (
		<Glyph {...props}>
			<polyline points="9 18 15 12 9 6" />
		</Glyph>
	);
}

export function ChevronLeft(props) {
	return (
		<Glyph {...props}>
			<polyline points="15 18 9 12 15 6" />
		</Glyph>
	);
}

export function Search(props) {
	return (
		<Glyph {...props}>
			<circle cx="11" cy="11" r="7" />
			<line x1="21" y1="21" x2="16.5" y2="16.5" />
		</Glyph>
	);
}

export function Refresh(props) {
	return (
		<Glyph {...props}>
			<polyline points="23 4 23 10 17 10" />
			<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
		</Glyph>
	);
}

/** The overflow control. Filled dots rather than stroked circles, exactly as the mockups draw it. */
export function More(props) {
	return (
		<Glyph {...props}>
			<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
		</Glyph>
	);
}

export function Plus(props) {
	return (
		<Glyph {...props}>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</Glyph>
	);
}

export function Close(props) {
	return (
		<Glyph {...props}>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</Glyph>
	);
}

export function Check(props) {
	return (
		<Glyph {...props}>
			<polyline points="5 12.5 10 17 19 7" />
		</Glyph>
	);
}

/** "Details" — everything about this memory that is not its words or its facts. */
export function Settings(props) {
	return (
		<Glyph {...props}>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
		</Glyph>
	);
}

/** The mark beside a sentence the reader must not miss. Never a warning triangle. */
export function Info(props) {
	return (
		<Glyph {...props}>
			<circle cx="12" cy="12" r="9" />
			<line x1="12" y1="11" x2="12" y2="16" />
			<circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
		</Glyph>
	);
}

export function Filter(props) {
	return (
		<Glyph {...props}>
			<line x1="4" y1="7" x2="20" y2="7" />
			<line x1="7" y1="12" x2="17" y2="12" />
			<line x1="10" y1="17" x2="14" y2="17" />
		</Glyph>
	);
}

/** A drawing pin, for the control that keeps a name on the canvas while another is opened. */
export function Pin(props) {
	return (
		<Glyph {...props}>
			<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
			<line x1="12" y1="15" x2="12" y2="21" />
		</Glyph>
	);
}
