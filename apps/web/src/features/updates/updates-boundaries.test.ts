import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static boundary test: updates must not appear on their own, and must not become notifications.
 *
 * Allowed: the notifications screen (presentation) hands one tab to `UpdateNotesList`. Forbidden:
 * the notifications domain absorbing `UpdateNote` (kind, DTO, unread count, queries). Forbidden:
 * the updates slice reading inbox state (`useNotifications`, read mutations).
 *
 * Three ways this slice breaks, all of which still compile:
 * - It reappears on its own: a shell mounts a dialog, or the list changes by itself when a new
 *   note exists. The release news becomes a gate again.
 * - It leaks into the notification plane: a `NotificationKind` value is added, or `app_update` is
 *   reused. Raising the minimum version would then become a release-note operation.
 * - An internal record reaches the screen: a record is read directly to display
 *   `internalVersion`. That gives the note two public identities, and users see different names.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const sources = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(path) ? [path] : [];
	});

/**
 * The comments name the forbidden words while explaining the boundary, so the check strips comments
 * first. Otherwise the explanation itself would count as a violation.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("updates-boundaries.test.ts"));

const product = all.filter((file) => !/\.test\.tsx?$/.test(file.path));

const feature = product.filter((file) =>
	file.path.startsWith("features/updates/"),
);

const inbox = product.filter((file) =>
	file.path.startsWith("features/notifications/"),
);

/**
 * The places where composition happens: exactly two, and the count does not grow. The screen builds
 * two tabs; the header bell builds a preview of the same two. Any other inbox file that starts
 * knowing this slice's vocabulary would be absorption, not composition. Queries, cache policy,
 * rows, and state logic must not know about update notes.
 */
const COMPOSERS = [
	"features/notifications/notification-bell.tsx",
	"features/notifications/notifications-page.tsx",
];

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const page = () => fileAt("features/notifications/notifications-page.tsx");
const bell = () => fileAt("features/notifications/notification-bell.tsx");

describe("the files to check exist", () => {
	/**
	 * The count was three and is now six. The three new ones split responsibility that appeared with
	 * history: the owner of the read state (`provider`), the list, and the row. The old
	 * `update-note-entry.tsx` is not kept. If it stayed, unused, a later reader would assume a
	 * latest-only entry point still exists somewhere.
	 */
	it("the update note slice has eight files", () => {
		expect(feature.map((file) => file.path).sort()).toEqual([
			"features/updates/seen-store.ts",
			"features/updates/update-note-copy.ts",
			"features/updates/update-note-dialog.tsx",
			"features/updates/update-note-row.tsx",
			"features/updates/update-note-text.tsx",
			"features/updates/update-notes-list.tsx",
			"features/updates/update-notes-provider.tsx",
			"features/updates/update-notes-unseen-dot.tsx",
		]);
	});

	it("the old latest-only entry point is gone", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toContain("update-note-entry");
			expect(file.text, file.path).not.toMatch(/\bUpdateNoteEntry\b/);
			expect(file.text, file.path).not.toMatch(/\bupdateNoteEntryFor\b/);
		}
	});

	it("the inbox has several files", () => {
		expect(inbox.length).toBeGreaterThan(3);
	});
});

describe("settings do not know this slice", () => {
	/**
	 * With two ways to open a note, the single owner of the read state is no longer visible on screen.
	 * Nothing errors, and the state still looks plausible.
	 */
	it("the general settings screen draws no notes", () => {
		const general = fileAt("features/settings/settings-general-page.tsx");
		expect(general).not.toContain("features/updates/");
		expect(general).not.toMatch(/UpdateNote/);
		expect(general).not.toContain("updates.");
	});

	/**
	 * Not anywhere in the settings folder. Moving a section to another category is also outside this
	 * slice.
	 */
	it("the whole settings folder does not know notes", () => {
		for (const file of product.filter((f) =>
			f.path.startsWith("features/settings/"),
		)) {
			expect(file.text, file.path).not.toContain("features/updates/");
			expect(file.text, file.path).not.toMatch(/UpdateNote/);
		}
	});
});

describe("one container with two tabs", () => {
	/** Notifications composing these components is the allowed direction. */
	it("the notifications screen composes the two tabs", () => {
		const text = page();
		expect(text).toContain("features/updates/update-notes-list.tsx");
		expect(text).toContain("<GeneralNotifications />");
		expect(text).toContain("<UpdateNotesList />");
	});

	/** Do not hand-roll the primitive. The active indicator comes from inside it. */
	it("uses the shared tabs primitive", () => {
		const text = page();
		expect(text).toContain("@rowcat/ui-web/components/tabs");
		for (const part of ["<Tabs", "<TabsList", "<TabsTrigger", "<TabsContent"])
			expect(text, part).toContain(part);
		expect(text).not.toMatch(/aria-selected=/);
		expect(text).not.toMatch(/role="tab"/);
	});

	/**
	 * The first tab is not named `Notifications`. The screen title is already `Notifications`; repeating the word on a tab
	 * puts the same letters in a vertical stack twice and blurs the relation between the two tabs.
	 */
	it("the tabs are named general and updates", () => {
		const text = page();
		const triggers = [...text.matchAll(/<TabsTrigger[\s\S]*?<\/TabsTrigger>/g)]
			.map((match) => match[0])
			.join("\n");
		expect(triggers).toContain('t("general")');
		expect(triggers).toContain('t("updates")');
		expect(triggers).not.toContain('t("title")');
	});

	/**
	 * The default is `General`, and the default lives in a pure module (`notifications-search.ts`). If a
	 * new note changed the default tab, the dot would become an interception rather than a marker.
	 * That is the reason the startup popup was removed earlier.
	 */
	it("the default tab is general and notes do not change it", () => {
		const search = fileAt("features/notifications/notifications-search.ts");
		expect(search).toContain(
			'DEFAULT_NOTIFICATIONS_TAB: NotificationsTab = "general"',
		);
		/** The tab is chosen by the URL alone. Neither read state nor history enters this decision. */
		const text = page();
		expect(text).toContain("notificationsTabFromSearch");
		expect(text).not.toMatch(/unseenId|unseenUpdateNoteId/);
		expect(text).not.toMatch(/useState/);
	});

	/**
	 * The tab lives in the URL, but there is one route. `?tab=updates` exists for one reason: links
	 * now arrive at this tab. Until that was needed, local screen state was enough. Still, no second
	 * route such as `/notifications/updates` is created, because the two tabs are not axes of the
	 * inbox; one screen composes two surfaces.
	 *
	 * Serialization lives in one pure module. If the screen re-implemented it, default values would
	 * leak into the address (`?tab=general`) and one screen would have two URLs.
	 */
	it("the tab is in the address without a second route", () => {
		const text = page();
		expect(text).toContain("notificationsSearchForTab");
		expect(text).not.toContain('"/notifications/updates"');
		const routes = product
			.filter((file) => file.path.startsWith("routes/"))
			.map((file) => file.path);
		for (const route of routes)
			expect(route, route).not.toMatch(/notifications\/updates/);
	});
});

describe("the server list state does not hide the notes tab", () => {
	/**
	 * Static release history must not vanish when the server query fails.
	 *
	 * The most natural mistake is wrapping the whole `Tabs` inside the query's branch. One extra
	 * condition looks plausible, but it hides the history when the inbox is empty, offline, or the
	 * query fails, and nothing justifies that. So this test checks a fact: the query vocabulary does
	 * not appear anywhere on this screen. The branch ends inside the `General` tab, and the screen does not
	 * know about it.
	 */
	it("the screen that builds the tabs does not know the query", () => {
		const text = page();
		expect(text).not.toMatch(/useNotifications|notificationPanelView/);
		expect(text).not.toMatch(/isPending|isError|isPaused|isFetching/);
		expect(text).not.toMatch(/\bitems\b|hasNextPage/);
	});

	/** The query branch lives entirely inside the `General` tab, which owns all five of its states. */
	it("the query branches live inside the general tab", () => {
		const general = fileAt("features/notifications/general-notifications.tsx");
		expect(general).toContain("useNotifications");
		expect(general).toContain("notificationPanelView");
		expect(general).not.toMatch(/UpdateNote/);
	});

	/**
	 * No query axis anywhere in the updates-tab files. Release notes are content the repo ships, not
	 * fetched data.
	 */
	it("the notes tab does not read the query axis", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/isPending|isError|isPaused/);
			expect(file.text, file.path).not.toMatch(/hasNextPage|fetchNextPage/);
		}
	});
});

describe("the notification domain does not absorb update notes", () => {
	/**
	 * The vocabulary has not grown. Each added value would turn release notes into server-owned
	 * notification rows. Taking a note down would then need an ops action rather than a deploy.
	 */
	it("NotificationKind has no update note", () => {
		const contracts = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../../packages/contracts/src/notifications.ts",
					import.meta.url,
				),
			),
			"utf8",
		);
		const enumBody = /NotificationKind = z\.enum\(\[([\s\S]*?)\]\)/.exec(
			contracts,
		)?.[1];
		expect(enumBody).toBeDefined();
		const kinds = [...(enumBody ?? "").matchAll(/"([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(kinds).toEqual([
			"follow",
			"story_comment",
			/**
			 * These two are not values added by update notes; they are social events (a reply, a newly
			 * published work). The assertion guards not the length of the list but that release notes never
			 * leak into the notification plane. The forbidden list below checks that.
			 */
			"comment_reply",
			"creator_story_published",
			"moderation_action",
			"moderation_reversed",
			"appeal_resolved",
			"report_reviewed",
			"app_update",
		]);
		/** The contracts also have no place for note content. */
		expect(contracts).not.toMatch(/UpdateNote|updateNote|update_note/);
		expect(contracts).not.toContain("rowcat.updates");
	});

	/**
	 * Neither the query, the read mutation, nor the unread count knows this value. If the two planes
	 * mixed, opening a note would mark a deprecation notice as read, and raising the floor would light
	 * up a note's dot.
	 */
	it("the inbox state code does not read update notes", () => {
		const stateOwners = inbox.filter((file) => !COMPOSERS.includes(file.path));
		for (const file of stateOwners) {
			expect(file.text, file.path).not.toMatch(/UpdateNote|updateNote/);
			expect(file.text, file.path).not.toContain("features/updates/");
			expect(file.text, file.path).not.toContain("rowcat.updates");
		}
	});

	/**
	 * Even the composing places do not mix state. Their contact with the slice is drawing and one
	 * boolean; read state, storage, and history selection do not pass through these files.
	 */
	it("the composing place does not touch the seen fact", () => {
		for (const path of COMPOSERS) {
			const text = fileAt(path);
			expect(text, path).not.toContain("rowcat.updates");
			expect(text, path).not.toMatch(/lastSeen|markSeen|SeenStore|SeenStorage/);
			expect(text, path).not.toMatch(/updateNotesFor|latestUpdateNoteFor/);
			expect(text, path).not.toMatch(/unseenUpdateNoteId/);
			expect(text, path).not.toContain("update-notes-provider");
		}
	});

	/**
	 * The unread count counts only server notifications.
	 *
	 * This is the most fragile spot now that the bell represents two domains. Folding the two axes
	 * into one number is the shortest answer, and that single line produces a `1` that `Mark all read` never
	 * clears, because the server never created that line. So three things are checked: the query still
	 * does not know about notes; the bell does not write the priority judgement itself (it goes
	 * through the shared pure function); and no arithmetic adds the two values in that file.
	 */
	it("the unread count does not count note markers", () => {
		const hook = fileAt("features/notifications/use-notifications.ts");
		expect(hook).not.toMatch(/UpdateNote|updateNote|unseen/);

		const text = bell();
		/**
		 * The owner of priority and name assembly is the shared pure function. Mobile calls the same one.
		 */
		expect(text).toContain("notificationAttention");
		/**
		 * Do not rebuild the bell's badge count here. The shared function also decides the cap display
		 * (the overflow label).
		 */
		expect(text).not.toContain("notificationBadgeLabel");
		expect(text).not.toMatch(/unread\s*\+|\+\s*unread/);
		expect(text).not.toMatch(/unseenUpdate\s*\?\s*1/);
		expect(text).not.toMatch(/unreadCount[^\n]*unseen/);
	});

	/**
	 * The bell knows only the drawing and one boolean. If the bell walked the history itself, sorting
	 * and surface filtering would exist twice, and the mismatch would show only when the popover and
	 * the full screen are compared side by side. The list owns the row count through its surface axis
	 * (`update-notes-list.tsx`).
	 */
	it("the bell does not select history itself", () => {
		const text = bell();
		expect(text).toContain('surface="popover"');
		/**
		 * History does not leave this file; only one boolean does (`useUpdateNotesUnseen`). Once an array
		 * is in hand, a `.slice` appears beside it, and then sorting follows.
		 */
		expect(text).not.toContain("useUpdateNotes(");
		expect(text).not.toMatch(/UPDATE_POPOVER_LIMIT/);
		expect(text).not.toMatch(/\.sort\(|\.filter\(/);
	});

	/**
	 * No fabricated notifications. The fields you would have to invent would give the value inbox
	 * vocabulary.
	 */
	it("does not fabricate a Notification from an UpdateNote", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\bNotification\b/);
			expect(file.text, file.path).not.toMatch(/readAt|createdAt|\bkind\b/);
		}
	});
});

describe("different from app_update", () => {
	it("no notification vocabulary in this folder", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\bapp_update\b/);
			expect(file.text, file.path).not.toMatch(/\bNotificationKind\b/);
			expect(file.text, file.path).not.toMatch(/notification/i);
		}
	});

	/**
	 * The minimum-version floor is owned by the server and compared against store builds. It is not a
	 * condition for showing this note.
	 */
	it("does not read the floor or runtime config", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/appVersionFloor|minVersion/i);
			expect(file.text, file.path).not.toMatch(/runtime-config|runtimeConfig/);
			expect(file.text, file.path).not.toMatch(/\bAppPlatform\b/);
		}
	});

	/** No outbound request at all. The note is a shipped fact, not a resource to fetch. */
	it("does not call the server", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/getRowCatClient|@rowcat\/sdk/);
			expect(file.text, file.path).not.toMatch(/@rowcat\/query|useQuery/);
			expect(file.text, file.path).not.toMatch(/\bfetch\(/);
		}
	});
});

describe("the internal version does not reach the screen", () => {
	/**
	 * Authoring records live in a subpath of `@rowcat/domain`, which the package root does not export.
	 * Importing that subpath directly is the bypass that lets `internalVersion` reach the screen. The
	 * type system cannot block that path, so this test does.
	 *
	 * Adding history does not loosen the boundary. Building a list seems to need a scan of the
	 * records, and that scan brings the internal version to the screen. The generated runtime registry
	 * is blocked here too. Its values carry no `internalVersion`, but if the screen started scanning
	 * the registry, surface filtering and sorting would exist twice. The app calls only the shared
	 * functions `updateNotesFor`, `latestUpdateNoteFor`, and `unseenUpdateNoteId`.
	 */
	it("imports neither authoring records nor the generated registry directly", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/domain\/update-notes/);
			expect(file.text, file.path).not.toMatch(/\bUPDATE_NOTE_RECORDS\b/);
			expect(file.text, file.path).not.toMatch(
				/\bUPDATE_NOTE_RUNTIME_RECORDS\b/,
			);
			expect(file.text, file.path).not.toMatch(/\bUpdateNoteRecord\b/);
			expect(file.text, file.path).not.toMatch(/\bUpdateNoteRuntimeRecord\b/);
		}
	});

	/**
	 * Discovery is the tooling's job, not the runtime's. `pnpm updates:generate` finds the authored
	 * files before the build; the app ships only the committed generated file. If this folder used
	 * filesystem or bundler bulk imports, the note list would differ by runtime (browsers and Hermes
	 * lack that capability), and the failure would appear only after deployment.
	 */
	it("does not scan the file system", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/node:fs|readdirSync/);
			expect(file.text, file.path).not.toMatch(
				/import\.meta\.glob|require\.context/,
			);
		}
	});

	it("the screen does not handle version strings", () => {
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/internalVersion|semver/i);
	});
});

describe("the shared package owns the rules", () => {
	it("the app does not restate section vocabulary", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toContain("note.sections.map");
		expect(dialog).not.toContain("UPDATE_NOTE_SECTION_ORDER");
		expect(dialog).not.toMatch(/New features|Improvements|Fixes"|Notes"/);
		expect(dialog).not.toMatch(/\.filter\(/);
	});

	/**
	 * Labels are shared; decoration is per surface.
	 * - Web: Lucide icons (`SECTION_ICON` in this file)
	 * - Mobile: icon-registry meaning names (the same table in `apps/mobile`)
	 * - Discord: emoji prefixes (a private table inside `renderDiscordUpdateNote`)
	 *
	 * Section identity, order, and labels are shared through `@rowcat/domain`. The icon map stays out
	 * of it: putting icons in the projection would give the domain one screen's vocabulary, and a
	 * value of that shape fits only one of the two apps. The dialog must not restate the four labels.
	 */
	it("the icon table is the screen's and does not come from the domain", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toContain('from "lucide-react"');
		expect(dialog).toContain(
			"satisfies Record<UpdateNoteSectionId, LucideIcon>",
		);
		expect(dialog).toContain("SECTION_ICON[section.id]");
		/** The domain carries no icon. The only basis for choosing one is the section id. */
		expect(dialog).not.toMatch(/section\.icon|note\.sections\[\d+\]\.icon/);
		const domain = stripComments(
			readFileSync(
				fileURLToPath(
					new URL(
						"../../../../../packages/domain/src/update-note.ts",
						import.meta.url,
					),
				),
				"utf8",
			),
		);
		expect(domain).not.toMatch(/lucide/i);
		expect(domain).not.toMatch(/\bicon\b/i);
	});

	/**
	 * All four sections must have a Lucide icon. A missing one would leave only that section without
	 * an icon before its title, and the mismatch would show only in releases that carry that section.
	 * `satisfies` catches this at compile time, but it cannot block a change that removes a name from
	 * the table and papers over the gap with `?.`.
	 */
	it("the four sections each have a Lucide glyph", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		for (const [id, glyph] of [
			["additions", "Sparkles"],
			["improvements", "CircleCheck"],
			["fixes", "Wrench"],
			["notices", "TriangleAlert"],
		] as const) {
			expect(dialog, id).toMatch(new RegExp(`${id}: ${glyph},`));
			expect(dialog, glyph).toMatch(new RegExp(`\\b${glyph}\\b`));
		}
	});

	/**
	 * The in-app section titles must not depend on the system emoji font. The four icons were once
	 * part of the label string, so the same release looked different on each platform. Reverting is a
	 * one-character change in front of a string, so the test guards the value. Discord output adds its
	 * prefixes inside `@rowcat/domain`, and that table is not exported.
	 */
	it("no section emoji in this folder", () => {
		for (const file of feature)
			for (const emoji of ["✨", "✅", "🛠", "❗"])
				expect(file.text, `${file.path} — ${emoji}`).not.toContain(emoji);
	});

	/**
	 * Icons are decorative. With a name, screen readers would read the section twice (e.g. `Sparkles,
	 * New features`). Making one focusable would add a control that goes nowhere, the same judgment that
	 * keeps the tab dot unclickable.
	 *
	 * The `\s+` between attributes is deliberate: the formatter decides where attributes wrap. An
	 * earlier version required a single space, and when Biome split attributes onto separate lines the
	 * check broke. What broke was the accident that the fact sat on one line, not the fact the check
	 * guards.
	 */
	it("the glyph has no name", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toMatch(/<SectionIcon\s+aria-hidden="true"/);
		expect(dialog).not.toMatch(/aria-label=|role="img"|tabIndex=/);
	});

	it("items are still a semantic list", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toContain("<ul");
		expect(dialog).toMatch(
			/<li key=\{item\}>\s*<UpdateNoteText text=\{item\} \/>\s*<\/li>/,
		);
		expect(dialog).toContain("list-disc");
		expect(dialog).not.toMatch(/section\.items\.map[\s\S]{0,200}<SectionIcon/);
	});

	it("the app does not reselect history", () => {
		const provider = fileAt("features/updates/update-notes-provider.tsx");
		expect(provider).toContain("updateNotesFor");
		expect(provider).toContain("unseenUpdateNoteId");
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/localeCompare|\.sort\(/);
			expect(file.text, file.path).not.toMatch(/\.filter\(/);
			expect(file.text, file.path).not.toMatch(/releasedAt\s*[<>]/);
		}
	});

	/**
	 * The row marker and the tab dot read the same value. If each predicate were written separately, a
	 * state could arise where the tab has a dot but no row carries one.
	 */
	it("the dot rests on one identity", () => {
		expect(fileAt("features/updates/update-notes-list.tsx")).toContain(
			"note.id === unseenId",
		);
		expect(fileAt("features/updates/update-notes-unseen-dot.tsx")).toContain(
			"unseenId === null",
		);
	});

	/**
	 * Both apps call the same function. The same release must not be judged differently on two
	 * screens.
	 */
	it("uses the same selection function as mobile", () => {
		const mobile = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../mobile/src/features/updates/update-notes-provider.tsx",
					import.meta.url,
				),
			),
			"utf8",
		);
		for (const name of ["updateNotesFor", "unseenUpdateNoteId"]) {
			expect(mobile, name).toContain(name);
			expect(
				fileAt("features/updates/update-notes-provider.tsx"),
				name,
			).toContain(name);
		}
	});

	/** Both apps use the same storage key. One value needs one name. */
	it("uses the same storage key as mobile", () => {
		const mobile = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../mobile/src/features/updates/seen-store.ts",
					import.meta.url,
				),
			),
			"utf8",
		);
		const key = /UPDATE_NOTE_SEEN_KEY = "([^"]+)"/;
		expect(key.exec(fileAt("features/updates/seen-store.ts"))?.[1]).toBe(
			key.exec(mobile)?.[1],
		);
	});
});

describe("not an account value", () => {
	/**
	 * Moving this to member scope would leave nowhere to keep a guest's dismissal, and the note would
	 * reappear after login.
	 */
	it("uses no member-scoped store or identity", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/local-data|LocalDb|Dexie/);
			expect(file.text, file.path).not.toMatch(/useViewer|viewerId/);
		}
	});

	/** The medium is passed as an argument, so this rule can be checked without a browser. */
	it("one place knows localStorage", () => {
		const knowers = feature
			.filter((file) => /\blocalStorage\b/.test(file.text))
			.map((file) => file.path);
		expect(knowers).toEqual(["features/updates/seen-store.ts"]);
	});

	/** The read-state owner must be one. With two, the tab's dot and the row's dot could diverge. */
	it("one place opens the store", () => {
		const openers = feature
			.filter((file) => file.path !== "features/updates/seen-store.ts")
			.filter((file) => /createUpdateNoteSeenStore\(/.test(file.text))
			.map((file) => file.path);
		expect(openers).toEqual(["features/updates/update-notes-provider.tsx"]);
	});
});

describe("does not open by itself", () => {
	/**
	 * The shell route sets up the container, not the dialog.
	 *
	 * This route once showed a note behind a gate. Removing that wiring was the whole change to this
	 * slice; restoring it would turn release news into a gate again.
	 *
	 * What lives here is the single owner of the read state (`UpdateNotesProvider`). It sits in the
	 * shell because the header and the page both depend on it; each reading its own storage would
	 * leave one side stale. The container draws nothing unless a note is selected, so this test checks
	 * for the absence of the open wiring, not of `features/updates/`.
	 */
	it("the shell route does not raise the window itself", () => {
		const layout = fileAt("routes/(app)/route.tsx");
		expect(layout).not.toContain("UpdateNoteAnnouncement");
		expect(layout).not.toContain("UpdateNoteDialog");
		expect(layout).not.toMatch(/autoOpen|showOnLaunch|showOnStartup/i);
		/** Only the container mounts here. The shell draws neither the list nor the row. */
		expect(layout).toContain("<UpdateNotesProvider>");
		expect(layout).not.toContain("<UpdateNotesList");
		expect(layout).not.toContain("<UpdateNoteRow");
	});

	/**
	 * No auto-display vocabulary remains. A surviving name would bring the wiring back; what was
	 * removed is not one file but the concept 'shows itself when the app opens'.
	 */
	it("no auto-show names in this folder", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/announcement/i);
			expect(file.text, file.path).not.toMatch(
				/autoOpen|showOnLaunch|showOnStartup/i,
			);
			expect(file.text, file.path).not.toMatch(/pendingUpdateNote/);
		}
	});

	/** The composing screen does not open the dialog itself either. The only opener is a row press. */
	it("the notifications screen does not open the window itself", () => {
		const text = page();
		expect(text).not.toContain("UpdateNoteDialog");
		expect(text).not.toMatch(/autoOpen|showOnLaunch|showOnStartup/i);
	});

	/**
	 * Opening is a person's action. The list has no effect that turns opening on by itself; one such
	 * line would just move the automatic display somewhere else.
	 */
	it("the list does not open itself", () => {
		const list = fileAt("features/updates/update-notes-list.tsx");
		expect(list).toContain("onOpen=");
		expect(list).not.toMatch(/useState\(true\)/);
		expect(list).not.toContain("useEffect");
	});

	/**
	 * Selecting a tab alone marks nothing as read. The write of the read fact must be the row press
	 * alone, so someone who only skims the history leaves its notes unread.
	 */
	it("one place writes the seen fact", () => {
		const writers = feature
			.filter((file) => file.path !== "features/updates/seen-store.ts")
			.filter((file) => /markSeen\(/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(writers).toEqual([
			/** The open action and the read fact live on the same layer; the list only calls that layer. */
			"features/updates/update-notes-provider.tsx",
		]);
		expect(fileAt("features/updates/update-note-dialog.tsx")).not.toMatch(
			/markSeen/,
		);
	});
});

describe("builds no route", () => {
	/**
	 * Release history is not a resource to address by URL. It is a section of the notifications
	 * screen; a route would require search, filters, and an archive for it.
	 */
	it("there is no update note route", () => {
		const routes = product
			.filter((file) => file.path.startsWith("routes/"))
			.map((file) => file.path);
		for (const route of routes)
			expect(route, route).not.toMatch(/update|whats-new|release/i);
	});
});

describe("update notes do not know the inbox", () => {
	/** The reverse direction: this slice knows no inbox query, mutation, or key. */
	it("does not import inbox queries or mutations", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/useNotifications/);
			expect(file.text, file.path).not.toMatch(/markNotificationRead|markRead/);
			expect(file.text, file.path).not.toMatch(/unread|markAllRead/i);
		}
	});
});

describe("screen names in the body are not drawn with their backticks", () => {
	/**
	 * The authoring convention (`` `Conversation settings` ``) was once printed as-is, and users saw the backticks as
	 * literal characters. Every place that draws a sentence goes through `UpdateNoteText`, and the
	 * split rule is one shared function. If the app began cutting backticks itself, the two apps would
	 * split the same sentence into different pieces.
	 */
	it("the intro and items render through the fragments", () => {
		for (const path of [
			"features/updates/update-note-dialog.tsx",
			"features/updates/update-note-row.tsx",
		]) {
			const text = fileAt(path);
			expect(text, path).toContain("<UpdateNoteText text={note.intro}");
			expect(text, path).not.toMatch(/>\s*\{note\.intro\}\s*</);
			expect(text, path).not.toMatch(/>\s*\{item\}\s*</);
		}
		expect(fileAt("features/updates/update-note-row.tsx")).toContain(
			"updateNotePlainText(note.intro)",
		);
	});

	it("the splitting rule belongs to the shared package", () => {
		const text = fileAt("features/updates/update-note-text.tsx");
		expect(text).toContain("updateNoteTextSpans(");
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/split\(\s*["'`]\\?`/);
	});
});
