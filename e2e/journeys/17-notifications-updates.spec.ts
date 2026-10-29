import type { Locator, Page } from "@playwright/test";
import { updateNotesFor } from "../../packages/domain/src/update-note.ts";
import {
	createAccount,
	expect,
	newAccount,
	test,
} from "../support/fixtures.ts";

/**
 * Journey 17: the two slots of notifications, the inbox and the update notices.
 *
 * The notifications screen and the header bell combine two domains: the inbox, owned by the server,
 * and the release history, which the repo ships and this device has read. Whether that combination
 * is wired correctly spans several components, so value tests cannot express it. The structure is:
 * - Shell route, UpdateNotesProvider: holds the read fact and the dialog.
 * - NotificationBell: the bell marker and the popover's two slots.
 * - NotificationsPage: the screen's two slots. The read fact's owner sits above both surfaces,
 *   and the dialog belongs to that owner.
 *
 * Failures that only show in a browser:
 * - The dialog vanishes with the popover. Pressing a row closes the popover, and a dialog inside
 *   its tree unmounts in the same frame.
 * - The marker turns off in one place only, if the read fact has two owners. The popover row
 *   clears while the bell stays lit until a reload.
 * - `See all updates` falls back to `General` if the address has no pane slot, so the link has nowhere to
 *   land.
 * - Skimming a row marks it read. Viewing and opening must stay separate, and that separation
 *   lives in the storage the browser owns.
 *
 * The layers below already cover these rules, so this journey does not count them again: history
 * order and surface filtering, monotonic recording, count and dot priority, address serialization,
 * and domain boundaries. Those tests live in packages/domain/src/update-note.test.ts,
 * features/updates/seen-store.test.ts, packages/domain/src/notification-attention.test.ts,
 * features/notifications/notifications-surface.test.ts and
 * features/updates/updates-boundaries.test.ts.
 *
 * Update notes are content the repo ships, so nothing is seeded. The journey relies on two
 * conditions that a fresh browser context gives for free: no read record (localStorage is empty)
 * and no unread notification (nobody has acted on a new account). Together they make the bell show
 * a dot, since a count beats a dot. That is why each run creates a new account, and why server
 * notifications are neither created nor deleted.
 */

/**
 * The first two entries are derived from the registry, not written as date literals. An earlier
 * version used literals, and a commit adding one release note (fine by itself) broke this journey.
 * The symptom was 'the newest row has no new marker', and nothing pointed at this file. The journey
 * checks that the newest entry carries the marker and the next one does not. The dates are
 * irrelevant, so the currently deployed history answers the question.
 *
 * If the history has fewer than two entries, the public build ships no releases (releases/ is
 * empty). The three checks that need two entries then skip, and the empty-history journey at the
 * end checks that the empty list still renders. Throwing at module load would take the file's other
 * journeys down too. A fork that ships two or more releases gets all three back automatically.
 *
 * @rowcat/domain is not imported by name, because e2e/ is not a workspace package and the name does
 * not resolve. The module imports only the generated registry by relative path, so the journey does
 * not carry the whole domain graph.
 */
const WEB_NOTES = updateNotesFor("web");
const [latestNote, olderNote] = WEB_NOTES;
const HISTORY_SKIP_REASON =
	"the web surface has fewer than two notes — the history journeys have nothing to ask";
const hasHistory = latestNote !== undefined && olderNote !== undefined;
const LATEST = latestNote?.title ?? "";
const OLDER = olderNote?.title ?? "";
/**
 * The value written to the record is the identity (id), not the title. It uses the same string as
 * releasedAt.
 */
const LATEST_ID = latestNote?.id ?? "";
const OLDER_ID = olderNote?.id ?? "";

/**
 * The tail added to a name to signal something new. It has the same characters as the shared
 * constant in @rowcat/domain.
 */
const UNSEEN = "new update available";

/** Where the read fact is kept. This is a device-level value, not a member id. */
const SEEN_KEY = "rowcat.updates.lastSeen";

/**
 * The header bell. Its name states the state, so it is matched by prefix only. Matching the full
 * name would let the locator catch the exact state change this journey checks (the tail appearing
 * and disappearing), and a failure would read as 'bell not found'.
 */
const bell = (page: Page): Locator =>
	page.getByRole("button", { name: /^Notifications/ });

/**
 * Identifies which surface a tab or row belongs to. Both surfaces use the same vocabulary, which is
 * the point of this slice, so unscoped locators become ambiguous. For example, pressing `See all
 * updates` in the popover makes the notifications screen select its own `Updates` tab, while the popover is
 * still mounted (it is animating out). A page-wide search for the `Updates` tab then matches two, and
 * the failure depends on timing.
 *
 * So the root is passed in: the full-screen tabs use canvas(page), and the popover's tabs use the
 * whole page as their root (the popover-opening screen has no other tab bar).
 */
type Root = Page | Locator;

/**
 * The canvas, where the notifications screen lays out its tabs. The popover lives outside it (it is
 * a portal).
 */
const canvas = (page: Page): Locator => page.getByRole("main");

const tab = (root: Root, name: RegExp): Locator =>
	root.getByRole("tab", { name });

const generalTab = (root: Root) => tab(root, /^General$/);
const updatesTab = (root: Root) => tab(root, /^Updates/);

/**
 * A history row. The title is the identity, so it is matched by prefix; the tail is added and
 * removed with the state.
 */
const noteRow = (root: Root, title: string): Locator =>
	root.getByRole("button", {
		name: new RegExp(`^${title.replace(/\./g, "\\.")}`),
	});

/**
 * Waits until the element can be pressed, using an observable signal instead of time.
 *
 * The shell comes from the server, so the bell and history rows are visible and pressable as soon
 * as the document arrives. React's handlers are not attached at that point. Playwright's
 * actionability checks cannot see that gap, so a click does nothing silently.
 *
 * The signal chosen is the UNSEEN tail appearing on the bell. The read fact lives in localStorage,
 * and reading it is an effect of the component. So the tail appearing means the tree has hydrated
 * and its effects have run. waitForTimeout is not used: it breaks on slow machines, and nobody
 * knows how long to wait.
 *
 * The wait is not written as a retry-click loop. The bell is a toggle, so after the first click has
 * succeeded, a retry closes the box again.
 *
 * The timeout is 30 seconds, longer than the default 10, because of the first compile on the dev
 * server. This journey's web app runs vite dev, which transforms modules when they are requested.
 * Right after a source edit, the first page cannot hydrate until that finishes. If the wait ends
 * inside that window, the failure reads as 'no dot on the bell', which looks like this slice's bug.
 */
const settled = async (page: Page): Promise<void> => {
	await expect(bell(page)).toHaveAccessibleName(new RegExp(UNSEEN), {
		timeout: 30_000,
	});
};

/**
 * Opens a row, checks that the dialog belongs to that release, then closes it. Wrapping this in a
 * helper is not an exception to the keep-helpers-minimal rule. What is wrapped is a round trip
 * unrelated to the journey's subject (open, verify, close). What is being verified stays at the
 * call sites: which row is opened, and what the record does afterward.
 */
const openNote = async (
	page: Page,
	root: Root,
	title: string,
): Promise<void> => {
	await noteRow(root, title).click();
	await expect(
		page.getByRole("heading", { name: title, exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "OK" }).click();
	await expect(
		page.getByRole("heading", { name: title, exact: true }),
	).toHaveCount(0);
};

const seenId = (page: Page): Promise<string | null> =>
	page.evaluate((key) => localStorage.getItem(key), SEEN_KEY);

const expectSelected = async (locator: Locator, selected: boolean) => {
	await expect(locator).toHaveAttribute("aria-selected", String(selected));
};

test("opening a note from the bell outlives the popover, and the seen fact spreads without a refresh", async ({
	page,
	context,
}) => {
	test.skip(!hasHistory, HISTORY_SKIP_REASON);
	const account = newAccount("updates");
	await createAccount(context, account);

	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Discover" })).toBeVisible();

	/**
	 * Checks the precondition by value first. If either part fails, every assertion below fails as 'no
	 * dot', which looks like a defect in this slice. What actually happened is that this browser
	 * already read the notice, or the account has a notification.
	 */
	expect(await seenId(page)).toBeNull();

	/**
	 * The count must be absent for the dot to show. An unread notification would win (a count beats a
	 * dot) and make the marker assertion meaningless. The precondition is checked by confirming that
	 * no count appears in the bell's name.
	 */
	await expect(bell(page)).not.toHaveAccessibleName(/unread/);

	/**
	 * A new notice reaches the bell. The dot is aria-hidden and not in the accessibility tree, so the
	 * fact is carried as text in the name. This assertion is therefore the accessibility check itself.
	 * The same fact is also the hydration signal, so it passes through the same gate (settled).
	 */
	await settled(page);

	await bell(page).click();

	/**
	 * The box's information architecture matches the full screen. Both panes use the same vocabulary
	 * in the same order, and the default is always `General`. If a new notice switched the pane, the dot
	 * would act as an interception rather than an indicator.
	 */
	await expect(generalTab(page)).toBeVisible();
	await expectSelected(generalTab(page), true);
	await expectSelected(updatesTab(page), false);

	/** Pressing the bell alone does not read anything. */
	expect(await seenId(page)).toBeNull();
	await expect(updatesTab(page)).toHaveAccessibleName(new RegExp(UNSEEN));

	/* Selecting a pane does not count as reading either. */

	await updatesTab(page).click();
	await expectSelected(updatesTab(page), true);

	/**
	 * Shows the whole history, not just the latest entry. Once releases accumulate, a single-row entry
	 * point would mean older ones can't be seen. This preview renders both.
	 */
	await expect(noteRow(page, LATEST)).toBeVisible();
	await expect(noteRow(page, OLDER)).toBeVisible();

	/**
	 * Being visible does not count as reading either. The row carrying the marker is still the single
	 * latest, and the record is still empty. A person who only skimmed must still leave the marker in
	 * place.
	 */
	await expect(noteRow(page, LATEST)).toHaveAccessibleName(new RegExp(UNSEEN));
	await expect(noteRow(page, OLDER)).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	expect(await seenId(page)).toBeNull();

	await noteRow(page, LATEST).click();

	/**
	 * This is the journey's key assertion.
	 *
	 * Pressing a row closes the popover. If the dialog sits inside the popover's tree, it unmounts in
	 * the same frame, so the person sees only the box vanish. The owner of the dialog is therefore the
	 * shell's provider (UpdateNotesProvider). That is observed by whether the dialog still exists
	 * after the popover has actually gone.
	 *
	 * The order is part of the rule: wait for the popover to disappear first, then look for the
	 * dialog. Reversed, the check would run while the popover is still closing, and it would pass even
	 * when the dialog sits inside that tree.
	 */
	await expect(page.getByRole("tab", { name: /^General$/ })).toHaveCount(0);
	await expect(
		page.getByRole("heading", { name: LATEST, exact: true }),
	).toBeVisible();

	/**
	 * The pressed row opens. This pairs with the fact that it is not always the latest entry that
	 * opens.
	 */
	await expect(
		page.getByRole("heading", { name: OLDER, exact: true }),
	).toHaveCount(0);

	/** Opening is the moment the read is recorded. Closing writes nothing. */
	expect(await seenId(page)).toBe(LATEST_ID);

	/**
	 * Not reloading is the whole point of this section. If each place had its own owner for the read
	 * fact, a reload would make them all read the same value and hide the defect. What this checks is
	 * that, within one session, a single layer moves all four together.
	 */
	await page.getByRole("button", { name: "OK" }).click();
	await expect(
		page.getByRole("heading", { name: LATEST, exact: true }),
	).toHaveCount(0);

	await expect(bell(page)).not.toHaveAccessibleName(new RegExp(UNSEEN));

	await bell(page).click();
	await expect(updatesTab(page)).not.toHaveAccessibleName(new RegExp(UNSEEN));
	await updatesTab(page).click();

	/**
	 * The history stays usable once the marker is off. No marker means nothing new, not that the
	 * entries can't be read.
	 */
	await expect(noteRow(page, LATEST)).toBeVisible();
	await expect(noteRow(page, LATEST)).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(noteRow(page, OLDER)).toBeVisible();
});

test("`See all updates` lands on that tab, and `/notifications` defaults to `General`", async ({
	page,
	context,
}) => {
	test.skip(!hasHistory, HISTORY_SKIP_REASON);
	const account = newAccount("updates-nav");
	await createAccount(context, account);

	await page.goto("/");
	await settled(page);

	await bell(page).click();
	await updatesTab(page).click();

	/**
	 * This is the whole reason the link carries `?tab`. Without the pane in the address, the link
	 * falls back to `General`, and the person has to find what they were looking at again.
	 */
	await page.getByRole("link", { name: "See all updates" }).click();
	await page.waitForURL(/\/notifications/);

	/**
	 * Asserts what the user sees first. Even with the right address, the link is broken if the screen
	 * draws a different pane. The address is checked afterwards.
	 */
	await expect(
		page.getByRole("heading", { name: "Notifications", level: 1 }),
	).toBeVisible();
	await expectSelected(updatesTab(canvas(page)), true);
	await expect(noteRow(canvas(page), LATEST)).toBeVisible();
	expect(new URL(page.url()).search).toBe("?tab=updates");

	await page.goto("/notifications");
	await settled(page);
	await expectSelected(generalTab(canvas(page)), true);
	await expectSelected(updatesTab(canvas(page)), false);

	/**
	 * Selecting a pane is recorded in history (not replaced), so back returns to the original pane.
	 * The default value is dropped from the address: keeping `?tab=general` would give the same screen
	 * two addresses.
	 */
	await updatesTab(canvas(page)).click();
	await expect.poll(() => new URL(page.url()).search).toBe("?tab=updates");
	await page.goBack();
	await expect.poll(() => new URL(page.url()).search).toBe("");
	await expectSelected(generalTab(canvas(page)), true);

	/**
	 * An unknown value folds to the default pane. If one hand-edited character in the address turned
	 * the inbox into an error screen, the person would read their notifications as gone, even though
	 * they are still on the server.
	 */
	await page.goto("/notifications?tab=garbage");
	await expect(
		page.getByRole("heading", { name: "Notifications", level: 1 }),
	).toBeVisible();
	await expectSelected(generalTab(canvas(page)), true);
});

test("pressing an older history row opens that release, and the record does not go backwards", async ({
	page,
	context,
}) => {
	test.skip(!hasHistory, HISTORY_SKIP_REASON);
	const account = newAccount("updates-history");
	await createAccount(context, account);

	/**
	 * Enters directly on a pane. This journey checks whether the history opens individual releases;
	 * getting there is already covered by the journey above.
	 */
	await page.goto("/notifications?tab=updates");
	await settled(page);
	await expectSelected(updatesTab(canvas(page)), true);
	expect(await seenId(page)).toBeNull();

	/**
	 * Presses a lower row. The history exists so past releases can be opened one by one, so a test
	 * where any row opens the latest must not pass.
	 */
	await openNote(page, canvas(page), OLDER);

	/**
	 * Reading an older release does not mean the latest was read. The record only moves forward (it
	 * was empty, so the date is written) but has not reached the latest, so the marker stays in all
	 * three places.
	 */
	expect(await seenId(page)).toBe(OLDER_ID);
	await expect(updatesTab(canvas(page))).toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(noteRow(canvas(page), LATEST)).toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(bell(page)).toHaveAccessibleName(new RegExp(UNSEEN));

	await openNote(page, canvas(page), LATEST);
	expect(await seenId(page)).toBe(LATEST_ID);
	await expect(updatesTab(canvas(page))).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);

	/**
	 * Records do not move backward. This is the journey's second key assertion.
	 *
	 * Reopening an older row became an ordinary operation once the history existed. If that operation
	 * rolled the record back, a latest notice already read would reappear as unread. In the other
	 * direction, if an unread latest were marked as seen by opening an older row, that person would
	 * never be told about that release.
	 *
	 * The rule itself is a pure function (mergeSeenUpdateNoteId). Only a browser can confirm that both
	 * the write path and the screen-update path go through it. If only one does, the storage is
	 * correct while the dot on screen comes back.
	 */
	await openNote(page, canvas(page), OLDER);
	expect(await seenId(page)).toBe(LATEST_ID);
	await expect(updatesTab(canvas(page))).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(noteRow(canvas(page), LATEST)).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(bell(page)).not.toHaveAccessibleName(new RegExp(UNSEEN));
});

/**
 * An empty history is also a state. In a build that ships no releases (the public build), the pane
 * still appears with one placeholder fact row, and no new marker appears anywhere. Calling a
 * nonexistent notice 'new' would leave the bell's dot permanently on, since there is no row to read
 * it from.
 *
 * No separate hydration signal is awaited. 'No marker' is the same answer on the first
 * server-rendered screen and after effects run, because an empty registry has nothing new whatever
 * the record says.
 */
test("an empty history still shows the tab with one empty-state line and no marker anywhere", async ({
	page,
	context,
}) => {
	test.skip(
		WEB_NOTES.length > 0,
		"the web surface has notes — the history journeys above cover it",
	);
	const account = newAccount("updates-empty");
	await createAccount(context, account);

	await page.goto("/notifications?tab=updates");
	await expect(
		page.getByRole("heading", { name: "Notifications", level: 1 }),
	).toBeVisible();
	await expectSelected(updatesTab(canvas(page)), true);
	await expect(canvas(page).getByText("No update notes yet.")).toBeVisible();

	await expect(updatesTab(canvas(page))).not.toHaveAccessibleName(
		new RegExp(UNSEEN),
	);
	await expect(bell(page)).not.toHaveAccessibleName(new RegExp(UNSEEN));
	expect(await seenId(page)).toBeNull();
});
