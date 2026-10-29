import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of presentation: which interaction uses which container.
 *
 * Surfaces in this app were once all bottom sheets, and a wrong container still compiles and passes
 * tests; only side-by-side comparison with the web shows it. The rule is not "no sheets":
 * `ChoiceSheet` has a legitimate use. The rule is which interaction uses which container, as
 * tabulated in `docs/design/ARCHITECTURE.md`. `NavigationDrawer` is the one container added in this
 * slice; `public-api.test.ts` in `ui-native` locks that its geometry cannot be chosen by callers.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * Scans run on source with comments stripped. Comments quote the banned words to explain the
 * boundary, and scanning raw text would flag those explanations as violations.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	/** The scanner holds the banned words as patterns, so scanning itself would always fail. */
	.filter((file) => !file.path.endsWith("presentation-policy.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

/**
 * Deliberately no allowlist of files permitted to open a sheet. An allowlist can be satisfied by
 * adding one more name, which looks like an ordinary diff in review. The generic `Sheet` is an
 * internal detail of `@rowcat/ui-native` (not exported from the root, no subpaths), and
 * `ChoiceSheet` has no `children`, so the guard checks that feature code never invokes a sheet. If
 * a change seems to need one, fix that surface's container instead (room settings is `Dialog
 * placement="adaptive"`; see `docs/design/ARCHITECTURE.md`).
 */

/**
 * Product surface: everything except the development-only visual QA lab (`features/visual-lab/`).
 * The lab renders every container on purpose, so it is not the subject of these checks. It is
 * excluded from the set rather than added to a list, so that a list stays "product surfaces that
 * use this container" and a product file that picks a container breaks the checks. The lab's
 * existence is asserted below, so a moved folder cannot silently exclude nothing.
 */
const VISUAL_LAB = "features/visual-lab/";
const productSurface = product.filter(
	(file) => !file.path.startsWith(VISUAL_LAB),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	it("every conversation surface file is in place", () => {
		const expected = [
			"features/chat/room/use-management.tsx",
			"features/chat/messages/use-actions.tsx",
			"features/chat/messages/action-bar.tsx",
			"features/chat/room/rename-dialog.tsx",
			"features/chat/room-settings/dialog.tsx",
			"features/chat/room/info-content.tsx",
			"features/chat/messages/edit-dialog.tsx",
			"features/chat/memory/panel.tsx",
			"features/chat/messages/report-modal.tsx",
			"features/chat/chat-search.tsx",
			"features/chat/room/actions-menu.tsx",
			"features/moderation/report-dialog.tsx",
			"features/moderation/report-menu.tsx",
			"features/chat-library/chat-library-screen.tsx",
			"features/chat-library/library-toolbar.tsx",
			"features/chat-library/room-row.tsx",
			"features/playtest/playtest-screen.tsx",
			"features/playtest/playtest-settings-dialog.tsx",
			"features/profile/use-block-creator.tsx",
			"features/profile/use-profile-menu.tsx",
			"features/profile/profile-header.tsx",
			"features/profile/creator-profile-screen.tsx",
			"features/story/story-detail-screen.tsx",
			"features/story/comments/comment-row.tsx",
			"features/shell/app-sidebar.tsx",
			"features/shell/app-header.tsx",
			"features/account/avatar-crop-dialog.tsx",
			"features/account/email-change-dialog.tsx",
			"features/account/password-dialog.tsx",
			"features/account/disconnect-method-dialog.tsx",
			"features/account/passkey-dialogs.tsx",
			"features/account/revoke-others-dialog.tsx",
			"features/account/pinned-story-picker-dialog.tsx",
			"features/settings/settings-shell.tsx",
			"features/settings/settings-navigation.tsx",
			"features/settings/appearance-section.tsx",
			"features/settings/appearance-shortcut.tsx",
			"features/settings/theme-customization-section.tsx",
			"features/settings/theme-color-dialog.tsx",
			"features/settings/local-data-section.tsx",
			"features/settings/generation-defaults-section.tsx",
			"features/persona/persona-library-section.tsx",
			"features/persona/persona-form-dialog.tsx",
		];
		for (const path of expected) expect(() => fileAt(path)).not.toThrow();
	});

	/**
	 * File names name a container too. A `*-sheet.tsx` name left on a surface that is not a sheet
	 * makes the next reader assume a sheet and build another beside it (this happened with
	 * `room-settings-sheet.tsx`). No exceptions remain: the generic `Sheet` is internal to
	 * `@rowcat/ui-native`, so no feature file can open one and such a name is always wrong. A
	 * single-choice surface calls `ChoiceSheet` and names itself by its role
	 * (`appearance-shortcut.tsx`).
	 */
	it("not a single file uses the sheet name", () => {
		for (const file of all)
			expect(file.path, file.path).not.toMatch(/-sheet\.tsx?$/);
	});
});

describe("overflow is a menu attached to its trigger", () => {
	/**
	 * An open room's header has no overflow menu; a conversation list row does. Past regressions all
	 * came from "room actions belong in one menu". The header shows Find and Room settings directly,
	 * with the rest inside the settings dialog. A list row has many rooms to act on, so its anchor
	 * menu (rename, settings, delete) lives in that row (`room-actions-menu.tsx`). The management hook
	 * draws no menu; it receives a request and opens one dialog.
	 */
	it("the room management hook doesn't open the overflow menu", () => {
		const hook = fileAt("features/chat/room/use-management.tsx");
		expect(hook).not.toContain("<DropdownMenu");
		expect(hook).not.toContain("<MenuItem");
		expect(hook).not.toMatch(/\bSheet\b/);
	});

	/**
	 * Row management is an anchor menu: not a sheet, not a swipe, not long-press only. Touch has no
	 * hover, so the trigger is always visible and no gesture-only action is created. Item vocabulary
	 * and order come from `ROOM_ACTIONS` in `@rowcat/chat`, which the web reads too. This check guards
	 * that the table is actually iterated; a hand-written array breaks it first.
	 */
	it("conversation list row management is a DropdownMenu", () => {
		const menu = fileAt("features/chat/room/actions-menu.tsx");
		expect(menu).toContain("<DropdownMenu");
		expect(menu).toContain("<MenuItem");
		expect(menu).toContain("ROOM_ACTIONS.map");
		expect(menu).not.toMatch(/\bSheet\b/);
		expect(menu).not.toContain("<Dialog");
		/** The trigger label names which conversation it belongs to, which is all a list needs. */
		expect(menu).toContain("roomActionsLabel(room.title)");
	});

	/**
	 * The row's open target and its management trigger are siblings. Nesting makes the press target
	 * unpredictable (an outer handler receives a tap meant for the menu) and reads as a button inside
	 * a button to assistive tech. The web avoids the same nesting for links
	 * (`room-row-markup.test.ts`).
	 */
	it("the row's management trigger isn't inside the opening area", () => {
		const row = fileAt("features/chat-library/room-row.tsx");
		expect(row).toContain("<RoomActionsMenu");
		/** `</Pressable>` must close before the menu; the menu sits outside it. */
		expect(row.indexOf("</Pressable>")).toBeLessThan(
			row.indexOf("<RoomActionsMenu"),
		);
		expect(row).not.toMatch(/\bSheet\b/);
	});

	/**
	 * Sort is a value picked from a control, so it is a `Select`. Having only three values does not
	 * justify `ChoiceSheet`: that surface needs rising from the bottom to help the interaction, and a
	 * toolbar control that already shows the current value does not. The web uses the same surface
	 * here.
	 */
	it("sorting is a Select", () => {
		const toolbar = fileAt("features/chat-library/library-toolbar.tsx");
		expect(toolbar).toContain("<Select");
		expect(toolbar).toContain("<SelectOption");
		expect(toolbar).not.toContain("ChoiceSheet");
		expect(toolbar).not.toMatch(/\bSheet\b/);
		expect(toolbar).not.toContain("<Dialog");
	});

	/**
	 * The conversation list is a route, not a floating layer. It must be addressable: deleting the
	 * open room leaves to that address (`chat-screen.tsx`), someone who opens a missing room's address
	 * exits through it, and login returns to this path.
	 */
	it("the conversation list is a screen, not a floating layer", () => {
		const screen = fileAt("features/chat-library/chat-library-screen.tsx");
		expect(screen).toContain("<Screen");
		expect(screen).toContain("<FlatList");
		expect(screen).not.toContain("<Dialog");
		expect(screen).not.toMatch(/\bSheet\b/);
		/** The route exists; a screen without an address would break the three claims above. */
		expect(() => fileAt("app/chats.tsx")).not.toThrow();
	});

	/**
	 * Room settings uses the same container as the web (`apps/web`'s `room-settings-dialog.tsx`). It
	 * also locks that the faces are not stacked as two dialogs: one `view` switches inside it, and
	 * sibling dialogs (memory, rename, delete) close this one before opening.
	 */
	it("conversation settings is a Dialog and the panes split inside it", () => {
		const dialog = fileAt("features/chat/room-settings/dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toMatch(/\bSheet\b/);
		expect(dialog).toContain("RoomSettingsView");
		/** Each sibling opener closes this dialog first. */
		expect(dialog).toMatch(/onClose\(\);\s*\n\s*onOpenRow\(row\);/);
	});

	/**
	 * On narrow screens this dialog docks to the bottom, and it is still a dialog, not a sheet. The
	 * web's dialog docks below `sm` and centers above it; this app always centered it, so the same
	 * settings screen looked like two products. The fastest answer to that requirement is `Sheet`,
	 * which would silently change the container. Only the coordinates change: placement is a named
	 * opt-in, and `resolveDialogPlacement` in `@rowcat/ui-native` (value table in
	 * `dialog-placement.test.ts`) interprets it.
	 */
	it("conversation settings docks to the bottom on narrow screens but isn't a sheet", () => {
		const dialog = fileAt("features/chat/room-settings/dialog.tsx");
		expect(dialog).toContain('placement="adaptive"');
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toMatch(/\bSheet\b/);
		/** The screen does not measure geometry itself; the primitive owns that decision. */
		expect(dialog).not.toMatch(/useWindowDimensions|Dimensions\.get/);
	});

	/**
	 * Pins that placement is an opt-in. If sibling dialogs followed along, placement would have become
	 * the default, which this dialog's tests alone would not reveal.
	 */
	it("sibling windows are still centred floating boxes", () => {
		for (const path of [
			"features/chat/room/rename-dialog.tsx",
			"features/chat/messages/edit-dialog.tsx",
		])
			expect(fileAt(path), path).not.toContain("placement=");
	});

	/** The message row's `⋯`, the same structure the web uses on narrow screens. */
	it("message overflow is a DropdownMenu", () => {
		const hook = fileAt("features/chat/messages/use-actions.tsx");
		expect(hook).toContain("<DropdownMenu");
		expect(hook).toContain("<MenuItem");
		expect(hook).not.toMatch(/\bSheet\b/);
	});

	/**
	 * Copy stays outside the menu. It is non-destructive and frequent, and its copied indicator needs
	 * a place to show; pressing inside a menu closes the menu and removes the indicator with it. The
	 * web makes the same decision.
	 */
	it("copy didn't move into the menu", () => {
		const bar = fileAt("features/chat/messages/action-bar.tsx");
		expect(bar).toContain("useCopyMessage");
		expect(bar).toContain('copyState.state === "copied"');

		const hook = fileAt("features/chat/messages/use-actions.tsx");
		expect(hook).toMatch(/filter\([\s\S]{0,80}!==\s*"copy"/);
	});

	/**
	 * The menu lives inside the row. An anchor menu measures the control it is attached to, so one
	 * screen cannot own it; the trigger and the menu must share a tree.
	 */
	it("the menu is in the same tree as its trigger", () => {
		expect(fileAt("features/chat/messages/action-bar.tsx")).toContain("{menu}");
		expect(fileAt("features/chat/chat-screen.tsx")).toContain(
			"menu={messageActions.renderMenu(",
		);
	});

	/**
	 * The header draws the same two actions as the web. Exporting the trigger from the hook was an
	 * anchor-menu concern (it had to measure its control); a dialog has no such coupling.
	 */
	it("the header draws find and conversation settings directly", () => {
		const screen = fileAt("features/chat/chat-screen.tsx");
		expect(screen).toContain('icon="search"');
		expect(screen).toContain('icon="room-settings"');
		/**
		 * The trigger names its target. The hook used to target only the open room and took no argument;
		 * the conversation list removed that assumption.
		 */
		expect(screen).toContain("management.requestSettings(room)");
	});
});

describe("the public profile's container", () => {
	/**
	 * The profile is a route, not a dialog, sheet, drawer, or branch inside the work detail. It must
	 * be addressable: bylines, discovery cards and comment authors all link here, login returns to
	 * this path, and a guest who taps Follow and comes back lands here. None of that fits a layer.
	 *
	 * One vertical list is also locked. A grid `FlatList` inside a `ScrollView` gives the outside
	 * infinite height, which switches virtualization off entirely.
	 */
	it("the profile is a screen, not a floating layer", () => {
		const screen = fileAt("features/profile/creator-profile-screen.tsx");
		expect(screen).toContain("<Screen");
		expect(screen).toContain("<FlatList");
		expect(screen).not.toContain("<Dialog");
		expect(screen).not.toMatch(/\bSheet\b/);
		expect(screen).not.toContain("<ScrollView");
		/** The route exists; a screen without an address would break the three claims above. */
		expect(() => fileAt("app/creators/[creatorId].tsx")).not.toThrow();
	});

	/**
	 * Block lives in a menu anchored to a trigger, not as a red button beside Follow. The two actions
	 * weigh differently; side by side they would look the same size, and the destructive colour would
	 * become the most prominent element of the profile header. The web's `block-menu.tsx` uses the
	 * same container.
	 */
	it("block is inside a DropdownMenu", () => {
		const block = fileAt("features/profile/use-block-creator.tsx");
		expect(block).toContain("<MenuItem");
		expect(block).not.toMatch(/\bSheet\b/);
		expect(block).not.toContain("<Dialog");

		/**
		 * The block hook does not own a menu. Once reporting arrived, a second trigger here would put two
		 * overflow menus in the profile header that would soon behave differently. This hook exports one
		 * row.
		 */
		expect(block).not.toContain("<DropdownMenu");

		const menu = fileAt("features/profile/use-profile-menu.tsx");
		expect(menu).toContain("<DropdownMenu");
		expect(menu).not.toMatch(/\bSheet\b/);
		/** The trigger label names whom the menu is about. */
		expect(menu).toMatch(/label=\{`Manage creator \$\{creatorName\}`\}/);
	});

	/**
	 * Report sits above Block, and the order carries meaning. A report ends in review, while Block
	 * removes the person from one's own screen and cuts the follow, so the destructive item goes last.
	 * The web's `block-menu.tsx` uses the same order. Report is not painted destructive: red would
	 * read it as a punishment, and if that colour lost its meaning, the truly destructive row would
	 * stop reading as such.
	 */
	it("the order inside the menu is report → block", () => {
		const menu = fileAt("features/profile/use-profile-menu.tsx");
		expect(menu.indexOf("{report.item}")).toBeGreaterThan(-1);
		expect(menu.indexOf("{report.item}")).toBeLessThan(
			menu.indexOf("{block.item}"),
		);

		const item = fileAt("features/moderation/report-menu.tsx");
		expect(item).toMatch(/<MenuItem\s+icon="report"\s+label="Report"/);
		expect(item).not.toContain("destructive");
	});

	/**
	 * Block confirms in an `AlertDialog`; unblock has no confirmation. This mirrors the web: blocking
	 * has large effects and does not come back on undo (the follow is not restored), while unblocking
	 * is reversible and costs nothing. Confirming every action makes the dialog unread, which also
	 * hides the confirmations that matter.
	 */
	it("block confirmation is an AlertDialog and unblocking has none", () => {
		const block = fileAt("features/profile/use-block-creator.tsx");
		expect(block).toContain("<AlertDialog");
		expect(block.match(/<AlertDialog/g)).toHaveLength(1);
		/** The copy states before pressing that the follow is not restored. */
		expect(block).toContain("Unblocking doesn't restore the follow");
		/** Unblock sends immediately without opening a dialog. */
		expect(block).toMatch(
			/label="Unblock"[\s\S]{0,400}mutation\.mutate\(false/,
		);
	});

	/**
	 * The profile header has exactly one overflow menu. A second one would put "manage" and "settings"
	 * for the same person 20pt apart, and no one would remember which holds what.
	 */
	it("the header has one menu", () => {
		const header = fileAt("features/profile/profile-header.tsx");
		expect(header).not.toContain("<DropdownMenu");
		expect(header).toContain("menu.trigger");
		/** One place creates the trigger; two hooks would mean two menus. */
		expect(header).not.toContain("useBlockCreator");
		expect(header).toContain("useProfileMenu");
	});

	/**
	 * The whole profile surface has one trigger. The check above reads only the header file, and the
	 * fastest answer to a report request is a `ReportMenu` placed beside it in another file (the
	 * screen or the follow control), which leaves the header untouched.
	 */
	it("the profile folder has only one trigger", () => {
		const triggers = product.filter(
			(file) =>
				file.path.startsWith("features/profile/") &&
				(file.text.includes("<DropdownMenu") ||
					file.text.includes("<ReportMenu")),
		);
		expect(triggers.map((file) => file.path)).toEqual([
			"features/profile/use-profile-menu.tsx",
		]);
	});
});

describe("forms and details are dialogs", () => {
	it("rename is a Dialog", () => {
		const dialog = fileAt("features/chat/room/rename-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toMatch(/\bSheet\b/);
		/** A single-field form, so it does not fill the screen. */
		expect(dialog).not.toContain('size="full"');
	});

	/**
	 * Room info has no dialog of its own. It used to open straight from the header's overflow; now it
	 * is a face inside room settings, so it has no container and is named `…Content`. A `…Dialog` name
	 * would make the next reader treat it as a dialog and build another beside it.
	 */
	it("conversation info is a pane inside the settings window", () => {
		const content = fileAt("features/chat/room/info-content.tsx");
		expect(content).not.toContain("<Dialog");
		expect(content).not.toMatch(/\bSheet\b/);
		expect(fileAt("features/chat/room-settings/dialog.tsx")).toContain(
			"<RoomInfoContent",
		);
	});

	/**
	 * Editing branches on device geometry into two branches, neither a sheet. A short screen needs a
	 * larger form surface, not a gesture that rises from the bottom. The decision itself is
	 * value-tested in `message-edit-presentation.test.ts`.
	 */
	it("message editing is a Dialog, and a pure function decides its size", () => {
		const dialog = fileAt("features/chat/messages/edit-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).toContain("messageEditPresentation(height)");
		expect(dialog).not.toMatch(/\bSheet\b/);
	});

	/**
	 * Picking a persona before starting is one dialog with two faces. Pressing `New persona` in the list
	 * changes this dialog's content (`onBack` is the face switch). Opening the form as a second dialog
	 * would give accessibility focus two owners and make Android back unpredictable, the same axis as
	 * confirming a memory deletion inline. Not a sheet either: choosing does not end the interaction;
	 * it leads to a form that brings up the keyboard.
	 */
	it("choosing a persona before starting is two panes of one window", () => {
		const dialog = fileAt("features/story/story-persona-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).toContain("onBack=");
		expect(dialog).toContain("<PersonaEditor");
		expect(dialog).not.toMatch(/\bSheet\b/);
		/** No second dialog: the form is not `PersonaFormDialog`, which would open its own window. */
		expect(dialog).not.toContain("PersonaFormDialog");
	});
});

describe("irreversible confirmations are AlertDialogs", () => {
	/**
	 * Leaving the platform's `Alert` is not only about looks. That dialog is imperative, so its
	 * wording freezes when shown, while this app's confirmation copy usually states counts ("12 later
	 * conversations will be deleted"). A sync arriving in between would make the number the user read
	 * differ from the real scope.
	 */
	it("not a single Alert.alert in product paths", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bAlert\.alert\b/);
			expect(file.text, file.path).not.toMatch(
				/from\s+["']react-native["'][^\n]*\bAlert\b/,
			);
		}
	});

	it("room deletion is an AlertDialog", () => {
		const hook = fileAt("features/chat/room/use-management.tsx");
		expect(hook).toContain("<AlertDialog");
		expect(hook).toContain("DELETE_ROOM_CONFIRM.title");
	});

	it("tail rewrite confirmation is an AlertDialog", () => {
		const hook = fileAt("features/chat/messages/use-actions.tsx");
		expect(hook).toContain("<AlertDialog");
		expect(hook).toContain("DELETE_FROM_CONFIRM_TITLE");
		expect(hook).toContain("REGENERATE_CONFIRM_TITLE");
	});

	/**
	 * Only a memory row's delete is confirmed inline. Opening that confirmation as its own window
	 * stacks a dialog on the face, which makes Android back's target unpredictable (the web's
	 * `memory-dialog.tsx` made the same call).
	 */
	it("memory deletion confirmation opens inside the row", () => {
		const panel = fileAt("features/chat/memory/panel.tsx");
		expect(panel).toContain("setConfirming(true)");
		expect(panel).not.toContain("<AlertDialog");
	});
});

describe("large things fill the surface", () => {
	/**
	 * The report form holds five reasons, a description, an evidence preview, an include toggle, a
	 * notice, an error and two buttons. In a sheet, the notice and preview meant to be read would
	 * scroll out of view.
	 */
	it("reporting is a form that fills the surface", () => {
		/**
		 * The container decision moved to the shared dialog, since all four targets use it. If it stayed
		 * in the AI report file, only public reports could drift to another container.
		 *
		 * Eleven reasons are the basis: eleven 44pt rows alone come to 484pt, with the description field,
		 * character count, error and two buttons below them.
		 */
		const dialog = fileAt("features/moderation/report-dialog.tsx");
		expect(dialog).toContain('size="full"');
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toMatch(/\bSheet\b/);
		/**
		 * Reason is a value picked from a control, so it is a `Select` (as on the web form). It does not
		 * fold into a sheet either: `ChoiceSheet` is for short choices, and eleven rows are not short.
		 *
		 * This spot once required `<ChoiceGroup`. That reasoning was right that the dialog must fill the
		 * screen, but expanding the list in place to carry that height was wrong; the web folds the same
		 * control into one trigger.
		 */
		expect(dialog).toContain("<Select");
		expect(dialog).not.toContain("<ChoiceGroup");
		expect(dialog).not.toContain("ChoiceSheet");

		/** The AI report is a thin shell that calls that dialog; it does not pick its own container. */
		const modal = fileAt("features/chat/messages/report-modal.tsx");
		expect(modal).toContain("<ReportDialog");
		expect(modal).not.toContain("<Dialog");
		expect(modal).not.toMatch(/\bSheet\b/);
		expect(modal).not.toContain("size=");
	});

	/**
	 * The public report entry point is a menu anchored to a trigger. A flag left beside the body would
	 * weigh the same as a favourite. Reporting is rare, and a mis-press creates review work for
	 * someone else, so it belongs one layer deeper.
	 */
	it("public reports are behind a DropdownMenu", () => {
		const menu = fileAt("features/moderation/report-menu.tsx");
		expect(menu).toContain("<DropdownMenu");
		expect(menu).toContain("<MenuItem");
		expect(menu).not.toMatch(/\bSheet\b/);
		expect(menu).not.toContain("<AlertDialog");

		/** Work detail uses that menu and does not place a separate flag button. */
		const story = fileAt("features/story/story-detail-screen.tsx");
		expect(story).toContain("<ReportMenu");
		expect(story).not.toContain('icon="report"');
		expect(story).not.toContain("<DropdownMenu");
	});

	/**
	 * Comment row actions are collected into one overflow menu. The delete icon used to sit on the
	 * row; when reporting arrived, the fastest answer was another flag beside it, which left two
	 * targets at the row's end where one was always absent (delete on one's own row, report on
	 * others').
	 *
	 * Delete confirmation is still an `AlertDialog` and opens inside the row.
	 */
	it("comment rows have one overflow and one confirm window", () => {
		const row = fileAt("features/story/comments/comment-row.tsx");
		expect(row).toContain("<DropdownMenu");
		expect(row.match(/<DropdownMenu/g)).toHaveLength(1);
		expect(row).toContain("commentRowAction");
		expect(row).toContain("<AlertDialog");
		expect(row.match(/<AlertDialog/g)).toHaveLength(1);
		expect(row).not.toMatch(/\bSheet\b/);
		/** The trigger label names which row's menu it is, which is all a list needs. */
		expect(row).toMatch(/label=\{\s*action === "delete"/);

		/** No swipe-delete and no long-press-only action either. */
		for (const gesture of ["onLongPress", "Swipeable", "PanResponder"])
			expect(row, gesture).not.toContain(gesture);
	});

	/** Memory is a workspace with list, add, edit, pin and delete. */
	it("memory is a workspace that fills the surface", () => {
		const panel = fileAt("features/chat/memory/panel.tsx");
		expect(panel).toContain('size="full"');
		expect(panel).not.toMatch(/\bSheet\b/);
	});

	/**
	 * Search stays a surface that replaces the canvas; shrinking the container does not change that.
	 * Results can run to hundreds of rows and need virtualization (a `FlatList` inside a `ScrollView`
	 * switches it off), and pressing a result jumps to the history behind it. Jumping from a layer
	 * covering that list would not make sense.
	 */
	it("conversation search is a surface replacing the canvas", () => {
		const search = fileAt("features/chat/chat-search.tsx");
		expect(search).toContain("<FlatList");
		expect(search).not.toMatch(/\bSheet\b/);
		expect(search).not.toMatch(/<Dialog/);
		/** The screen draws that surface in place of the canvas. */
		expect(fileAt("features/chat/chat-screen.tsx")).toContain(
			"<ChatSearchPanel",
		);
	});
});

describe("a generic sheet isn't expressible in feature code", () => {
	/**
	 * The most important group in this file. An allowlist of sheet-opening files lets a one-line
	 * addition pass review, and this app returned to that shape more than once. This group locks
	 * expressibility instead: `@rowcat/ui-native` does not export the generic `Sheet` and opens no
	 * subpaths, so the three checks below are already blocked by compilation and bundling. These
	 * checks catch the case where that block is undone first (re-exporting `Sheet` or restoring a
	 * wildcard in `exports`), since such a change touches no file in this app.
	 */
	it("doesn't import Sheet from the root", () => {
		for (const file of all)
			expect(file.text, file.path).not.toMatch(
				/import\s*(?:type\s*)?\{[^}]*\bSheet\b[^}]*\}\s*from\s*["']@rowcat\/ui-native["']/,
			);
	});

	/**
	 * Subpaths are blocked too. `@rowcat/ui-native/sheet` worked whenever the package's `exports` was
	 * open, regardless of root exports, and the import reads as one ordinary line in review.
	 */
	it("doesn't come in through a package subpath", () => {
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/ui-native\//);
			/** A relative path that crosses the workspace is the same door. */
			expect(file.text, file.path).not.toMatch(
				/from\s+["'][^"']*packages\/ui-native/,
			);
		}
	});

	/**
	 * The app's path mapping must not reopen that door either. The checks above read imports as
	 * written; this one asks whether an import can resolve at all. A `"@rowcat/ui-native/*"` line in
	 * `paths` makes TypeScript skip the package's `exports` and resolve straight to source, so
	 * `@rowcat/ui-native/sheet` would type-check and the package's closed subpaths would mean nothing
	 * for this app. That line looks like its neighbours (`@rowcat/chat/*`, `@rowcat/domain/*`), so
	 * review cannot see it, and the reopening stays invisible until someone imports through it. The
	 * mapping is therefore locked by value: this package is one root.
	 */
	it("path mapping doesn't open subpaths", () => {
		const tsconfig = JSON.parse(
			readFileSync(
				fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
				"utf8",
			),
		) as { compilerOptions?: { paths?: Record<string, string[]> } };
		const paths = tsconfig.compilerOptions?.paths ?? {};

		/** The mapping was actually read; an empty object is not treated as passing. */
		expect(paths["@rowcat/ui-native"]).toEqual([
			"../../packages/ui-native/src/index.ts",
		]);
		for (const key of Object.keys(paths))
			expect(key, key).not.toMatch(/^@rowcat\/ui-native\//);
	});

	/** No product file renders a sheet either. */
	it("product paths have no place drawing a sheet", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/<Sheet\b/);
			expect(file.text, file.path).not.toMatch(/<\/Sheet>/);
		}
	});

	/**
	 * The opposite direction: a short single choice still rises from the bottom. Locking only the
	 * negative would read this slice as "sheets were removed", which it did not do.
	 *
	 * The consumer count dropped to one. The discovery screen's filter choice used to use this
	 * capability, but that toolbar moved to the web's IA (two menu triggers plus a token for the
	 * active filter), where choosing an axis is an anchor menu, and the sheet did nothing there. The
	 * remaining consumer is the header's brightness trigger, which fits the capability's definition
	 * exactly (three values, closes on pick, no place to keep it open).
	 */
	it("short single choices call ChoiceSheet", () => {
		const shortcut = fileAt("features/settings/appearance-shortcut.tsx");
		expect(shortcut).toContain("<ChoiceSheet");
		expect(shortcut).toMatch(
			/import\s*\{[^}]*\bChoiceSheet\b[^}]*\}\s*from\s*["']@rowcat\/ui-native["']/,
		);
	});

	/** There is one consumer today; when that grows, re-read the containers table first. */
	it("one place calls ChoiceSheet", () => {
		/** The lab renders every container, so it is out of scope for this question (`productSurface`). */
		const callers = productSurface
			.filter((file) => file.text.includes("<ChoiceSheet"))
			.map((file) => file.path);
		expect(callers).toEqual(["features/settings/appearance-shortcut.tsx"]);

		/** The exempted files exist; without them the filter above does nothing. */
		expect(product.some((file) => file.path.startsWith(VISUAL_LAB))).toBe(true);
	});

	/**
	 * Nor does the call site pass arbitrary content. `ChoiceSheet` has no `children`, which
	 * `packages/ui-native` locks in its types. This check verifies that callers pass only a value
	 * list: if a call site starts knowing the sheet's axes (`scroll`, `snapPoints`, `renderContent`),
	 * the capability is turning back into a container.
	 */
	it("doesn't pass container axes to the choice capability", () => {
		for (const file of product) {
			if (!file.text.includes("<ChoiceSheet")) continue;
			for (const hatch of ["scroll", "snapPoints", "renderContent", "children"])
				expect(file.text, `${file.path} — ${hatch}`).not.toContain(hatch);
		}
	});
});

describe("the UI package owns presentation primitives", () => {
	/**
	 * Feature code importing `@rn-primitives/*` directly would give each screen its own portal,
	 * accessibility wiring and stacking order. The one exit is `@rowcat/ui-native`.
	 */
	it("feature code doesn't import rn-primitives directly", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/@rn-primitives\//);
	});

	/**
	 * No floating layers built directly on `Modal` or `BackHandler`. A hand-built layer has no
	 * accessibility focus movement, screen-reader escape or `aria-modal`, and the absence is silent.
	 */
	it("feature code doesn't build floating layers directly", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bBackHandler\b/);
			expect(file.text, file.path).not.toMatch(
				/from\s+["']react-native["'][^\n]*\bModal\b/,
			);
		}
	});

	/**
	 * One place reads device **geometry**. Safe areas and the keyboard are already blocked by
	 * `lib/boundaries.test.ts`; this guards window size, with one exception: the message edit form,
	 * which picks its dialog size from a pure function. If more files read geometry, each screen grows
	 * its own responsive rules that know nothing of each other.
	 *
	 * This guards **width and height**, not the hook name. `useWindowDimensions()` also returns the
	 * accessibility font scale (`fontScale`). Using that to size slots is the opposite of what this
	 * rule blocks: it fits user-chosen text, and blocking it would leave icons clipped at large text
	 * sizes. So the check looks at which axes are destructured, not at the hook name.
	 * `PixelRatio.getFontScale()` is not a workaround because it reads once and misses later setting
	 * changes; the consuming file's comment carries that decision.
	 */
	it("one feature file reads window geometry", () => {
		/** Matches `const { width, height } = useWindowDimensions()` even when the names are changed. */
		const geometry =
			/\{[^{}]*\b(?:width|height)\b[^{}]*\}\s*=\s*useWindowDimensions\(/;
		for (const file of product) {
			if (file.path === "features/chat/messages/edit-dialog.tsx") continue;
			expect(file.text, file.path).not.toMatch(geometry);
			expect(file.text, file.path).not.toMatch(/\bDimensions\.get\b/);
		}
	});

	/** Only one axis may be taken from that hook; the check above catches the rest. */
	it("outside the geometry exception the only axis taken is fontScale", () => {
		for (const file of product) {
			if (file.path === "features/chat/messages/edit-dialog.tsx") continue;
			for (const [, destructured] of file.text.matchAll(
				/\{([^{}]*)\}\s*=\s*useWindowDimensions\(/g,
			)) {
				const axes = destructured
					.split(",")
					.map((axis) => axis.trim())
					.filter(Boolean);
				expect(axes, file.path).toEqual(["fontScale"]);
			}
		}
	});
});

describe("global navigation is a surface opening from the left", () => {
	/**
	 * Choosing this surface's container was the easiest decision in this slice to reverse. Three
	 * answers to "a drawer from the left" all compile: a generic `Sheet` rises from the bottom, so its
	 * gesture misstates where it returns; `Dialog placement` matches the coordinates but makes back,
	 * title and close belong to a dialog; `DropdownMenu` anchors to a trigger, so a global destination
	 * reads as a context action. The guard locks that none of these is used. The container is a named
	 * capability (`NavigationDrawer`) whose geometry callers cannot choose.
	 */
	it("the drawer is a NavigationDrawer, neither a sheet nor a dialog", () => {
		const sidebar = fileAt("features/shell/app-sidebar.tsx");
		expect(sidebar).toContain("<NavigationDrawer");
		expect(sidebar).toMatch(
			/import\s*\{[^}]*\bNavigationDrawer\b[^}]*\}\s*from\s*["']@rowcat\/ui-native["']/,
		);
		expect(sidebar).not.toMatch(/\bSheet\b/);
		expect(sidebar).not.toContain("<Dialog");
		expect(sidebar).not.toContain("<AlertDialog");
		expect(sidebar).not.toContain("<DropdownMenu");
		/** The screen does not measure geometry; width, placement and motion belong to the capability. */
		expect(sidebar).not.toMatch(/useWindowDimensions|Dimensions\.get/);
		expect(sidebar).not.toContain("placement=");
	});

	/**
	 * The drawer is not a route; the conversation list still is. `/chats` must be addressable:
	 * deleting a room leaves to it, and login returns to it. The drawer is the opposite: as a route it
	 * would pile the navigation surface itself into back history and let a deep link arrive with the
	 * drawer open.
	 */
	it("the drawer isn't a screen and the conversation list is a screen", () => {
		const sidebar = fileAt("features/shell/app-sidebar.tsx");
		expect(sidebar).not.toContain("<Screen");
		expect(sidebar).not.toContain("<FlatList");
		expect(() =>
			fileAt("features/chat-library/chat-library-screen.tsx"),
		).not.toThrow();
	});

	/**
	 * Recent-conversation rows are not virtualized. The cap is ten rows (`SIDEBAR_RECENT_CHAT_LIMIT`
	 * in `@rowcat/chat`), so virtualization is not needed, and the surface needs one scroll owner: a
	 * `FlatList` inside a `ScrollView` gives the outside infinite height and switches virtualization
	 * off entirely. Scrolling inside the drawer belongs to the capability.
	 */
	it("doesn't create a second scroll owner inside the drawer", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/shell/")) continue;
			expect(file.text, file.path).not.toContain("<ScrollView");
			expect(file.text, file.path).not.toContain("<FlatList");
		}
	});

	/**
	 * The trigger sits in the header's navigation slot. In `actions` (the right side) global
	 * navigation would read as part of this screen's actions, and people learn positions, so its
	 * meaning would drift per screen. `AppBar`'s `navigation` slot is the place, beside Back: they
	 * answer different questions (where can I go vs where did I come from).
	 *
	 * The list shrank: `/chats` is now a root screen that shows the bottom primary nav, so it has no
	 * trigger. The global-navigation surface is one per screen (see the group below). The screens that
	 * keep the trigger do not show that nav, so the trigger is their only global navigation.
	 */
	it("the trigger stands in the header's navigation slot", () => {
		for (const path of [
			"features/chat/chat-screen.tsx",
			/** Runtime playback follows the same convention as a chat room: drawer trigger and Back side by side. */
			"features/runtime-player/runtime-chat-screen.tsx",
			"features/story/story-detail-screen.tsx",
		])
			expect(fileAt(path), path).toContain(
				"navigation={<AppSidebarTrigger />}",
			);

		/** The chat screen shows those four in one row, not folded into an overflow menu. */
		const chat = fileAt("features/chat/chat-screen.tsx");
		expect(chat).toContain('icon="search"');
		expect(chat).toContain('icon="room-settings"');
		expect(chat).not.toContain("<DropdownMenu");
	});
});

/**
 * Only one global-navigation surface per screen. If the drawer and the bottom nav appear on the
 * same screen, the same three destinations get two routes that soon behave differently (one pushes,
 * one navigates). Types cannot catch this; it lives only in which screen mounts what, so it is
 * locked by value here.
 */
describe("one global navigation surface at a time", () => {
	/** The three primary-destination roots: they show the bottom nav and so have no trigger. */
	const ROOTS = [
		"features/discover/discover-screen.tsx",
		"features/chat-library/chat-library-screen.tsx",
		"features/create/create-screen.tsx",
	];

	it("the three root screens stand the bottom row", () => {
		for (const path of ROOTS)
			expect(fileAt(path), path).toContain("<PrimaryNav />");
	});

	it("those three have no drawer trigger", () => {
		for (const path of ROOTS)
			expect(fileAt(path), path).not.toContain("AppSidebarTrigger");
	});

	/**
	 * Check the opposite direction too. Locking only one side lets a change that adds a bottom nav to
	 * another screen pass silently. Conversation rooms, the draft editor and work detail already use
	 * the bottom (the input bar, the keyboard, the comment composer).
	 */
	it("other screens don't stand the bottom row", () => {
		const owners = productSurface
			.filter((file) => /<PrimaryNav\s*\/>/.test(file.text))
			.map((file) => file.path);
		expect([...owners].sort()).toEqual([...ROOTS].sort());
	});

	/**
	 * One file draws the row. Screens that build their own row each drift: one gains an item, another
	 * misses the active check (the drawer follows the same rule for the same reason).
	 */
	it("one file defines the row", () => {
		const definitions = product
			.filter((file) => /export function PrimaryNav/.test(file.text))
			.map((file) => file.path);
		expect(definitions).toEqual(["features/shell/primary-nav.tsx"]);
	});

	/**
	 * Current location comes from the route. If the screen passed the active slot down as a prop, each
	 * new screen would need the row rewritten, and missing one screen would silently disable
	 * highlighting there.
	 */
	it("derives the active cell from the route", () => {
		const nav = fileAt("features/shell/primary-nav.tsx");
		expect(nav).toContain("mobilePrimaryDestination(pathname)");
		expect(nav).not.toMatch(/useState|startsWith\s*\(/);
	});
});

describe("account security containers", () => {
	/**
	 * Single-field forms are `Dialog`s. A gesture that rises from the bottom adds nothing, and the
	 * screen behind (current address, current name) is better left visible. The axis is the
	 * interaction's character, not the platform.
	 */
	it("email change, password and passkey name are Dialogs", () => {
		for (const path of [
			"features/account/email-change-dialog.tsx",
			"features/account/password-dialog.tsx",
		]) {
			expect(fileAt(path), path).toContain("<Dialog");
			expect(fileAt(path), path).not.toContain("<AlertDialog");
		}

		const passkeys = fileAt("features/account/passkey-dialogs.tsx");
		expect(passkeys).toContain("<Dialog");
		/** The delete confirmation shares this file; only that one is an alert dialog. */
		expect(passkeys.match(/<AlertDialog/g)).toHaveLength(1);
	});

	/**
	 * The photo crop is a `Dialog` that fills the screen. Its content is one square viewport and a few
	 * buttons, so `compact` might seem to fit, but this surface is drawn with a finger and gets less
	 * precise as it shrinks: on a 320pt screen a `compact` box leaves the viewport under 200pt.
	 *
	 * It is not a sheet, since rising from the bottom adds nothing here. The dialog replaces a
	 * rejection, and the screen behind has no reason to stay visible (it fills the screen).
	 *
	 * It is not an irreversible confirmation either: cancelling does nothing, and an unsatisfying crop
	 * can simply be redone.
	 */
	it("photo cropping is a Dialog that fills the surface", () => {
		const crop = fileAt("features/account/avatar-crop-dialog.tsx");
		expect(crop).toContain("<Dialog");
		expect(crop).toContain('size="full"');
		expect(crop).not.toContain("<AlertDialog");
		/**
		 * Scrolling is off. The viewport takes its height from its parent, so if the outside scrolled it
		 * would get infinite height and **disappear from the screen**. The dialog still opens and its
		 * header still draws, with no error.
		 */
		expect(crop).toContain("scroll={false}");
	});

	/**
	 * The representative-work picker is a `Dialog` that docks to the bottom. Its content is a list of
	 * unknown length, so it is not a `ChoiceSheet` (which suits short choices with known options).
	 * Picking closes the dialog and is not irreversible; saving happens from the account screen's
	 * button.
	 */
	it("choosing pinned works is a Dialog", () => {
		const picker = fileAt("features/account/pinned-story-picker-dialog.tsx");
		expect(picker).toContain("<Dialog");
		expect(picker).toContain('placement="adaptive"');
		expect(picker).not.toContain("<AlertDialog");
	});

	/**
	 * Irreversible confirmations are `AlertDialog`s. Removing a login method and deleting a passkey
	 * reduce future access, and "sign out all other devices" ends several sessions at once.
	 */
	it("destructive confirmations are AlertDialogs", () => {
		for (const path of [
			"features/account/disconnect-method-dialog.tsx",
			"features/account/revoke-others-dialog.tsx",
		]) {
			expect(fileAt(path), path).toContain("<AlertDialog");
			expect(fileAt(path), path).not.toContain("<Dialog");
		}
	});

	/**
	 * No imperative system alerts. This section's confirmation copy usually states counts and lists
	 * (remaining methods, devices to be signed out), and `Alert.alert` freezes the wording when shown,
	 * so it cannot reflect changes in between.
	 */
	it("doesn't use system alerts", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/account/")) continue;
			expect(file.text, file.path).not.toMatch(/Alert\.alert/);
		}
	});

	/**
	 * The security section has no sheets or overflow menus. Its actions are always-visible buttons, so
	 * there is no trigger group to hang them from, and no interaction where rising from the bottom
	 * earns its place.
	 */
	it("the security section has neither sheets nor overflow menus", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/account/")) continue;
			expect(file.text, file.path).not.toContain("ChoiceSheet");
			/**
			 * The header's account menu (`account-shortcut.tsx`) is an exception: it is a global utility
			 * tied to a trigger, not an action of this section.
			 */
			if (file.path === "features/account/account-shortcut.tsx") continue;
			expect(file.text, file.path).not.toContain("<DropdownMenu");
		}
	});
});

describe("story test containers", () => {
	/**
	 * Conditions are a dialog; confirmation is an alert dialog, and the two do not overlap. Four
	 * controls plus two session actions below them do not fit a centered box (on devices with a large
	 * text size the bottom is pushed out of view). Not a sheet, because this interaction does not need
	 * rising from the bottom.
	 */
	it("test conditions are a Dialog that fills the surface", () => {
		const dialog = fileAt("features/playtest/playtest-settings-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).toContain('size="full"');
		expect(dialog).not.toMatch(/\bSheet\b/);
	});

	/**
	 * No stacking dialogs on a face. The confirmation belongs to the screen, and the settings dialog
	 * closes before the screen opens it; two layers would make Android back's target unpredictable
	 * (the memory panel confirms inline for the same reason).
	 */
	it("confirmation belongs to the screen and isn't inside the settings window", () => {
		expect(
			fileAt("features/playtest/playtest-settings-dialog.tsx"),
		).not.toContain("<AlertDialog");
		expect(fileAt("features/playtest/playtest-screen.tsx")).toContain(
			"<AlertDialog",
		);
	});

	/** Picking a value is a `Select` tied to a trigger, the same container as room settings. */
	it("choosing conditions is a Select", () => {
		const dialog = fileAt("features/playtest/playtest-settings-dialog.tsx");
		expect(dialog).toContain("<Select");
		expect(dialog).not.toContain("<ChoiceSheet");
		expect(dialog).not.toContain("<DropdownMenu");
	});

	/**
	 * No overflow menu in the header. This screen's only action is the conditions dialog, and a `⋯`
	 * beside it would put two doors for the same test twenty points apart (the chat screen dropped
	 * that menu for the same reason).
	 */
	it("the header opens only the condition window", () => {
		const screen = fileAt("features/playtest/playtest-screen.tsx");
		expect(screen).toContain('icon="playtest-settings"');
		expect(screen).not.toContain("<DropdownMenu");
		expect(screen).toContain("navigation={<AppSidebarTrigger />}");
	});

	/**
	 * The row has one action: copy. The other four need a storage transaction or a server-known
	 * identity, and this screen has neither. Actions that cannot apply are not drawn disabled.
	 */
	it("rows get no overflow menu", () => {
		const screen = fileAt("features/playtest/playtest-screen.tsx");
		expect(screen).toContain("<MessageActionBar");
		expect(screen).toContain("menu={null}");
	});
});

describe("settings containers", () => {
	/**
	 * Settings itself is a route. It is not a dialog, a sheet, or a drawer row: each of the three
	 * categories has its own address. It must be addressable: the gear pushes here, login returns to
	 * this path, and the next slice's guidance will point here. None of that fits a layer.
	 */
	it("the settings screen stands as a route, not a layer", () => {
		const screen = fileAt("features/settings/settings-shell.tsx");
		expect(screen).toContain("<Screen>");
		expect(screen).toContain("<AppBar");
		expect(screen).not.toContain("<Dialog");
		expect(screen).not.toContain("ChoiceSheet");
		expect(screen).not.toContain("NavigationDrawer");
	});

	/**
	 * The category list is not a floating layer either. A trigger-bound `Select` would fold it, so
	 * seeing what is inside would take a tap, and in a list of three that exchange earns nothing.
	 */
	it("the category row is spread out", () => {
		const nav = fileAt("features/settings/settings-navigation.tsx");
		expect(nav).not.toContain("<Select");
		expect(nav).not.toContain("ChoiceSheet");
		expect(nav).not.toContain("<DropdownMenu");
	});

	/**
	 * Brightness is a `Select`, the same container as the web's row.
	 *
	 * This check once locked the opposite (a `<ChoiceGroup` present and no `<Select`), on the
	 * reasoning that three values are better left expanded. That sentence was written without looking
	 * at the web's same setting, which draws the three values as one closed trigger, so the check was
	 * guarding a divergence.
	 *
	 * The rule that the screen does not fold it into a `ChoiceSheet` still holds; that capability
	 * belongs to the header trigger alone (see the check below).
	 */
	it("choosing brightness is a Select", () => {
		const section = fileAt("features/settings/appearance-section.tsx");
		expect(section).toContain("<Select");
		expect(section).not.toContain("<ChoiceGroup");
		expect(section).not.toContain("ChoiceSheet");
	});

	/**
	 * Only the guest's brightness trigger is a sheet. It is a short single choice with three values,
	 * which fits the capability's definition exactly, and the header has no place to expand it.
	 */
	it("the header's brightness trigger is a ChoiceSheet", () => {
		const shortcut = fileAt("features/settings/appearance-shortcut.tsx");
		expect(shortcut).toContain("<ChoiceSheet");
		expect(shortcut).not.toContain("<Dialog");
		expect(shortcut).not.toContain("<DropdownMenu");
	});

	/** Single-field forms are `Dialog`s: one colour editor, two persona forms. */
	it("the color editor and persona form are Dialogs", () => {
		for (const path of [
			"features/settings/theme-color-dialog.tsx",
			"features/persona/persona-form-dialog.tsx",
		]) {
			expect(fileAt(path), path).toContain("<Dialog");
			expect(fileAt(path), path).not.toContain("<AlertDialog");
			expect(fileAt(path), path).not.toContain('size="full"');
		}
	});

	/**
	 * Irreversible confirmations are `AlertDialog`s: local data reset and persona deletion. Their copy
	 * states counts and names, so the imperative `Alert.alert` is not used; it freezes the wording
	 * when shown.
	 */
	it("destructive confirmations are AlertDialogs", () => {
		for (const path of [
			"features/settings/local-data-section.tsx",
			"features/persona/persona-library-section.tsx",
		]) {
			expect(fileAt(path), path).toContain("<AlertDialog");
			expect(fileAt(path), path).not.toContain("Alert.alert");
		}
	});

	/** Picking a value is a `Select` tied to a trigger, the same container as room settings. */
	it("generation defaults are Selects", () => {
		const defaults = fileAt(
			"features/settings/generation-defaults-section.tsx",
		);
		expect(defaults).toContain("<Select");
		expect(defaults).not.toContain("ChoiceSheet");
		expect(defaults).not.toContain("<DropdownMenu");
	});

	/**
	 * The persona library row has no overflow menu. Its two actions are always-visible buttons, so
	 * there is no trigger group to hang them from. No swipe-delete or long-press-only action either:
	 * touch has no hover, and an action only gesture-aware users can find is an action that does not
	 * exist.
	 */
	it("persona rows have neither overflow nor swipe", () => {
		const section = fileAt("features/persona/persona-library-section.tsx");
		expect(section).not.toContain("<DropdownMenu");
		expect(section).not.toContain("onLongPress");
		expect(section).not.toContain("Swipeable");
	});
});

describe("adult eligibility verification containers", () => {
	/**
	 * The verifier's window is a full-screen `Dialog` with scrolling off. The first reason is
	 * geometry: the carrier's authentication screen scrolls within itself and brings up the keyboard,
	 * so it does not fit a centered box. The second is a trap this slice actually hit: if the outside
	 * scrolls, the webview receives infinite height and **disappears from the screen at height 0**
	 * (the window still opens and its header still draws, so no error appears).
	 *
	 * Not a sheet, because this interaction does not need rising from the bottom. Not a route, because
	 * this flow is a temporary one attached to this account screen; an address would leave a place to
	 * return to after verification ends.
	 */
	it("the verification authority's surface is a full Dialog without scrolling", () => {
		const surface = fileAt(
			"features/adult-verification/adult-verification-surface.tsx",
		);
		expect(surface).toContain("<Dialog");
		expect(surface).toContain('size="full"');
		expect(surface).toContain("scroll={false}");
		expect(surface).not.toMatch(/\bSheet\b/);
		expect(surface).not.toContain("<AlertDialog");
		/** The webview is not wrapped in a `ScrollView`, for the reason above. */
		expect(surface).not.toContain("<ScrollView");
	});

	/**
	 * Closing is cancel. Android back, the screen-reader escape and the close button all come from the
	 * primitive and arrive as `onOpenChange(false)`. The rule above, that feature code does not build
	 * the layer with `BackHandler`, applies here too.
	 */
	it("closing the surface goes to cancellation", () => {
		const surface = fileAt(
			"features/adult-verification/adult-verification-surface.tsx",
		);
		expect(surface).toMatch(
			/onOpenChange=\{\(open\) => \{\s*if \(!open\) onDismissed\(\);/,
		);
	});

	/**
	 * The confirmation before enabling adult content is a declarative `AlertDialog`. `Alert.alert` is
	 * not used, for the same reason as the other confirmations on this screen: it freezes the wording
	 * when shown, and the primitive provides Android back, the screen-reader escape and focus movement
	 * where the imperative alert does not. Turning the setting off has no confirmation; a
	 * safe-direction action should not carry friction.
	 */
	it("the confirmation before turning display on is an AlertDialog", () => {
		const control = fileAt("features/account/adult-visibility-control.tsx");
		expect(control).toContain("<AlertDialog");
		expect(control).not.toContain("Alert.alert");
		expect(control).not.toContain("ChoiceSheet");
		expect(control).not.toContain("<DropdownMenu");
	});
});

describe("long-form authoring field containers", () => {
	/**
	 * Full-screen editing is a `Dialog size="full"` with scrolling off. The size is the "long form"
	 * cell of the containers table. Not a sheet, because this interaction does not need rising from
	 * the bottom. Not a route, because this is a temporary slot attached to the current draft: an
	 * address would leave a place to return to after the draft is deleted (the work-test conditions
	 * dialog and the verifier surface made the same call).
	 *
	 * `scroll={false}` is the silent trap here. If the outside scrolls, the inner field receives
	 * infinite height and `growth="fill"` **disappears from the screen at height 0**. The dialog still
	 * opens and its header still draws, so no error appears.
	 */
	it("full-screen editing is a full Dialog without scrolling", () => {
		const prompt = fileAt("features/create/prompt-section.tsx");
		expect(prompt).toContain("<Dialog");
		expect(prompt).toContain('size="full"');
		expect(prompt).toContain("scroll={false}");
		expect(prompt).not.toMatch(/\bSheet\b/);
		expect(prompt).not.toContain("<AlertDialog");
		/** No second scroll container inside the dialog; the field itself is what scrolls. */
		expect(prompt).not.toContain("<ScrollView");
	});

	/**
	 * Inline fields grow and then stop. Without this rule the field had only `minHeight` and no upper
	 * bound, so a long prompt made one box dozens of times the screen's height, and what was lost was
	 * the content above and below it. Not measuring the cap from the screen is part of the same rule:
	 * device geometry is the container's axis, and only one feature file in this app reads window
	 * height (see the test "one feature file reads window geometry" above).
	 */
	it("inline fields have a cap and the screen doesn't measure that cap", () => {
		const prompt = fileAt("features/create/prompt-section.tsx");
		expect(prompt).toContain('growth="capped"');
		expect(prompt).not.toMatch(/maxHeight:/);
		expect(prompt).not.toMatch(/minHeight:/);
	});

	/**
	 * This is not solved by collapsing the section. The prompt section is always expanded
	 * (`EditorSection`'s `summary` is the switch); collapsing it would make this work's body read as
	 * optional. It also adds no up-and-down control: that would layer a control over the symptom and
	 * leave the cause, which was that the field never stopped growing, in place.
	 */
	it("doesn't fold the prompt section", () => {
		const editor = fileAt("features/create/draft-editor-screen.tsx");
		expect(editor).toMatch(
			/title=\{SECTION\.prompt\.title\}[\s\S]{0,900}<PromptSectionBody/,
		);
		expect(editor).not.toMatch(
			/title=\{SECTION\.prompt\.title\}[\s\S]{0,240}summary=/,
		);
	});
});
