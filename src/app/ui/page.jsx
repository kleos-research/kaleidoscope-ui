import { cx } from './cx.mjs';
import { Display } from './text.jsx';

/**
 * A SCREEN'S FIRST LINE, and the sentence under it.
 *
 * Every approved mockup opens the same way: a serif heading, one line of grey saying what is in
 * here, and — at the right, on the same baseline — the one control the screen is about. GraphEntry
 * draws "Things your memories talk about / 1,094 names across 836 statements" with a find box
 * beside it; Search, BrowseScale and ReadEvidence draw the same object with different words.
 *
 * It is a component rather than a pattern each screen re-draws because the previous design let six
 * screens each choose their own gap between a title and its subtitle, and the owner could see the
 * result without being able to name it.
 *
 * THE SUBTITLE IS NOT DECORATION. It carries the counts, and a heading with no counts under it is
 * the thing that made the last version feel like an inventory: a reader arriving at a screen needs
 * to know how much is in it before they can decide whether to work it.
 */
export function PageHead({ title, subtitle = null, level = 1, size = 'lg', actions = null }) {
	return (
		<header className="head">
			<div className="head-titles">
				<Display level={level} size={size}>
					{title}
				</Display>
				{subtitle ? <div className="head-sub">{subtitle}</div> : null}
			</div>
			{actions ? <div className="head-actions">{actions}</div> : null}
		</header>
	);
}

/**
 * A block inside a page: a heading with its count, the sentence that explains it, and the thing.
 *
 * `count` sits on the heading rather than in the body for the same reason `DetailRow` carries one —
 * a reader deciding whether to read a section is deciding on that number, and a section that makes
 * them read it to find out has already cost them the thing it was trying to save.
 */
export function PageSection({
	title,
	count = null,
	tone = 'neutral',
	level = 2,
	size = 'sm',
	aside = null,
	children,
	className,
}) {
	return (
		<section className={cx('section', className)}>
			{title ? (
				<div className="section-head">
					<Display level={level} size={size}>
						{title}
						{count === null ? null : (
							<span className={cx('section-count', tone === 'warn' && 'section-count-warn')}>
								{count}
							</span>
						)}
					</Display>
					{aside}
				</div>
			) : null}
			{children}
		</section>
	);
}
