import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static boundaries of the update notes: they must not surface on their own and must not become
 * notifications.
 *
 * The notification screen may compose one slot for the notes (UpdateNotesList) and draw a dot, but
 * the notification domain and the update slice must not absorb each other:
 *
 * ```text
 * allowed    notification screen / tab row  -> gives one slot to UpdateNotesList, draws a dot
 * forbidden  notification domain             -> absorbs UpdateNote (Kind, DTO, unread count, query)
 * forbidden  update slice                    -> reads inbox state (useNotifications, read mutations)
 * ```
 *
 * Three failures compile cleanly and look plausible on screen, so they are pinned by value:
 *
 * ```text
 * re-appears on its own   the root opens a window, or a new note switches the slot
 * leaks into alerts       NotificationKind gains a value, or app_update is reused
 * internal version shows  a record is read directly and internalVersion is drawn
 * ```
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/** Comments may name the forbidden words while explaining the boundary; the scan strips them before matching. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("updates-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const feature = product.filter((file) =>
	file.path.startsWith("features/updates/"),
);

const inbox = product.filter((file) =>
	file.path.startsWith("features/notifications/"),
);

/**
 * The only places that compose the two surfaces: three, and no more. The screen mounts both slots,
 * the tab row draws one dot, and the header shortcut reads one boolean. The shortcut is the third
 * because it stands for two facts (unread notifications and unopened notes). Any other inbox file
 * that starts knowing this slice is absorption, not composition.
 */
const COMPOSERS = [
	"features/notifications/notification-shortcut.tsx",
	"features/notifications/notifications-screen.tsx",
	"features/notifications/notifications-tabs.tsx",
];

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const screen = () => fileAt("features/notifications/notifications-screen.tsx");

describe("the files to check actually exist", () => {
	/**
	 * It grew from four files: history split out the seen-fact owner (provider), the list, and the
	 * row. The old update-note-entry.tsx is gone; left unused, a reader would assume a latest-only
	 * entry point still exists somewhere.
	 */
	it("update notes have eight files", () => {
		expect(feature.map((file) => file.path).sort()).toEqual([
			"features/updates/device-seen-storage.ts",
			"features/updates/seen-store.ts",
			"features/updates/update-note-dialog.tsx",
			"features/updates/update-note-row.tsx",
			"features/updates/update-note-text.tsx",
			"features/updates/update-notes-list.tsx",
			"features/updates/update-notes-provider.tsx",
			"features/updates/update-notes-unseen-dot.tsx",
		]);
	});

	it("no entry point drawing only the latest remains", () => {
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

describe("settings doesn't know this slice", () => {
	/**
	 * With two ways to open notes, the single owner of the seen fact would no longer be visible on
	 * screen, and that state runs without errors while looking plausible.
	 */
	it("the general settings screen doesn't draw notes", () => {
		const general = fileAt("features/settings/settings-general-screen.tsx");
		expect(general).not.toContain("updates/");
		expect(general).not.toMatch(/UpdateNote/);
	});

	/** Nothing in the settings folder. Moving the note into another settings category is not this slice either. */
	it("the whole settings folder doesn't know notes", () => {
		for (const file of product.filter((f) =>
			f.path.startsWith("features/settings/"),
		)) {
			expect(file.text, file.path).not.toContain("updates/update-note");
			expect(file.text, file.path).not.toMatch(/UpdateNote/);
		}
	});
});

describe("one container with two cells", () => {
	/** The notification screen composing two slots is the allowed direction. */
	it("the notifications screen composes the two cells", () => {
		const text = screen();
		expect(text).toContain("../updates/update-notes-list.tsx");
		expect(text).toContain("<GeneralNotifications />");
		expect(text).toContain("<UpdateNotesList />");
	});

	/**
	 * No third tab library. The app already has an active indicator that moves between siblings (the
	 * drawer and settings navigation use it); a second one with the same meaning would move to a
	 * different rhythm.
	 */
	it("the tab row uses the existing active-indicator vocabulary", () => {
		const tabs = fileAt("features/notifications/notifications-tabs.tsx");
		expect(tabs).toContain("MotionIndicatorGroup");
		expect(tabs).toContain("MotionIndicatorItem");
		expect(tabs).toContain('accessibilityRole="tablist"');
		expect(tabs).toContain('accessibilityRole="tab"');
		expect(tabs).toContain("accessibilityState={{ selected: active }}");
		expect(tabs).not.toMatch(/react-native-tab|createMaterialTopTab/);
		/** Does not import the runtime directly; the rhythm belongs to the shared vocabulary. */
		expect(tabs).not.toContain("react-native-reanimated");
	});

	/**
	 * The first tab is not named `Notifications`. The bar already says `Notifications`, and repeating the word in the tab
	 * would stack the same text twice and blur the relation between the two tabs.
	 */
	it("the cells are named General and Updates", () => {
		const copy = fileAt("features/notifications/notification-copy.ts");
		const table = /NOTIFICATION_TABS?[\s\S]*?\}/.exec(copy);
		expect(copy).toContain('general: "General"');
		expect(copy).toContain('updates: "Updates"');
		expect(table?.[0] ?? "").not.toMatch(/general: "Notifications"/);
	});

	/**
	 * The default tab is `General`. If a new note switched the tab, the dot would become an interception
	 * rather than an indicator, and the reason this slice removed the startup window would come back.
	 */
	it("the default cell is general and notes don't change it", () => {
		const text = screen();
		expect(text).toContain('useState<NotificationsTab>("general")');
		expect(text).not.toMatch(
			/unseenId|unseenUpdateNoteId|useUpdateNotesUnseen/,
		);
		expect(text).not.toMatch(/setTab\([\s\S]{0,80}unseen/);
	});

	/** A tab is not an address: once it has one, it starts requiring its own route, cache and empty state. */
	it("doesn't make the cell an address", () => {
		const text = screen();
		expect(text).not.toMatch(/useLocalSearchParams|setParams/);
		expect(text).not.toMatch(/notifications\/updates/);
	});
});

describe("the server list's state doesn't hide the notes cell", () => {
	/**
	 * Static release history must not disappear together with the identity and query branches. Putting
	 * both tabs inside `state.kind === "panel"` is the most natural mistake: the header beside them
	 * already sits under that condition, and the screen still looks plausible. But that condition
	 * hides the history for guests, booting and unverified identity, with no justification.
	 *
	 * So this is checked by vocabulary absence: the branches end inside the `General` tab, and the
	 * container does not know about them.
	 */
	it("the screen standing the cells doesn't know the lookup's branches", () => {
		const text = screen();
		expect(text).not.toMatch(
			/useNotifications|resolveNotificationsScreenState/,
		);
		expect(text).not.toMatch(/isPending|isError|isPaused|isFetching/);
		expect(text).not.toMatch(/\bitems\b|hasNextPage|state\.kind/);
	});

	/** The `General` tab owns the branches as a whole; its six states end there. */
	it("the branches are inside the general cell", () => {
		const general = fileAt("features/notifications/general-notifications.tsx");
		expect(general).toContain("useNotifications");
		expect(general).toContain("resolveNotificationsScreenState");
		expect(general).not.toMatch(/UpdateNote/);
	});

	/** No query axis anywhere in the note tab, because the repository ships this content. */
	it("the notes cell doesn't read the lookup's axes", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/isPending|isError|isPaused/);
			expect(file.text, file.path).not.toMatch(/hasNextPage|fetchNextPage/);
			expect(file.text, file.path).not.toMatch(/session|useMobileIdentity/);
		}
	});
});

describe("the notification domain doesn't absorb update notes", () => {
	/**
	 * The vocabulary did not grow. One added value would turn a release note into a server-owned
	 * notification row, and taking a note down would then need an ops action instead of a deploy.
	 */
	it("NotificationKind has no update notes", () => {
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
			 * These two are not values the update note added: they are social events (a reply, a newly
			 * published work). This assertion locks not the length of the vocabulary but the fact that
			 * release notes do not leak into the notification plane; the forbidden-list tests below do that.
			 */
			"comment_reply",
			"creator_story_published",
			"moderation_action",
			"moderation_reversed",
			"appeal_resolved",
			"report_reviewed",
			"app_update",
		]);
		expect(contracts).not.toMatch(/UpdateNote|updateNote|update_note/);
		expect(contracts).not.toContain("rowcat.updates");
	});

	/**
	 * No query, read state or unread count knows this value. If the two planes mixed, opening a note
	 * would mark a deprecation notice as read, and raising the floor would light the note's dot.
	 */
	it("the inbox's status code doesn't read update notes", () => {
		const stateOwners = inbox.filter((file) => !COMPOSERS.includes(file.path));
		for (const file of stateOwners) {
			expect(file.text, file.path).not.toMatch(/UpdateNote|updateNote/);
			expect(file.text, file.path).not.toContain("updates/update-note");
			expect(file.text, file.path).not.toContain("rowcat.updates");
		}
	});

	/**
	 * Even the composing places do not mix state: drawing and one boolean are the whole contact
	 * surface, and neither the seen fact nor its selection passes through these files.
	 */
	it("the composing place doesn't touch the seen fact", () => {
		for (const path of COMPOSERS) {
			const text = fileAt(path);
			expect(text, path).not.toContain("rowcat.updates");
			expect(text, path).not.toMatch(/lastSeen|markSeen|SeenStore|SeenStorage/);
			expect(text, path).not.toMatch(/updateNotesFor|latestUpdateNoteFor/);
			expect(text, path).not.toMatch(/unseenUpdateNoteId/);
			/**
			 * The note's projection does not come in either; only drawing and one boolean do.
			 * `@rowcat/domain` is not blocked wholesale because of the shortcut: the bell takes its priority
			 * between the two markers from a shared pure function (`notificationAttention`), which takes one
			 * boolean and does not know the note vocabulary. Blocking by package name would block that
			 * sharing, and the app would then rewrite the rule in its own file.
			 */
			expect(text, path).not.toMatch(/\bUpdateNote\b/);
			expect(text, path).not.toContain("update-notes-provider");
		}
	});

	/**
	 * Unread counts only server notifications. Now that the shortcut stands for two domains, this is
	 * the easiest rule to break: folding both axes into one number is the shortest answer, and that
	 * line creates a `1` that `Mark all read` cannot clear, because the server never created that row.
	 */
	it("the unread count doesn't count the notes' marker", () => {
		const hook = fileAt("features/notifications/use-notifications.ts");
		expect(hook).not.toMatch(/UpdateNote|updateNote|unseen/);

		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		/** The shared pure function owns priority and label assembly; the web bell calls the same one. */
		expect(shortcut).toContain("notificationAttention");
		/** No arithmetic adding the two axes. */
		expect(shortcut).not.toMatch(/unread\s*\+|\+\s*unread/);
		expect(shortcut).not.toMatch(/unseenUpdate\s*\?\s*1/);
		/** No history comes out of this file; only one boolean does. */
		expect(shortcut).not.toContain("useUpdateNotes(");
		expect(shortcut).not.toMatch(/UpdateNote\b/);

		/**
		 * The tab dot is not a count, so badge vocabulary does not appear on that line. `NEW` has word
		 * boundaries because of one false positive: `hairlineWidth` contains it as a substring
		 * (`li-neW-idth`). Without the boundary this check would block writing a border width, and the
		 * quickest fix would be deleting the check. Narrowing is right, since the target is the `NEW`
		 * badge word.
		 */
		const tabs = fileAt("features/notifications/notifications-tabs.tsx");
		expect(tabs).not.toMatch(/unreadCount|badge|\bNEW\b/i);
	});

	/**
	 * The dot and the count are never drawn together; the pure function guarantees that exclusion.
	 * Re-stating the condition on screen would eventually diverge, leaving two markers beside the bell
	 * that nobody can explain.
	 */
	it("the shortcut doesn't rewrite the markers' exclusivity", () => {
		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		expect(shortcut).toContain("attention.badge");
		expect(shortcut).toContain("attention.dot");
		expect(shortcut).toContain("accessibilityLabel={attention.label}");
		/** The condition "draw the dot only when there is no badge" is not written by hand. */
		expect(shortcut).not.toMatch(/!attention\.badge|badge === null/);
		/** The dot has no number; a `1` would be a lie. */
		const dot = shortcut.slice(shortcut.indexOf("attention.dot"));
		expect(dot).not.toContain("AnimatedCount");
	});

	/**
	 * Does not fabricate notifications. Putting values into a `FlatList` `data` would require
	 * inventing a `Notification`, and then `id`, `createdAt`, `readAt` and `kind` would all be false;
	 * at that point the value would take on the inbox vocabulary.
	 */
	it("doesn't invent a Notification from an UpdateNote", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\bNotification\b/);
			expect(file.text, file.path).not.toMatch(/readAt|createdAt|\bkind\b/);
		}
	});
});

describe("different from app_update", () => {
	/**
	 * Does not pass through the notification plane. Once it does, the note becomes a server-owned
	 * value, and taking a release note down would need an ops action instead of a deploy.
	 */
	it("no notification vocabulary in this folder", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\bapp_update\b/);
			expect(file.text, file.path).not.toMatch(/\bNotificationKind\b/);
			expect(file.text, file.path).not.toMatch(/notification/i);
		}
	});

	/**
	 * Not mixed with the minimum supported version. The floor is server-owned and compared against
	 * store builds; this note is repository-owned and uses its date as identity. Using one as the
	 * other's condition would make raising the floor light the note's dot.
	 */
	it("doesn't read floors or runtime config", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/appVersionFloor|minVersion/i);
			expect(file.text, file.path).not.toMatch(/runtime-config|runtimeConfig/);
			expect(file.text, file.path).not.toMatch(/\bAppPlatform\b/);
		}
	});

	/** No outgoing server request. A note is a shipped fact, not a resource to fetch. */
	it("doesn't call the server", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/\bfetch\b/);
			expect(file.text, file.path).not.toMatch(/@rowcat\/sdk|@rowcat\/query/);
			expect(file.text, file.path).not.toMatch(/useQuery|queryOptions/);
		}
	});
});

describe("the internal version doesn't stand on screen", () => {
	/**
	 * Authoring records live under a subpath of `@rowcat/domain` and the package root does not export
	 * them. Importing that subpath directly is the bypass by which `internalVersion` reaches the
	 * screen, and types cannot block it, so it is blocked here.
	 *
	 * History does not loosen this boundary. Drawing a list makes scanning the records the shortest
	 * answer, and that answer brings the internal version onto the screen.
	 *
	 * The generated runtime registry is blocked in the same place. It has no `internalVersion`, but
	 * once a screen scans the registry itself, filtering and sorting exist twice. The app calls only
	 * the three shared functions (`updateNotesFor`, `latestUpdateNoteFor`, `unseenUpdateNoteId`).
	 */
	it("imports neither the authoring records nor the generated registry directly", () => {
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
	 * Discovery is the tooling's job, not the runtime's. `pnpm updates:generate` finishes finding the
	 * authoring files before the build, and the app holds one committed artifact. If this folder began
	 * using filesystem or bundler-wide imports, notes would become a list that differs by environment
	 * (browsers and Hermes have no such ability), and the failure would show only after deployment.
	 */
	it("doesn't scan the file system", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/node:fs|readdirSync/);
			expect(file.text, file.path).not.toMatch(
				/import\.meta\.glob|require\.context/,
			);
		}
	});

	it("screens don't handle version strings", () => {
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/internalVersion|semver/i);
	});
});

describe("the shared package owns the rules", () => {
	/**
	 * Removing section order, labels and empty sections happens after projection. If a screen wrote
	 * them again, the web and this app would draw the same release in different orders, and the
	 * difference would show only when the two screens are compared side by side.
	 */
	it("the app doesn't rewrite the section vocabulary", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toContain("note.sections.map");
		expect(dialog).not.toContain("UPDATE_NOTE_SECTION_ORDER");
		expect(dialog).not.toMatch(/New features|Improvements|Fixes|Notes/);
		expect(dialog).not.toMatch(/\bfilter\(/);
	});

	/**
	 * Words are shared; decoration belongs to each surface.
	 *
	 * The check above still guards vocabulary: this dialog does not re-write the four words. What
	 * differs is only what decorates each word:
	 *
	 * ```text
	 * shared    section identity · order · words          @rowcat/domain
	 * web       Lucide component                           SECTION_ICON in apps/web
	 * this app  semantic name in the icon registry         SECTION_ICON below
	 * Discord   emoji prefix                               private table in renderDiscordUpdateNote
	 * ```
	 *
	 * This app's table holds semantics rather than glyphs, which is where it differs from the web. The
	 * screen cannot import an icon library directly (`lib/boundaries.test.ts`), so the only route is
	 * `<Icon name="…" />`, and `packages/ui-native/src/icon.tsx` knows which Lucide component each
	 * name maps to.
	 */
	it("picks icons by the shared container's semantic names", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).toContain("satisfies Record<UpdateNoteSectionId, IconName>");
		expect(dialog).toContain(
			'<Icon name={SECTION_ICON[section.id]} size="md" />',
		);
		/** One route: neither glyphs nor the library come into this file. */
		expect(dialog).toMatch(/from "@rowcat\/ui-native"/);
		expect(dialog).not.toMatch(/lucide/i);
		expect(dialog).not.toMatch(/\bSparkles\b|\bWrench\b|\bTriangleAlert\b/);
	});

	/**
	 * Semantic names must actually exist in the registry. The type already checks (`IconName`); this
	 * check adds which picture each name is. If the value diverged from the web, the same release
	 * would read as a different kind of news in the two apps.
	 */
	it("the four sections' names are registered in the central registry", () => {
		const registry = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../../packages/ui-native/src/icon.tsx",
					import.meta.url,
				),
			),
			"utf8",
		);
		for (const [name, glyph] of [
			["update-addition", "Sparkles"],
			["update-improvement", "CircleCheck"],
			["update-fix", "Wrench"],
			["update-notice", "TriangleAlert"],
		] as const) {
			expect(registry, name).toContain(`| "${name}"`);
			expect(registry, name).toContain(`"${name}": ${glyph},`);
		}
	});

	/**
	 * In-app section titles do not rely on the system emoji font. The reverting change is one line
	 * (one character before the label string), so the value is pinned here. Text sent to Discord gets
	 * its prefix inside `@rowcat/domain`, and that table is not exported.
	 */
	it("no section emoji in this folder", () => {
		for (const file of feature)
			for (const emoji of ["✨", "✅", "🛠", "❗"])
				expect(file.text, `${file.path} — ${emoji}`).not.toContain(emoji);
	});

	/**
	 * Icons are decoration. `Icon` hides from the accessibility tree without a `label`
	 * (`packages/ui-native/src/icon.tsx`), so the section reads through its word alone; giving the
	 * icon a name would read as `Sparkles, New features`.
	 *
	 * Geometry comes from the shared scale. Writing spacing in pixels would make this one place sit on
	 * a different rhythm from the rest of the app, and the mismatch shows first on a device with a
	 * large accessibility text size.
	 */
	it("icons have no names and spacing comes from tokens", () => {
		const dialog = fileAt("features/updates/update-note-dialog.tsx");
		expect(dialog).not.toMatch(/<Icon[^>]*label=/);
		expect(dialog).toContain("gap: space.sm");
		expect(dialog).not.toMatch(/gap:\s*\d/);
		expect(dialog).not.toMatch(/fontSize:|padding(?:Top|Bottom)?:\s*\d/);
	});

	/**
	 * The app does not write history order or surface filtering again. As soon as `.sort(` or
	 * `.filter(` appears where the list is drawn, "newest first" and "belongs to this surface" acquire
	 * their own meanings in each app.
	 */
	it("the app doesn't re-pick the history", () => {
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
	 * The line carrying the marker and the tab dot read the same value. Writing the two predicates
	 * separately would allow a state where the tab shows a dot but no row does.
	 */
	it("the dot's basis is the identity alone", () => {
		expect(fileAt("features/updates/update-notes-list.tsx")).toContain(
			"item.id === unseenId",
		);
		expect(fileAt("features/updates/update-notes-unseen-dot.tsx")).toContain(
			"unseenId !== null",
		);
	});

	/** Both apps call the same function; the same release must not be judged differently on two screens. */
	it("uses the same picking function as the web", () => {
		const web = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../web/src/features/updates/update-notes-provider.tsx",
					import.meta.url,
				),
			),
			"utf8",
		);
		for (const name of ["updateNotesFor", "unseenUpdateNoteId"]) {
			expect(web, name).toContain(name);
			expect(
				fileAt("features/updates/update-notes-provider.tsx"),
				name,
			).toContain(name);
		}
	});

	/**
	 * One rule for monotonicity. If the screen wrote `>=` again, a change fixing only one of the two
	 * sites would revive the marker of the newest note already read. Opening older rows is now an
	 * ordinary action, so that revival actually happens.
	 */
	it("the no-going-back rule is one function", () => {
		const provider = fileAt("features/updates/update-notes-provider.tsx");
		expect(provider).toContain("mergeSeenUpdateNoteId");
		expect(provider).not.toMatch(/current\s*>=|>=\s*note\.id/);
	});
});

describe("a device value, not an account value", () => {
	/** Stored in per-member SQLite, the same note would reappear for Bob after Alice signs out. */
	it("doesn't use member-scoped storage", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/useLocalScope|ChatStore/);
			expect(file.text, file.path).not.toMatch(/SecureStore/);
			expect(file.text, file.path).not.toMatch(/viewerId|useViewer/);
		}
	});

	/** Only one file knows native modules; the rest run unchanged in Node. */
	it("one wiring place knows the expo module", () => {
		for (const file of feature) {
			if (file.path === "features/updates/device-seen-storage.ts") continue;
			expect(file.text, file.path).not.toMatch(/\bexpo-/);
		}
		expect(fileAt("features/updates/device-seen-storage.ts")).toContain(
			"deviceValueStorage",
		);
	});

	/** The seen fact has one owner; with two, the tab dot and the row dot would diverge. */
	it("one place opens the store", () => {
		const openers = feature
			.filter((file) => file.path !== "features/updates/seen-store.ts")
			.filter((file) => /createUpdateNoteSeenStore\(/.test(file.text))
			.map((file) => file.path);
		expect(openers).toEqual(["features/updates/update-notes-provider.tsx"]);
	});
});

describe("doesn't pop up on its own", () => {
	/**
	 * The root does not mount the dialog. For a time `app/_layout.tsx` raised a note behind the gate,
	 * and removing that wiring was the whole change of that slice.
	 *
	 * The root holds one seen-fact container now. Its place is there because the markers stand in
	 * three places (the header bell, the tab dot, the history dot), and only that spot covers all
	 * three; a container per screen would leave a dot opened on one screen still lit on another. The
	 * point of this check is that the container does not bring the window: neither the list, the row,
	 * nor the dialog is drawn by the root.
	 */
	it("the root stands only the container and doesn't mount the dialog", () => {
		const layout = fileAt("app/_layout.tsx");
		expect(layout).not.toContain("UpdateNoteAnnouncement");
		expect(layout).not.toContain("UpdateNoteDialog");
		expect(layout).not.toMatch(/autoOpen|showOnLaunch|showOnStartup/i);
		expect(layout).toContain("<UpdateNotesProvider>");
		expect(layout).not.toContain("<UpdateNotesList");
		expect(layout).not.toContain("<UpdateNoteRow");
	});

	/**
	 * No automatic-display vocabulary remains. A leftover name brings the wiring back soon: what was
	 * removed is not one file but the concept that the app opens on its own.
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

	/** The composing screen does not open the window on its own either; opening is one press on the row. */
	it("the notifications screen doesn't open the dialog itself", () => {
		const text = screen();
		expect(text).not.toContain("UpdateNoteDialog");
		expect(text).not.toMatch(/autoOpen|showOnLaunch|showOnStartup/i);
	});

	/**
	 * Opening is a human action. The list has no effect that turns opening on by itself; one such line
	 * would move the automatic display to a different place.
	 */
	it("the list doesn't open itself", () => {
		const list = fileAt("features/updates/update-notes-list.tsx");
		expect(list).toContain("onOpen=");
		expect(list).not.toMatch(/useState\(true\)/);
		expect(list).not.toContain("useEffect");
	});

	/**
	 * Selecting a tab alone marks nothing as read. The place that records the seen fact must be a row
	 * press, so that someone who only scrolls through history leaves no mark.
	 */
	it("one place writes the seen fact", () => {
		const writers = feature
			.filter((file) => file.path !== "features/updates/seen-store.ts")
			.filter((file) => /markSeen\(/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(writers).toEqual([
			"features/updates/update-notes-list.tsx",
			"features/updates/update-notes-provider.tsx",
		]);
		expect(fileAt("features/updates/update-note-dialog.tsx")).not.toMatch(
			/markSeen/,
		);
	});
});

describe("doesn't create a route", () => {
	/**
	 * Not a resource to address by URL. Being a tab of the notification screen expresses that fact; as
	 * a route, the screen would soon require search, filters and an archive.
	 */
	it("there's no update notes route", () => {
		const routes = product
			.filter((file) => file.path.startsWith("app/"))
			.map((file) => file.path);
		for (const route of routes)
			expect(route, route).not.toMatch(/update|whats-new|release/i);
	});
});

describe("update notes don't know the inbox", () => {
	/** The opposite direction: this slice knows neither the inbox's queries, mutations nor its keys. */
	it("doesn't take in the inbox's lookups or mutations", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/useNotifications/);
			expect(file.text, file.path).not.toMatch(/markNotificationRead|markRead/);
			expect(file.text, file.path).not.toMatch(/unread|markAllRead/i);
		}
	});
});

describe("screen names in the body aren't drawn with their backticks", () => {
	/**
	 * When the authoring convention (`Conversation settings`) was printed as-is, users saw the backticks as text.
	 * Every place that draws a sentence goes through `UpdateNoteText`, and the splitting rule is one
	 * shared function. If the app began cutting backticks itself, the two apps would draw the same
	 * sentence in different pieces.
	 */
	it("the intro and items are drawn through segments", () => {
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
