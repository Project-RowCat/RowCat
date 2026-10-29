/**
 * An update note is a product announcement describing what changed in a release.
 *
 * - It is not `app_update`, which is the minimum supported app version floor set by operators.
 *   Merging the two would tie raising the floor to writing release notes, and pulling a note would
 *   require locking the app. So this module adds no NotificationKind value and does not go through
 *   the notification plane.
 * - A note is passive and never opens on its own. A dot on the Updates tab of the notification
 *   screen marks that a new note exists; only the user opens it. An auto-open window was removed,
 *   because release news is neither consent nor confirmation, and gating the app on it would turn
 *   it into a gate.
 * - The public identity is the date (releasedAt). SemVer is an internal axis, per the
 *   repository's versioning rule (`## Versioning`), and appears only where stores and package managers
 *   need it. internalVersion exists only in authored records.
 * - Keeping internalVersion out of the public projection is structural. UpdateNote has no field
 *   for it, and the projection does not spread the record. A projection that selects fields can
 *   forget one; a field that does not exist cannot leak.
 * - The in-app note and the Discord post are separate texts for the same release, each authored
 *   on its own. In-app is a skim with short lines. Discord is read in full, and items can carry
 *   detail. Deriving one from the other by string conversion would always break one of them.
 * - Out of scope: commit messages (users need what changed for them, not how the code changed),
 *   server-side read state (the flag is per device; a server table would add only 'not shown on
 *   other devices'), the clock (a note is published when it is in the list, and releasedAt is not
 *   compared with today: publication is a deployed fact, not a calendar event), and HTML
 *   or Markdown parsing (typed data only; a parser would add a dependency to the domain).
 */

import { UPDATE_NOTE_RUNTIME_RECORDS } from "./update-notes/generated/update-notes.ts";

/**
 * Surfaces a note targets. This is a closed vocabulary, because a release does not always touch
 * both apps. A note for a mobile-only screen should not appear on web.
 *
 * Surfaces are not keyed by store version strings (ios and android are absent on purpose). Store
 * comparison belongs to ops_app_version_floor, which compares real store builds. This value only
 * asks which app draws the screen. If notes must differ per store one day, a value will be added
 * then, with a commit explaining why.
 */
export const UPDATE_SURFACES = ["web", "mobile"] as const;
export type UpdateSurface = (typeof UPDATE_SURFACES)[number];

/**
 * The four sections, in a fixed order. The order carries meaning: what users can newly do comes
 * first, and the last section holds facts users must know (rollout, limits, separate action). If
 * each screen chose its own order, one release would read differently on web and in the app.
 *
 * A fifth section (for example security or known issues) should first be shown not to fit any of
 * the four. Each new section makes authors decide every time where something goes, and that
 * decision usually ends in an arbitrary choice.
 */
export const UPDATE_NOTE_SECTION_ORDER = [
	"additions",
	"improvements",
	"fixes",
	"notices",
] as const;
export type UpdateNoteSectionId = (typeof UPDATE_NOTE_SECTION_ORDER)[number];

/**
 * Section labels: words only. Decoration belongs to each surface.
 *
 * The table lives here because three consumers read it: the web update dialog, the mobile update
 * dialog, and the Discord output. Separate copies would give one release's section three names, and
 * the pasted Discord text would differ from what the app showed.
 *
 * The emoji that was once part of this value now lives only in the Discord prefix table. Screen
 * code must not retype these words; the static scans of both apps enforce that.
 */
export const UPDATE_NOTE_SECTION_LABEL: Record<UpdateNoteSectionId, string> = {
	additions: "New features",
	improvements: "Improvements",
	fixes: "Fixes",
	notices: "Notes",
};

/**
 * Emoji prefix for Discord section headings. It is not exported, and only renderDiscordUpdateNote
 * reads it. Exporting it would let the app import it and draw emoji on screen again, a bypass that
 * passes compile and type checks. Keeping it private makes that path unrepresentable, the same way
 * the public projection lacks internalVersion.
 *
 * It is appended in exactly one place (`${prefix} ${label}`). Putting the prefix back into the
 * labels would return this file to its earlier state, where in-app screens drew an icon and an
 * emoji side by side.
 */
const UPDATE_NOTE_SECTION_DISCORD_PREFIX = {
	additions: "✨",
	improvements: "✅",
	fixes: "🛠️",
	notices: "❗",
} satisfies Record<UpdateNoteSectionId, string>;

/**
 * Sections of an in-app body. A section with nothing to say has no key at all; it is not an empty
 * array.
 */
type InAppSections = {
	readonly [K in UpdateNoteSectionId]?: readonly string[];
};

/**
 * The in-app body of a note, kept short. Each line is one change, saying what users can now do or
 * what got better.
 *
 * Turning an implementation detail into a sentence (for example `changed the inefficient data loading approach…`) produces
 * a long line that means nothing to readers. After the next release, nobody opens the note.
 */
export interface UpdateNoteContent extends InAppSections {
	/**
	 * A sentence or two for the whole release. Optional; without it the sections start immediately.
	 */
	readonly intro?: string;
}

/**
 * A Discord item has a title and an optional detail. Detail is optional because a fix is usually
 * one line, while a new feature may need several lines to say what it allows. Making detail
 * required would push authors to pad short items or squeeze long explanations into titles.
 */
export interface DiscordUpdateItem {
	readonly title: string;
	readonly detail?: string;
}

type DiscordSections = {
	readonly [K in UpdateNoteSectionId]?: readonly DiscordUpdateItem[];
};

/**
 * Discord post body. It uses the same sections as the in-app note but is written as separate text,
 * because readers see the same release in two places. The texts differ because the two reading
 * contexts differ. The in-app body has no function that produces this value (see the module header,
 * 'two representations').
 */
export interface DiscordUpdateNoteContent extends DiscordSections {
	readonly intro?: string;
}

/**
 * A release as the app holds it. Authoring axes are structurally absent: `internalVersion` and
 * `discord` have no place in this type. The earlier public projection kept them out only because it
 * did not spread the record. Now the values are absent from the data the app holds. A function that
 * picks fields can forget to omit a key, but a value that is not in the type cannot be forgotten.
 *
 * The only place a value of this type lives is the generated registry
 * (update-notes/generated/update-notes.ts). `surfaces` stays because selection reads it
 * (updateNotesFor). It does not reach the public projection, since a decision already made need not
 * be read again.
 */
export interface UpdateNoteRuntimeRecord {
	/**
	 * Public identity and the source of the title. `YYYY-MM-DD`, a calendar date in the product time
	 * zone.
	 */
	readonly releasedAt: string;
	/**
	 * Surfaces that draw this note. Omitting it means all surfaces. The default is deliberately wide:
	 * if a forgotten surface defaulted to showing less, the omission would produce no symptom, since a
	 * release nobody sees is silent.
	 */
	readonly surfaces?: readonly UpdateSurface[];
	readonly inApp: UpdateNoteContent;
}

/**
 * An authored release, including the internal axis. Values of this type exist only in files under
 * update-notes/releases/<year>/<date>.ts. The app cannot import them: the package root does not
 * export authored sources, and the loader that reads them is a Node-only tool outside src/. The
 * static scans of both apps also block subpaths. The app holds only generated runtime records and
 * their public projections.
 */
export interface UpdateNoteRecord extends UpdateNoteRuntimeRecord {
	/**
	 * The internal version of this release, linking the date to the deployment and build. It is not
	 * shown to users or on Discord, and it is not in the generated output. It is recorded because
	 * people read it: when an incident happens, this is the one place to find which build a given
	 * date's note corresponds to. The renderer writes keys individually so the value never reaches the
	 * app, and scripts/update-note-sources.test.ts checks that by value.
	 */
	readonly internalVersion?: string;
	/**
	 * The Discord body. If absent, the release is not posted to Discord. This value is not in the
	 * generated output either.
	 */
	readonly discord?: DiscordUpdateNoteContent;
}

/** A section that will be drawn. Empty sections never reach this type. */
export interface UpdateNoteSection {
	readonly id: UpdateNoteSectionId;
	readonly label: string;
	readonly items: readonly string[];
}

/**
 * The note the app draws. Internal axes are structurally absent: neither `internalVersion` nor
 * `surfaces` has a place in this type. The first must never reach users. The second was already
 * used and finished in selection. Carrying it would invite screen code that branches on it.
 */
export interface UpdateNote {
	/**
	 * Public identity, the same value as releasedAt. It is also the key that records which note was
	 * read.
	 */
	readonly id: string;
	readonly releasedAt: string;
	/** The dialog's accessible name, for example `2026.08.30 update notes`. */
	readonly title: string;
	readonly intro: string | null;
	readonly sections: readonly UpdateNoteSection[];
}

/**
 * A piece of in-app text. A label piece is a screen name the author wrapped in backticks.
 *
 * Authors already wrote screen names in backticks, for example a sentence telling users they can
 * pick a setting from `Conversation settings`. Both apps printed the string verbatim, so the backticks showed on
 * screen. The in-app body is not Markdown, so the repository's Markdown parser is not pulled in.
 * The only syntax accepted is that backtick pair. Asterisks and underscores stay literal, and text
 * inside a pair is taken literally as a screen name.
 *
 * The split rule lives here so both apps split a sentence into the same pieces. Weight and color
 * belong to each app.
 */
export interface UpdateNoteTextSpan {
	readonly text: string;
	readonly label: boolean;
}

const LABEL_FENCE = "`";

/**
 * Splits a sentence into pieces. An unmatched final backtick stays as a literal character: the
 * screen does not throw, and authoring mistakes are caught by updateNoteProblems before generation.
 * An empty pair (two adjacent backticks) draws nothing.
 */
export function updateNoteTextSpans(text: string): UpdateNoteTextSpan[] {
	const parts = text.split(LABEL_FENCE);
	/**
	 * An even number of parts means an odd number of backticks, so the last piece is an open span that
	 * never closed.
	 */
	const unmatched = parts.length % 2 === 0;
	const spans: UpdateNoteTextSpan[] = [];
	const push = (piece: string, label: boolean) => {
		if (piece === "") return;
		const last = spans.at(-1);
		if (last && last.label === label)
			spans[spans.length - 1] = { text: last.text + piece, label };
		else spans.push({ text: piece, label });
	};
	parts.forEach((piece, index) => {
		if (unmatched && index === parts.length - 1)
			push(`${LABEL_FENCE}${piece}`, false);
		else push(piece, index % 2 === 1);
	});
	return spans;
}

/**
 * Plain text for the accessible name. Backticks are removed because assistive technology reads them
 * aloud. It uses the same split as the visible text, so what is shown and what is read do not
 * diverge.
 */
export function updateNotePlainText(text: string): string {
	return updateNoteTextSpans(text)
		.map((span) => span.text)
		.join("");
}

/** Whether a sentence has an unmatched backtick. Used by authoring validation. */
const hasUnmatchedLabelFence = (text: string): boolean =>
	text.split(LABEL_FENCE).length % 2 === 0;

/**
 * Public title derived from one date: `2026-08-30` becomes `2026.08.30 update notes`. A locale formatter
 * is not used because the output must be deterministic. Intl reads the runtime locale and time
 * zone, so one release's title would differ between devices.
 *
 * The announcement prefix is not added here. The window title is plain text. The decorative prefix
 * belongs to the pasted Discord text, which renderDiscordUpdateNote adds.
 */
export function updateNoteTitle(releasedAt: string): string {
	return `${releasedAt.replaceAll("-", ".")} update notes`;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const isLeapYear = (year: number): boolean =>
	(year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Checks `YYYY-MM-DD` and that the date actually exists. Date is not used: `new Date('2026-02-30')`
 * rolls over to March 2 instead of throwing. The check would then pass an invalid date, and the
 * title would silently name another day.
 */
export function isReleaseDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) return false;
	const last = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
	return day >= 1 && day <= last;
}

/**
 * SemVer MAJOR.MINOR.PATCH. Pre-release versions are rejected, following the repository versioning
 * rule (`## Versioning`).
 */
const INTERNAL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const trimmed = (value: string): string => value.trim();

const sectionItems = (
	content: UpdateNoteContent,
	id: UpdateNoteSectionId,
): readonly string[] => content[id] ?? [];

/**
 * Shape problems in a record the app holds. This predicate cannot check authoring axes
 * (internalVersion, discord). Those values are not in the generated output, so the runtime type has
 * no place for them.
 *
 * This path runs while the screen draws notes, so authoring mistakes are caught earlier. A bad
 * internalVersion makes `pnpm updates:generate` fail before deployment, instead of quietly dropping
 * the note on screen.
 */
function runtimeProblems(record: UpdateNoteRuntimeRecord): string[] {
	const problems: string[] = [];

	if (!isReleaseDate(record.releasedAt))
		problems.push(`releasedAt is not a YYYY-MM-DD date: ${record.releasedAt}`);

	if (record.surfaces !== undefined) {
		if (record.surfaces.length === 0)
			problems.push("surfaces is empty; a note shown on no screen is no note");
		for (const surface of record.surfaces)
			if (!UPDATE_SURFACES.includes(surface))
				problems.push(`unknown surface: ${surface}`);
	}

	if (record.inApp.intro !== undefined && trimmed(record.inApp.intro) === "")
		problems.push("intro is empty; that is no different from absent");

	let items = 0;
	for (const id of UPDATE_NOTE_SECTION_ORDER) {
		const section = record.inApp[id];
		if (section === undefined) continue;
		if (section.length === 0)
			problems.push(`${id} is an empty array; an empty section has no key`);
		for (const item of section)
			if (trimmed(item) === "") problems.push(`${id} has an empty line`);
		items += section.length;
	}
	if (items === 0)
		problems.push("the in-app body has no items; there is nothing to draw");

	return problems;
}

/**
 * Returns a list of rule violations rather than throwing, because the consumers are the generator
 * and the tests. Stopping at the first problem would force a rerun after every fix.
 *
 * It checks shape only. Quality (too long, implementation-focused wording) is for a person to
 * review. As a predicate it would be strict in the wrong direction and block a release over one
 * sentence. Rules that need the source files (file names, duplicate dates) live in the loader
 * (scripts/lib/update-note-sources.ts).
 */
export function updateNoteProblems(record: UpdateNoteRecord): string[] {
	const problems = runtimeProblems(record);

	/**
	 * An unmatched backtick shows as a literal character on screen. That is tolerance so the screen
	 * does not throw, not permission. Generation fails so the problem is caught before deployment.
	 * Discord text is not checked here, since Discord's own Markdown renders it.
	 */
	const inAppLines = [
		...(record.inApp.intro === undefined ? [] : [record.inApp.intro]),
		...UPDATE_NOTE_SECTION_ORDER.flatMap((id) =>
			sectionItems(record.inApp, id),
		),
	];
	for (const line of inAppLines)
		if (hasUnmatchedLabelFence(line))
			problems.push(`an in-app line has unbalanced backticks: ${line}`);

	if (record.internalVersion !== undefined) {
		if (!INTERNAL_VERSION.test(record.internalVersion))
			problems.push(
				`internalVersion is not MAJOR.MINOR.PATCH: ${record.internalVersion}`,
			);
	}

	if (record.discord) {
		let discordItems = 0;
		for (const id of UPDATE_NOTE_SECTION_ORDER) {
			const section = record.discord[id];
			if (section === undefined) continue;
			if (section.length === 0)
				problems.push(`discord.${id} is an empty array`);
			for (const item of section) {
				if (trimmed(item.title) === "")
					problems.push(`discord.${id} has an item without a title`);
				if (item.detail !== undefined && trimmed(item.detail) === "")
					problems.push(`discord.${id} has an empty description`);
			}
			discordItems += section.length;
		}
		if (
			discordItems === 0 &&
			(record.discord.intro === undefined ||
				trimmed(record.discord.intro) === "")
		)
			problems.push(
				"the discord body is empty; that is no different from absent",
			);
	}

	return problems;
}

/**
 * Converts an authored record to the public projection. A malformed record returns null and does
 * not throw. This runs on the path where the app starts, and a throw would show the user an app
 * that does not start, rather than one missing note. Authoring mistakes are caught by
 * update-note.test.ts, not on screen.
 *
 * The record is not spread. `{ ...record, sections }` would be the shortest answer, but that one
 * line would turn internalVersion into a public value. The returned object sets each field
 * explicitly, and the test checks its key set.
 */
export function parseUpdateNoteRecord(
	record: UpdateNoteRuntimeRecord,
): UpdateNote | null {
	if (runtimeProblems(record).length > 0) return null;

	const sections: UpdateNoteSection[] = [];
	for (const id of UPDATE_NOTE_SECTION_ORDER) {
		const items = sectionItems(record.inApp, id);
		/**
		 * Empty sections are not drawn, including their titles. An empty title reads as a broken screen.
		 */
		if (items.length === 0) continue;
		sections.push({ id, label: UPDATE_NOTE_SECTION_LABEL[id], items });
	}

	return {
		id: record.releasedAt,
		releasedAt: record.releasedAt,
		title: updateNoteTitle(record.releasedAt),
		intro: record.inApp.intro ?? null,
		sections,
	};
}

const appliesTo = (
	record: UpdateNoteRuntimeRecord,
	surface: UpdateSurface,
): boolean =>
	record.surfaces === undefined || record.surfaces.includes(surface);

/**
 * All notes for this surface, newest first. The history screen draws this list and nothing else.
 *
 * It is a list, not only the latest. The module once answered with a single value, which was true
 * while the entry point was one line. The Updates tab now has its own column that draws history.
 * Returning only the newest would make the app collect the rest itself and duplicate surface
 * filtering and sorting.
 *
 * Order does not depend on the array. Dates are YYYY-MM-DD, so lexical comparison is chronological,
 * and generated output can come in any order. If two dates were equal, the stable sort would keep
 * their order, but generation rejects duplicate dates, so that state is never produced.
 *
 * Malformed records are dropped silently. This runs on the drawing path and must not throw, and one
 * mistake must not take the rest of the history with it.
 *
 * The function never reads the clock. A note in the generated output is published. releasedAt is
 * not compared with today: publication is a deployed fact, not a calendar event.
 */
export function updateNotesFor(
	surface: UpdateSurface,
	records: readonly UpdateNoteRuntimeRecord[] = UPDATE_NOTE_RUNTIME_RECORDS,
): readonly UpdateNote[] {
	const notes: UpdateNote[] = [];
	for (const record of records) {
		if (!appliesTo(record, surface)) continue;
		const note = parseUpdateNoteRecord(record);
		if (note === null) continue;
		notes.push(note);
	}
	/** Newest first. This is a history to skim, not an inbox that accumulates over time. */
	return notes.sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : -1));
}

/**
 * The most recent note for this surface, or null. It must equal the first row of the history, so it
 * takes the head of the list rather than searching separately. If two functions each chose the
 * newest, the marked row and the note the mark was based on could diverge, and that would appear
 * only after several releases had accumulated.
 */
export function latestUpdateNoteFor(
	surface: UpdateSurface,
	records: readonly UpdateNoteRuntimeRecord[] = UPDATE_NOTE_RUNTIME_RECORDS,
): UpdateNote | null {
	return updateNotesFor(surface, records)[0] ?? null;
}

/**
 * Identity of the newest note the user has not opened, or null. One value answers two questions:
 * whether the Updates tab shows a dot (`!== null`), and which history row carries the mark
 * (`note.id === this value`). Two separate predicates could produce a state where the tab shows a
 * dot but no row carries it.
 *
 * - No record of a seen note: the newest is unseen.
 * - Record >= the newest note's identity: already seen, so null.
 * - Record < the newest note's identity: the newest is unseen.
 *
 * `unseen` being true does not mean 'open it now'. This slice never opens a note on its own.
 * History stays after the mark is cleared, and the mark sits on one row. An earlier function
 * returned null for a seen note, and that shape encouraged callers to treat 'a value exists' as
 * 'open it'.
 *
 * No record counts as unseen. This decision was reversed several times. If the first run only
 * recorded a baseline, the release that introduces this feature would never be marked, though it is
 * the one meant to announce itself.
 *
 * `>=` is deliberate. After a rollback, or a reinstall with an older build, a device may already
 * have a newer note recorded. `>` would mark already-read notes again.
 */
export function unseenUpdateNoteId(
	surface: UpdateSurface,
	lastSeenId: string | null,
	records: readonly UpdateNoteRuntimeRecord[] = UPDATE_NOTE_RUNTIME_RECORDS,
): string | null {
	const latest = latestUpdateNoteFor(surface, records);
	if (latest === null) return null;
	return lastSeenId === null || lastSeenId < latest.id ? latest.id : null;
}

/**
 * Returns the text to paste into Discord, or null when no Discord body is authored. The text is not
 * derived from the in-app body. An automatic conversion was deliberately left out, and a missing
 * body is better reported as missing than filled with short lines. Internal versions are not
 * included either, because Discord is a public channel with the same rules as the app.
 *
 * The output is Markdown: `##` for the title, `###` for section headings, bold for items with a
 * detail, and `-` bullets for items without one. This reverses an earlier decision. The output was
 * plain text on the premise that Discord formatting is mostly emoji, which is wrong: the client
 * renders headings, bold, and lists. Plain text would draw titles, item titles, and body at the
 * same size.
 *
 * Formatting is limited to structure. Quotes, tables, code blocks, rules, and small-text lines are
 * not used. The authored sentences carry their own meaning, and decoration on top would change
 * every release.
 */
export function renderDiscordUpdateNote(
	record: UpdateNoteRecord,
): string | null {
	const content = record.discord;
	if (!content) return null;
	if (updateNoteProblems(record).length > 0) return null;

	const blocks: string[] = [`## 📢 ${updateNoteTitle(record.releasedAt)}`];
	if (content.intro) blocks.push(content.intro);

	for (const id of UPDATE_NOTE_SECTION_ORDER) {
		const items = content[id];
		if (items === undefined || items.length === 0) continue;
		/**
		 * The only place Discord's decoration (the emoji prefix) is attached to a section heading. See
		 * the table in the module header.
		 */
		const lines: string[] = [
			`### ${UPDATE_NOTE_SECTION_DISCORD_PREFIX[id]} ${UPDATE_NOTE_SECTION_LABEL[id]}`,
		];
		/**
		 * A title with a detail gets its own bold line. An item without a detail is a plain bullet. An
		 * empty line after a detail-less item would space out a list of fixes so that each reads as a
		 * separate paragraph.
		 *
		 * The bullet is `-`, not a dot glyph. A drawn dot would not indent wrapped lines, while `-` is
		 * read as a list by Discord.
		 */
		for (const item of items)
			lines.push(
				item.detail ? `\n**${item.title}**\n${item.detail}` : `- ${item.title}`,
			);
		blocks.push(lines.join("\n"));
	}

	/**
	 * Sections are separated by one blank line. There is no closing greeting; the output ends with the
	 * last section.
	 */
	return `${blocks.join("\n\n")}\n`;
}
