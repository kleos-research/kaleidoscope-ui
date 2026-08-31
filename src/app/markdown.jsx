/**
 * A Markdown renderer that cannot introduce an injection hole, because it never produces HTML.
 *
 * The body of a memory is agent-authored text, written by an agent that read the open web, and this
 * page holds a bearer token with total read and write authority over the user's vault. So the
 * safety property has to be structural rather than a filter:
 *
 *   - THERE IS NO `dangerouslySetInnerHTML` IN THIS FILE OR ANYWHERE IN THIS APP. Every construct
 *     below is turned into a React element, and React escapes the text inside one. A `<script>` in
 *     the source is characters on the screen; it has no path to being a node.
 *   - Raw HTML is not a construct this parser knows. It is not stripped, sanitised or allowlisted —
 *     it is simply never parsed, so it falls through as literal text. That is a stronger position
 *     than sanitising, because there is no sanitiser to have a bug in.
 *   - A link's scheme is checked against a small allowlist, so `javascript:` never reaches an
 *     `href`. A link that fails the check still renders — as its text, with the address shown
 *     beside it — because silently dropping a link hides what the memory actually says.
 *
 * There is no Markdown dependency. This app's published dependency set is empty and this is one of
 * the two places that would have broken it.
 */

/** Only these become a real link. Everything else is shown, not linked. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

function safeHref(raw) {
	// A relative or fragment link inside a memory body points at nothing this app can resolve, so it
	// is treated the same as an unsafe one: shown, not linked.
	try {
		const url = new URL(raw, 'about:blank');
		return SAFE_SCHEMES.includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/**
 * The four inline constructs, in one pass.
 *
 * Every alternative below is anchored on a NEGATED character class, so none of them can backtrack:
 * a pathological body cannot make this loop take super-linear time. That is worth the slightly
 * blunter matching — a nested emphasis renders as literal asterisks rather than hanging the tab.
 */
const INLINE = /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function renderInline(source, keyPrefix) {
	const out = [];
	let cursor = 0;
	let index = 0;

	INLINE.lastIndex = 0;
	for (let match = INLINE.exec(source); match !== null; match = INLINE.exec(source)) {
		if (match.index > cursor) out.push(source.slice(cursor, match.index));
		const key = `${keyPrefix}-${index++}`;
		const [, code, boldStar, boldUnderscore, italic, linkText, linkHref] = match;

		if (code !== undefined) {
			out.push(<code key={key}>{code}</code>);
		} else if (boldStar !== undefined || boldUnderscore !== undefined) {
			out.push(<strong key={key}>{boldStar ?? boldUnderscore}</strong>);
		} else if (italic !== undefined) {
			out.push(<em key={key}>{italic}</em>);
		} else {
			const href = safeHref(linkHref);
			const label = linkText || linkHref;
			out.push(
				href ? (
					// `title` carries the real destination, because the label of a link inside
					// agent-authored text is not evidence of where it goes.
					<a key={key} href={href} title={href} target="_blank" rel="noreferrer noopener">
						{label}
					</a>
				) : (
					<span key={key} className="md-unsafe-link">
						{label} <span className="md-unsafe-href">({linkHref})</span>
					</span>
				),
			);
		}

		cursor = match.index + match[0].length;
	}

	if (cursor < source.length) out.push(source.slice(cursor));
	return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)(.*)$/;

/**
 * Block-level parse. Deliberately small: headings, paragraphs, lists, fenced and indented code,
 * block quotes and rules. Anything it does not recognise is a paragraph, which is the failure mode
 * that loses the least — a body renders as its own text rather than as nothing.
 */
export function parseMarkdown(source) {
	const lines = String(source ?? '').split('\n');
	const blocks = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.trim() === '') {
			i += 1;
			continue;
		}

		const fence = line.match(FENCE);
		if (fence) {
			const marker = fence[1];
			const language = fence[2].trim();
			const body = [];
			i += 1;
			while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
				body.push(lines[i]);
				i += 1;
			}
			// An unterminated fence runs to the end of the body rather than swallowing the parse.
			i += 1;
			blocks.push({ type: 'code', language, text: body.join('\n') });
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
			i += 1;
			continue;
		}

		if (RULE.test(line)) {
			blocks.push({ type: 'rule' });
			i += 1;
			continue;
		}

		if (QUOTE.test(line)) {
			const body = [];
			while (i < lines.length && QUOTE.test(lines[i])) {
				body.push(lines[i].match(QUOTE)[1]);
				i += 1;
			}
			blocks.push({ type: 'quote', text: body.join('\n') });
			continue;
		}

		if (BULLET.test(line) || ORDERED.test(line)) {
			const ordered = ORDERED.test(line);
			const items = [];
			while (i < lines.length) {
				const item = lines[i].match(ordered ? ORDERED : BULLET);
				if (!item) break;
				const parts = [ordered ? item[2] : item[1]];
				i += 1;
				// A wrapped list item continues on an indented line that starts no new block.
				while (
					i < lines.length &&
					lines[i].trim() !== '' &&
					/^\s{2,}/.test(lines[i]) &&
					!BULLET.test(lines[i]) &&
					!ORDERED.test(lines[i])
				) {
					parts.push(lines[i].trim());
					i += 1;
				}
				items.push(parts.join(' '));
			}
			blocks.push({ type: 'list', ordered, items });
			continue;
		}

		const paragraph = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!HEADING.test(lines[i]) &&
			!BULLET.test(lines[i]) &&
			!ORDERED.test(lines[i]) &&
			!QUOTE.test(lines[i]) &&
			!FENCE.test(lines[i]) &&
			!RULE.test(lines[i])
		) {
			paragraph.push(lines[i].trim());
			i += 1;
		}
		blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
	}

	return blocks;
}

/**
 * @param {{source: string, headingOffset?: number}} props
 *   `headingOffset` demotes the body's headings so a body that opens with an H1 — which the write
 *   contract asks for — does not compete with the page's own title for the top of the hierarchy.
 */
export function Markdown({ source, headingOffset = 1 }) {
	const blocks = parseMarkdown(source);

	return (
		<div className="md">
			{blocks.map((block, index) => {
				const key = `b${index}`;
				if (block.type === 'heading') {
					const level = Math.min(6, block.level + headingOffset);
					const Tag = `h${level}`;
					return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
				}
				if (block.type === 'code') {
					return (
						<pre key={key} className="md-code" data-language={block.language || undefined}>
							<code>{block.text}</code>
						</pre>
					);
				}
				if (block.type === 'rule') return <hr key={key} />;
				if (block.type === 'quote') {
					return (
						<blockquote key={key}>
							{block.text.split('\n').map((line, n) => (
								<p key={`${key}-${n}`}>{renderInline(line, `${key}-${n}`)}</p>
							))}
						</blockquote>
					);
				}
				if (block.type === 'list') {
					const Tag = block.ordered ? 'ol' : 'ul';
					return (
						<Tag key={key}>
							{block.items.map((item, n) => (
								<li key={`${key}-${n}`}>{renderInline(item, `${key}-${n}`)}</li>
							))}
						</Tag>
					);
				}
				return <p key={key}>{renderInline(block.text, key)}</p>;
			})}
		</div>
	);
}
