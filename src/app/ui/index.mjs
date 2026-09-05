/*
 * THE ONE DOOR INTO THE DESIGN SYSTEM.
 *
 * Every screen imports from here and from nowhere else in this directory. That is not tidiness: the
 * previous design went inconsistent because each screen reached for whatever was nearest and grew
 * its own spelling of the same object, and the owner could see the result — "I don't think that's
 * aligned correctly. I don't think there's enough padding."
 *
 * THE RULES A SCREEN INHERITS BY IMPORTING FROM HERE
 *
 *   1. A screen spells no colour, no type size, no radius and no spacing value. If a value is
 *      needed and no token carries it, the design did not decide it — say so rather than guess.
 *   2. A screen writes no vocabulary down. Memory types, relation names and entity kinds are read
 *      from the engine at runtime and rendered exactly as spelled. `Combobox` is the control that
 *      makes that possible; `Select` is only for genuinely closed choices this app owns.
 *   3. One filled `Button tone="primary"` per screen. Everything else is `default` or `quiet`.
 *   4. Anything that is not the screen's first or second thing becomes a `DetailRow` — closed, with
 *      its count visible. That is the whole answer to "too much information overload on any page".
 *   5. Nothing loads over the network. The fonts are in this package; there is no icon CDN and no
 *      analytics tag, and a test scans the built bundle for both.
 *   6. A tooltip may repeat or amplify; it may never carry the only copy of anything.
 */

export { cx } from './cx.mjs';

/* Controls */
export { Button, IconButton } from './button.jsx';
export { Field, FindInput, Input, ProseField, Textarea, TitleInput, UnsetField } from './field.jsx';
export { Select, SelectGroup, SelectItem, SelectSeparator } from './select.jsx';
export { Combobox, isNewValue, matchOptions } from './combobox.jsx';
export { Checkbox, ChoiceRow } from './choice.jsx';

/* Floating things */
export {
	Dialog,
	DialogClose,
	DropdownMenu,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	Popover,
	Tooltip,
	TooltipProvider,
} from './overlays.jsx';

/* Structure */
export { SegmentedControl, Tab, TabPanel, Tabs, TabsList } from './tabs.jsx';
export { DegreeBar, Table, Td, Th, Tr } from './table.jsx';
export { DetailRow, DetailRows } from './collapsible.jsx';
export { Band, PaneBody, PaneFoot, PaneHead } from './pane.jsx';
export { Facet, FilterPanel } from './filter-panel.jsx';
export {
	BulkBar,
	ListBar,
	MemoryRow,
	MemoryRows,
	Preview,
	PreviewBlock,
	PreviewHead,
	TimeHeading,
} from './browse.jsx';
export { edgeLabelsFit, EgoGraph, layout as egoLayout } from './ego-graph.jsx';
/*
 * THE WHOLE-VAULT OVERVIEW. A canvas, not SVG, and the only drawing in this product that paints
 * every name at once — see the head of the file for why those are two different renderers.
 */
export { VaultCanvas } from './vault-canvas.jsx';
export { PageHead, PageSection } from './page.jsx';
export { Decision, DecisionList, Rewrite, Rewrites, RunBar, Source, Sources } from './decision.jsx';
export { Note, Stat, StatNote, StatStrip } from './stat.jsx';

/* Reading a memory: the two columns, and the pieces the mockups draw in them. */
export {
	Evidence,
	FactList,
	FactSentence,
	LinkCard,
	NamedThing,
	NoteQuote,
	Reading,
	ReadingPair,
	Readings,
	Section,
	looksLikeLocator,
} from './reading.jsx';

/* Asking for an answer on the page, and reporting what happened when it was given. */
export { Outcome, Outcomes, Prompt, PromptList, PromptNote, PromptSentence, Verbatim } from './prompt.jsx';
export { AskBox, AskLayout, RankedResult, ResultBlock, ResultList } from './search.jsx';

/* Marks and text */
export { Badge, Chip, EvidenceTag, RankBadge, RelationBadge } from './badge.jsx';
export {
	Card,
	Display,
	Eyebrow,
	Identifier,
	KindLegend,
	Meter,
	NotRecorded,
	Rule,
	ScopeLine,
	ScopeValue,
} from './text.jsx';
export * as Icon from './icons.jsx';

/* The states a screen can be in instead of itself */
export {
	EmptyState,
	ErrorState,
	InlineBusy,
	LoadingState,
	TooLargeState,
} from './states.jsx';
export { ToastProvider, useToast } from './toast.jsx';

/* The shell */
export {
	AppShell,
	DESTINATIONS,
	FindOrAsk,
	FocusBar,
	Nav,
	OverflowMenu,
	Page,
	ProjectSwitcher,
	RootBar,
	VaultName,
} from './shell.jsx';
