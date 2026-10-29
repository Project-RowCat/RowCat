import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	isReleaseDate,
	latestUpdateNoteFor,
	parseUpdateNoteRecord,
	renderDiscordUpdateNote,
	UPDATE_NOTE_SECTION_LABEL,
	UPDATE_NOTE_SECTION_ORDER,
	type UpdateNoteRecord,
	unseenUpdateNoteId,
	updateNotePlainText,
	updateNoteProblems,
	updateNotesFor,
	updateNoteTextSpans,
	updateNoteTitle,
} from "./update-note.ts";
import { UPDATE_NOTE_RUNTIME_RECORDS } from "./update-notes/generated/update-notes.ts";

/**
 * Rules for update notes, checked at their boundaries rather than their content. The internal
 * version must not leak into the public projection, empty sections must disappear, order must be
 * deterministic, and an already-seen note must not return.
 *
 * Writing quality is reviewed by a person. updateNoteProblems checks only shape, for the same
 * reason.
 */

const note = (over: Partial<UpdateNoteRecord> = {}): UpdateNoteRecord => ({
	releasedAt: "2026-08-30",
	internalVersion: "0.13.0",
	inApp: { additions: ["A new screen arrived."] },
	...over,
});

describe("the public identity is the date", () => {
	it("the title derives from one date", () => {
		expect(updateNoteTitle("2026-08-30")).toBe("2026.08.30 update notes");
	});

	it("the id is releasedAt, not derived from SemVer", () => {
		const parsed = parseUpdateNoteRecord(note());
		expect(parsed?.id).toBe("2026-08-30");
	});

	/**
	 * A nonexistent date is rejected. `new Date('2026-02-30')` does not throw; it rolls over into
	 * March. Accepting that would let a mistyped date pass, and only the title would then silently
	 * name a different day.
	 */
	it("refuses a nonexistent date", () => {
		expect(isReleaseDate("2026-08-30")).toBe(true);
		expect(isReleaseDate("2024-02-29")).toBe(true);
		expect(isReleaseDate("2026-02-29")).toBe(false);
		expect(isReleaseDate("2026-13-01")).toBe(false);
		expect(isReleaseDate("2026-08-32")).toBe(false);
		expect(isReleaseDate("2026-8-30")).toBe(false);
		expect(isReleaseDate("20260830")).toBe(false);
		expect(isReleaseDate("")).toBe(false);
	});

	it("a malformed record is not projected", () => {
		expect(
			parseUpdateNoteRecord(note({ releasedAt: "2026-02-30" })),
		).toBeNull();
		expect(parseUpdateNoteRecord(note({ inApp: {} }))).toBeNull();
		expect(
			parseUpdateNoteRecord(note({ inApp: { additions: [] } })),
		).toBeNull();
		expect(
			parseUpdateNoteRecord(note({ inApp: { additions: ["  "] } })),
		).toBeNull();
		expect(parseUpdateNoteRecord(note({ surfaces: [] }))).toBeNull();
	});
});

describe("the internal version is not in the public projection", () => {
	/**
	 * Checks the whole key set. Checking only that sensitive fields are absent would let a leak
	 * through once an axis is added later. The operator console's projection has the same check for
	 * the same reason.
	 */
	it("the projection has five keys and no internal axis", () => {
		const parsed = parseUpdateNoteRecord(note());
		expect(parsed).not.toBeNull();
		expect(Object.keys(parsed as object).sort()).toEqual([
			"id",
			"intro",
			"releasedAt",
			"sections",
			"title",
		]);
	});

	/** A spread of one line would leak the value, so the check also runs on the serialized output. */
	it("no SemVer string appears in the serialized projection", () => {
		const parsed = parseUpdateNoteRecord(note({ internalVersion: "9.9.9" }));
		expect(JSON.stringify(parsed)).not.toContain("9.9.9");
		expect(JSON.stringify(parsed)).not.toContain("internalVersion");
	});

	/**
	 * The generated registry has no internal version at all. An earlier version of this check scanned
	 * authored records for the version string in the projection. Now there is nothing to scan for: the
	 * renderer writes each key individually, so the app's data has no such axis.
	 *
	 * This test checks that by value. The rule for authored sources is in
	 * scripts/update-note-sources.test.ts.
	 */
	it("no internal version anywhere in the generated registry or its projection", () => {
		/**
		 * The registry can be empty (public builds carry no releases), in which case this loop does
		 * nothing. The same fact is covered by the test that scans the generated text
		 * (scripts/update-note-sources.test.ts, 'Discord body and internal version are not shipped').
		 */
		for (const record of UPDATE_NOTE_RUNTIME_RECORDS) {
			expect(Object.keys(record).sort(), record.releasedAt).not.toContain(
				"internalVersion",
			);
			expect(Object.keys(record).sort(), record.releasedAt).not.toContain(
				"discord",
			);
			expect(
				JSON.stringify(parseUpdateNoteRecord(record)),
				record.releasedAt,
			).not.toContain("internalVersion");
		}
	});

	/**
	 * The surfaces axis does not reach screens either. Selection has already made that decision, so
	 * the screen has no reason to read it again.
	 */
	it("surfaces are not in the projection", () => {
		const parsed = parseUpdateNoteRecord(note({ surfaces: ["mobile"] }));
		expect(JSON.stringify(parsed)).not.toContain("surfaces");
	});
});

describe("screen names in the body", () => {
	it("backticked words become pieces and the backticks are not drawn", () => {
		expect(updateNoteTextSpans("`Conversation settings` now has it.")).toEqual([
			{ text: "Conversation settings", label: true },
			{ text: " now has it.", label: false },
		]);
		expect(updateNotePlainText("`Today`·`Last 7 days` replaced them.")).toBe(
			"Today·Last 7 days replaced them.",
		);
	});

	it("the inside is literal text, not markdown", () => {
		expect(updateNoteTextSpans('`**"yes"**`, for example')).toEqual([
			{ text: '**"yes"**', label: true },
			{ text: ", for example", label: false },
		]);
	});

	it("an unpaired final backtick stays as text", () => {
		expect(updateNoteTextSpans("`A` and `B")).toEqual([
			{ text: "A", label: true },
			{ text: " and `B", label: false },
		]);
		expect(updateNoteTextSpans("No backticks")).toEqual([
			{ text: "No backticks", label: false },
		]);
	});

	it("authoring validation blocks in-app lines with broken pairs", () => {
		expect(
			updateNoteProblems(note({ inApp: { fixes: ["`Regenerate shows up."] } })),
		).toContainEqual(expect.stringContaining("unbalanced backticks"));
		expect(
			updateNoteProblems(
				note({ inApp: { intro: "`Create", fixes: ["Fixed."] } }),
			),
		).toContainEqual(expect.stringContaining("unbalanced backticks"));
	});
});

describe("sections", () => {
	it("the order is fixed and empty sections disappear", () => {
		const parsed = parseUpdateNoteRecord(
			note({
				inApp: {
					fixes: ["Fixed."],
					additions: ["Added."],
				},
			}),
		);
		expect(parsed?.sections.map((section) => section.id)).toEqual([
			"additions",
			"fixes",
		]);
	});

	it("labels come from the shared table", () => {
		const parsed = parseUpdateNoteRecord(note());
		expect(parsed?.sections[0]?.label).toBe(
			UPDATE_NOTE_SECTION_LABEL.additions,
		);
		expect(UPDATE_NOTE_SECTION_ORDER).toEqual([
			"additions",
			"improvements",
			"fixes",
			"notices",
		]);
	});

	/**
	 * Labels are plain words. Decoration belongs to each surface.
	 *
	 * Emoji were once part of this value, so the in-app section title was drawn in the device's emoji
	 * font. Now each app draws a Lucide icon there, and emoji survive only in the Discord output.
	 *
	 * The value is pinned because it is easy to revert. Putting one emoji back into a label is a
	 * single line, and its symptom is an icon and an emoji side by side in the app, which passes
	 * compile and type checks.
	 */
	it("labels carry no decoration", () => {
		expect(UPDATE_NOTE_SECTION_LABEL).toEqual({
			additions: "New features",
			improvements: "Improvements",
			fixes: "Fixes",
			notices: "Notes",
		});
		for (const label of Object.values(UPDATE_NOTE_SECTION_LABEL)) {
			expect(label, label).toBe(label.trim());
			/** Only Hangul and spaces are allowed. No emoji and no prefix symbols. */
			expect(label, label).toMatch(/^[A-Za-z ]+$/u);
		}
	});

	/**
	 * The projection carries exactly three things: id, label, and items. No icon name, no Lucide
	 * component, and no per-surface decoration. Those would give the domain a screen library's
	 * vocabulary, and each value would fit only one of the two apps. Web picks components directly,
	 * while mobile calls a semantic name from its own registry.
	 */
	it("the section projection has no screen decoration", () => {
		const parsed = parseUpdateNoteRecord(note());
		expect(Object.keys(parsed?.sections[0] ?? {}).sort()).toEqual([
			"id",
			"items",
			"label",
		]);
	});

	it("a missing intro is null, not an empty string", () => {
		expect(parseUpdateNoteRecord(note())?.intro).toBeNull();
		expect(
			parseUpdateNoteRecord(note({ inApp: { ...note().inApp, intro: "" } })),
		).toBeNull();
	});
});

describe("history and what is new", () => {
	const older = note({ releasedAt: "2026-08-01" });
	const middle = note({ releasedAt: "2026-08-20" });
	const newer = note({ releasedAt: "2026-09-15" });
	/**
	 * Records are registered out of order on purpose. Order comes from the date, not from array
	 * position.
	 */
	const records = [middle, newer, older];

	it("history is newest first", () => {
		expect(updateNotesFor("web", records).map((n) => n.id)).toEqual([
			"2026-09-15",
			"2026-08-20",
			"2026-08-01",
		]);
	});

	it("the newest equals the first history row", () => {
		expect(latestUpdateNoteFor("web", records)?.id).toBe(
			updateNotesFor("web", records)[0]?.id,
		);
		expect(latestUpdateNoteFor("web", records)?.id).toBe("2026-09-15");
	});

	/**
	 * The history is a public projection list. If raw authored records leaked through, internalVersion
	 * could reach the screen.
	 */
	it("history rows have no internal version either", () => {
		const serialized = JSON.stringify(updateNotesFor("web", records));
		expect(serialized).not.toContain("internalVersion");
		expect(serialized).not.toContain("0.13.0");
		expect(serialized).not.toContain("surfaces");
	});

	it("history rows have only the public projection's keys", () => {
		for (const item of updateNotesFor("web", records))
			expect(Object.keys(item).sort()).toEqual([
				"id",
				"intro",
				"releasedAt",
				"sections",
				"title",
			]);
	});

	/**
	 * One authoring mistake must not drop the rest of the history. The screen would otherwise go
	 * empty.
	 */
	it("only malformed records drop out", () => {
		const broken = note({ releasedAt: "2026-99-99" });
		expect(
			updateNotesFor("web", [broken, ...records]).map((n) => n.id),
		).toEqual(["2026-09-15", "2026-08-20", "2026-08-01"]);
	});

	/**
	 * Surface filtering is the quietest part of selection. If a mobile-only release appeared in the
	 * web history, the reader would be reading about a feature their screen does not have.
	 */
	it("only this surface's notes are included", () => {
		const mobileOnly = note({ releasedAt: "2026-10-01", surfaces: ["mobile"] });
		const scoped = [...records, mobileOnly];
		expect(updateNotesFor("web", scoped).map((n) => n.id)).not.toContain(
			"2026-10-01",
		);
		expect(updateNotesFor("mobile", scoped).map((n) => n.id)).toContain(
			"2026-10-01",
		);
	});

	it("without surfaces it is in both histories", () => {
		expect(updateNotesFor("web", [note()]).map((n) => n.id)).toEqual([
			"2026-08-30",
		]);
		expect(updateNotesFor("mobile", [note()]).map((n) => n.id)).toEqual([
			"2026-08-30",
		]);
	});

	it("no notes means an empty history", () => {
		expect(updateNotesFor("web", [])).toEqual([]);
		expect(latestUpdateNoteFor("web", [])).toBeNull();
	});
});

describe("which row is new", () => {
	const older = note({ releasedAt: "2026-08-01" });
	const middle = note({ releasedAt: "2026-08-20" });
	const newer = note({ releasedAt: "2026-09-15" });
	const records = [middle, newer, older];

	it("without a record the newest is new", () => {
		expect(unseenUpdateNoteId("web", null, records)).toBe("2026-09-15");
	});

	/**
	 * Even after the newest note is seen, the history stays. The earlier model returned null for seen
	 * notes as well, a shape that held only when the app opened a window automatically. Now only one
	 * dot turns off.
	 */
	it("after seeing the newest nothing is new and the history stays", () => {
		expect(unseenUpdateNoteId("web", "2026-09-15", records)).toBeNull();
		expect(updateNotesFor("web", records)).toHaveLength(3);
	});

	/**
	 * Opening an older note does not count as reading the newest one. The mark stays on the newest.
	 */
	it("seeing an old note keeps the newest new", () => {
		expect(unseenUpdateNoteId("web", "2026-08-01", records)).toBe("2026-09-15");
		expect(unseenUpdateNoteId("web", "2026-08-20", records)).toBe("2026-09-15");
	});

	/**
	 * A device may already have opened a note newer than the current latest, after a reinstall with an
	 * older build or a rollback. Using `>` would bring the mark back on notes already read.
	 */
	it("no marker when the record is ahead of the newest", () => {
		expect(unseenUpdateNoteId("web", "2026-12-01", records)).toBeNull();
	});

	/** The mark always sits on exactly one row. Backlogged notes are not counted. */
	it("three backlogged notes still make one new", () => {
		const unseen = unseenUpdateNoteId("web", null, records);
		const marked = updateNotesFor("web", records).filter(
			(item) => item.id === unseen,
		);
		expect(marked).toHaveLength(1);
		expect(marked[0]?.id).toBe("2026-09-15");
	});

	it("another surface's note does not light this surface's marker", () => {
		const mobileOnly = note({ releasedAt: "2026-10-01", surfaces: ["mobile"] });
		const scoped = [...records, mobileOnly];
		expect(unseenUpdateNoteId("mobile", "2026-09-15", scoped)).toBe(
			"2026-10-01",
		);
		expect(unseenUpdateNoteId("web", "2026-09-15", scoped)).toBeNull();
	});

	it("no notes means no marker", () => {
		expect(unseenUpdateNoteId("web", null, [])).toBeNull();
	});
});

describe("Discord is separately written text", () => {
	it("no authored Discord body means none is invented", () => {
		expect(renderDiscordUpdateNote(note())).toBeNull();
	});

	/**
	 * This is the only place an emoji remains: the Discord section heading. In-app, Lucide icons
	 * express the same meaning. The two surfaces share identity, order, and words. Decoration is not
	 * one of them.
	 *
	 * The four prefixes are written out literally because they are the contract for pasted text.
	 * Checking against the prefix table would also pass a change that deletes the table.
	 */
	it("section headings get emoji prefixes", () => {
		const rendered = renderDiscordUpdateNote(
			note({
				discord: {
					additions: [{ title: "New screen" }],
					improvements: [{ title: "It's faster." }],
					fixes: [{ title: "Fixed." }],
					notices: [{ title: "Good to know." }],
				},
			}),
		);
		expect(rendered).toContain("### ✨ New features");
		expect(rendered).toContain("### ✅ Improvements");
		expect(rendered).toContain("### 🛠️ Fixes");
		expect(rendered).toContain("### ❗ Notes");
	});

	/**
	 * The prefix exists only on the Discord side. Putting it back into the shared labels would make
	 * in-app screens draw an icon and an emoji side by side. That regression is observable only in
	 * that direction.
	 */
	it("emoji do not leak into the shared labels", () => {
		for (const label of Object.values(UPDATE_NOTE_SECTION_LABEL))
			expect("✨✅🛠️❗".includes(label[0] ?? ""), label).toBe(false);
	});

	/**
	 * Markdown is part of the pasted-text contract: `##` and `###` headings, a **bold title** for
	 * items with a detail, and `-` bullets for items without one. If any of the four fell back to
	 * plain text, nothing would error. The symptom would appear only in Discord, where every line
	 * renders at the same size.
	 *
	 * The title starts with a megaphone emoji, and the section order matches the app.
	 */
	it("the title gets 📢 and the section order matches in-app", () => {
		const rendered = renderDiscordUpdateNote(
			note({
				discord: {
					fixes: [{ title: "Fixed." }],
					additions: [{ title: "New screen", detail: "You can do this." }],
				},
			}),
		);
		expect(rendered).toContain("## 📢 2026.08.30 update notes");
		expect(rendered?.indexOf("✨")).toBeLessThan(rendered?.indexOf("🛠️") ?? -1);
		expect(rendered).toContain("**New screen**\nYou can do this.");
		expect(rendered).toContain("- Fixed.");
	});

	it("the internal version does not go into pasted text either", () => {
		const rendered = renderDiscordUpdateNote(
			note({
				internalVersion: "9.9.9",
				discord: { fixes: [{ title: "Fixed." }] },
			}),
		);
		expect(rendered).not.toContain("9.9.9");
	});

	it("an empty section gets no heading", () => {
		const rendered = renderDiscordUpdateNote(
			note({ discord: { fixes: [{ title: "Fixed." }] } }),
		);
		expect(rendered).not.toContain(UPDATE_NOTE_SECTION_LABEL.additions);
	});
});

/**
 * This checks the data the app actually draws. Authoring rules (file names, duplicate dates, SemVer
 * in the text, the Discord body) need the source files, and reading them requires Node. Those
 * checks live in scripts/update-note-sources.test.ts. The split keeps this browser-facing module's
 * test from scanning the filesystem.
 */
describe("the generated registry renders as is", () => {
	it("registered records have no problems", () => {
		for (const record of UPDATE_NOTE_RUNTIME_RECORDS)
			expect(
				updateNoteProblems(record),
				`${record.releasedAt}: ${updateNoteProblems(record).join(" / ")}`,
			).toEqual([]);
	});

	/**
	 * Two records sharing a date would make the winner depend on registration order. Generation
	 * rejects that.
	 */
	it("dates do not repeat", () => {
		const dates = UPDATE_NOTE_RUNTIME_RECORDS.map(
			(record) => record.releasedAt,
		);
		expect(new Set(dates).size).toBe(dates.length);
	});

	/**
	 * The version number never appears in the sentences. The public identity is the date. If `v0.13.0`
	 * appeared in one line, users would have two names for a release. The authoring source applies the
	 * same check.
	 */
	it("no SemVer appears in sentences", () => {
		for (const record of UPDATE_NOTE_RUNTIME_RECORDS) {
			const copy = JSON.stringify(record.inApp);
			expect(copy, record.releasedAt).not.toMatch(/\d+\.\d+\.\d+/);
			expect(copy, record.releasedAt).not.toMatch(/version\s*\d/i);
		}
	});
});

describe("does not mix with the notification plane", () => {
	/**
	 * NotificationKind gets no new value. If notes were recorded in the inbox, this notice would
	 * become a server-owned value. Publishing a release note would then need an operational change
	 * rather than a deploy, and the unread count would merge the two kinds, so opening a note could
	 * mark a deprecation notice as read.
	 *
	 * The check reads the source rather than importing the contract, because domain depends on
	 * nothing. It needs only the absence of a word, which the source read provides.
	 */
	it("no product update kind in the notification vocabulary", () => {
		const source = readFileSync(
			fileURLToPath(
				new URL("../../contracts/src/notifications.ts", import.meta.url),
			),
			"utf8",
		);
		const kinds = /NotificationKind = z\.enum\(\[([\s\S]*?)\]\)/.exec(
			source,
		)?.[1];
		expect(kinds, "NotificationKind not found").toBeDefined();
		for (const forbidden of [
			"product_update",
			"update_note",
			"release_note",
			"update_available",
		])
			expect(kinds, forbidden).not.toContain(forbidden);
		/** `app_update` remains as it is. This slice did not touch the deprecation notice. */
		expect(kinds).toContain('"app_update"');
	});
});

describe("no self-opening vocabulary", () => {
	it("no auto-display names remain in the model", () => {
		/**
		 * The comment names the removed auto-open identifiers on purpose, to explain why that wiring was
		 * removed. The scan reads this file, so a stricter scan would flag the explanation itself and
		 * push toward deleting it. The settings and updates static scans made the same call.
		 */
		const source = readFileSync(
			fileURLToPath(new URL("./update-note.ts", import.meta.url)),
			"utf8",
		)
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");
		for (const forbidden of [
			"pendingUpdateNoteFor",
			"autoOpen",
			"showOnLaunch",
			"showOnStartup",
		])
			expect(source, forbidden).not.toContain(forbidden);
	});
});
