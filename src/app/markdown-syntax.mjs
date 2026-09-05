/**
 * The Markdown this product understands — as one grammar, read from two sides.
 *
 * `markdown.jsx` turns a body into elements with these expressions, and the editor's words pane
 * reads the same body with them to find the characters that are syntax rather than prose. They
 * are ONE set on purpose: a pane that dimmed a construct the renderer did not know, or missed one
 * it did, would be telling the writer something false about what an agent will be served. The
 * grammar is here rather than in the renderer so the pane can reach it without pulling React into
 * a module a node test drives.
 *
 * Deliberately small, and identical to what the renderer accepted before this file existed:
 * headings, paragraphs, two kinds of list, fenced code, block quotes, rules, and four inline marks.
 * Raw HTML is not in it — it is never parsed, so it falls through as text on both sides.
 */

export const HEADING = /^(#{1,6})\s+(.*)$/;
export const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
export const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
export const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
export const QUOTE = /^\s{0,3}>\s?(.*)$/;
export const FENCE = /^\s{0,3}(```|~~~)(.*)$/;

/**
 * The four inline constructs, in one pass.
 *
 * Every alternative is anchored on a NEGATED character class, so none of them can backtrack: a
 * pathological body cannot make a loop over this take super-linear time. That is worth the
 * slightly blunter matching — a nested emphasis renders as literal asterisks rather than hanging
 * the tab.
 */
export const INLINE = /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/* -------------------------------------------------------------------------------- the marks */

/** The leading part of a line that is a marker rather than words: `# `, `- `, `3. `, `> `. */
const LINE_MARKER = /^(?:#{1,6}\s+|\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+|\s{0,3}>\s?)/;

/**
 * Cut one line of Markdown into the runs that are words and the runs that are syntax.
 *
 * WHAT IT RETURNS IS THE LINE, WHOLE. Concatenating the `text` of every segment gives back exactly
 * the string that went in — every character, every space — because the pane draws these under a
 * transparent textarea and the two have to wrap at the same places. A segmenter that dropped or
 * normalised one character would put the drawn words one glyph out from the caret, on every line
 * after it.
 *
 * What counts as syntax: a line's leading marker, the delimiters of the four inline constructs, a
 * link's target, a fence line, and a rule. What does not: the words between the delimiters, and
 * the contents of a code block — which are what the memory says, and stay at full strength.
 *
 * @returns {Array<{text: string, mark: boolean}>}
 */
export function markSyntax(source) {
	const lines = String(source ?? '').split('\n');
	const out = [];
	let fence = null;

	const push = (text, mark) => {
		if (text.length === 0) return;
		const last = out[out.length - 1];
		if (last && last.mark === mark) last.text += text;
		else out.push({ text, mark });
	};

	lines.forEach((line, index) => {
		if (fence !== null) {
			// Inside a fence everything is what the writer typed, until the line that closes it.
			if (line.trimStart().startsWith(fence)) {
				push(line, true);
				fence = null;
			} else push(line, false);
		} else {
			const opening = line.match(FENCE);
			if (opening) {
				push(line, true);
				fence = opening[1];
			} else if (RULE.test(line)) {
				push(line, true);
			} else {
				const marker = line.match(LINE_MARKER);
				const at = marker ? marker[0].length : 0;
				if (at > 0) push(line.slice(0, at), true);
				markInline(line.slice(at), push);
			}
		}
		if (index < lines.length - 1) push('\n', false);
	});

	return out;
}

/** The inline delimiters of one run of words, with the words between them left as words. */
function markInline(text, push) {
	let cursor = 0;
	for (const match of text.matchAll(INLINE)) {
		push(text.slice(cursor, match.index), false);
		const [whole, code, boldStar, boldUnderscore, italic, linkText, linkHref] = match;

		if (code !== undefined) {
			push('`', true);
			push(code, false);
			push('`', true);
		} else if (boldStar !== undefined) {
			push('**', true);
			push(boldStar, false);
			push('**', true);
		} else if (boldUnderscore !== undefined) {
			push('__', true);
			push(boldUnderscore, false);
			push('__', true);
		} else if (italic !== undefined) {
			push('*', true);
			push(italic, false);
			push('*', true);
		} else {
			// `[label](target)` — the label is words, and everything around it is the mechanism.
			push('[', true);
			push(linkText, false);
			push(`](${linkHref})`, true);
		}
		cursor = match.index + whole.length;
	}
	push(text.slice(cursor), false);
}
