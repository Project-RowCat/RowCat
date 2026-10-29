import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { notifications as copy } from "#/lib/i18n/messages/en/notifications.ts";

/**
 * Do the two notification surfaces state the same facts for the same cache state? This is checked
 * statically, by scanning source. `notificationPanelView()` distinguishes three cases (see
 * notifications-state.test.ts):
 * - A confirmed empty inbox: `empty`, `retryable` false.
 * - A confirmed but possibly stale empty inbox: `empty`, `retryable` true.
 * - A failure with no data: `error`, `retryable` true.
 *
 * That distinction reaches the user only if the screen reads `retryable`. Both surfaces had dropped
 * that axis in the empty state, so the last two cases looked identical on screen. The omission
 * passes both types and rendering without an error, which is why it is locked here.
 *
 * No component is rendered, since the web tests have no React rendering. The test checks which
 * branch reads which axis, and that the screen does not claim facts it never verified. It does not
 * check class names or punctuation.
 */

const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

/**
 * Source with comments stripped, so comments that describe a rule are not judged as violating it.
 */
const codeOf = (name: string): string =>
	read(name)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/**
 * The two surfaces that draw the list: the `General` tab of the notifications page and the header
 * popover.
 *
 * The general-tab list was split out of `notifications-page.tsx`, which is now just a container of
 * two tabs. The five query branches end inside the general tab. If the container knew about them,
 * release history would disappear along with the list whenever the server goes down.
 */
const page = codeOf("general-notifications.tsx");
const copyText = JSON.stringify(copy);
const bell = codeOf("notification-bell.tsx");

const emptyBranchOf = (code: string): string => {
	const start = code.indexOf('panel.state === "empty"');
	const end = code.indexOf('panel.state === "ready"');
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return code.slice(start, end);
};

describe("an empty inbox can be stale too", () => {
	/**
	 * After the server has answered 0, the refresh failed or was aborted. The value is still 0, but
	 * whether it is current is unknown. Dropping this condition would make it indistinguishable from a
	 * freshly confirmed empty inbox.
	 */
	it("the full list's empty state reads `retryable`", () => {
		expect(emptyBranchOf(page)).toContain("panel.retryable");
	});

	it("the popover's empty state reads `retryable` too", () => {
		expect(emptyBranchOf(bell)).toContain("panel.retryable");
	});

	/**
	 * A retry path must come alongside the message. Stating facts with no way out makes the user read
	 * an empty inbox as permanent.
	 */
	it("both surfaces' empty states pass the retry handler", () => {
		expect(emptyBranchOf(page)).toContain("onRetry={retry}");
		expect(emptyBranchOf(bell)).toContain("onRetry={retry}");
	});

	/**
	 * The empty state is not turned into an error. The server really answered 0, and erasing that fact
	 * would make the screen say it does not know a value it does know.
	 */
	it("the empty state's sentence stays", () => {
		expect(emptyBranchOf(page)).toContain('t("empty")');
		expect(emptyBranchOf(bell)).toContain('t("empty")');
	});
});

describe("the screen does not state facts it never confirmed", () => {
	/**
	 * `error` appears only when no held rows exist at all. The screen cannot know how many
	 * notifications exist in that case, so saying anything about held notifications would be a
	 * fabricated fact.
	 */
	it("a first-fetch failure does not claim held notifications", () => {
		expect(copyText).not.toContain("still there");
	});

	/**
	 * The failure strip shown with held data also appears on an empty inbox. There, a message saying
	 * it is showing the previously received notifications contradicts a screen with none to show. So
	 * the strip says `the previous state` instead.
	 */
	it("the staleness notice does not presume rows exist", () => {
		expect(copy.stale).not.toContain("previously received notifications");
		expect(copy.stale).toContain("the previous state");
	});

	/**
	 * The unknown axis is exactly freshness. The phrase `no latest notifications` claims
	 * to know it, so it is not used.
	 */
	it("does not pretend to know freshness", () => {
		expect(copyText).not.toContain("no latest notifications");
	});
});

describe("retry is one path", () => {
	it("neither surface calls `list.refetch()`", () => {
		expect(page).not.toContain("list.refetch");
		expect(bell).not.toContain("list.refetch");
	});
});

describe("`Mark all read` is one container", () => {
	const slot = codeOf("mark-all-read-slot.tsx");

	/**
	 * Both surfaces used to write the same structure separately, so a regression could be guarded on
	 * one side only. Going through one shared container, the same regression surfaces as a missing
	 * import.
	 */
	it("both surfaces draw the same container", () => {
		expect(page).toContain("MarkAllReadSlot");
		expect(bell).toContain("MarkAllReadSlot");
	});

	/**
	 * By the time this button disappears, the unread count is already zero. If a leftover button is
	 * pressed during the exit frame (indefinitely in a hidden tab), an already finished action is sent
	 * again. `disabled={isPending}` does not cover this window, because the exit starts only after the
	 * mutation completes. A change that removed the guard would pass both types and rendering, so it
	 * is locked here (`lib/motion/exit-guard.ts`).
	 */
	it("cannot be pressed while leaving", () => {
		expect(slot).toContain("useExitGuard(");
		expect(slot).toContain("style={exiting}");
	});
});

/**
 * Cuts out one panel of the popover. Whether the two tabs share no actions cannot be verified by
 * scanning the whole file, since both are in the same file.
 */
const popoverPanelOf = (tab: "general" | "updates"): string => {
	const first = bell.indexOf("<TabsContent value={NOTIFICATIONS_TABS[0]}");
	const second = bell.indexOf("<TabsContent value={NOTIFICATIONS_TABS[1]}");
	const end = bell.indexOf("</Tabs>");
	expect(first).toBeGreaterThan(-1);
	expect(second).toBeGreaterThan(first);
	expect(end).toBeGreaterThan(second);
	return tab === "general"
		? bell.slice(first, second)
		: bell.slice(second, end);
};

describe("the popover IA matches the full screen", () => {
	/**
	 * This box used to be an inbox of server notifications only. Meanwhile the bell represented two
	 * things but gave no way to open one of them. When the two surfaces' vocabularies differ, users
	 * learn the same destination as two different structures.
	 */
	it("the popover builds the same two tabs", () => {
		expect(bell).toContain("@rowcat/ui-web/components/tabs");
		for (const part of ["<Tabs", "<TabsList", "<TabsTrigger", "<TabsContent"])
			expect(bell, part).toContain(part);
		expect(bell).toContain('t("general")');
		expect(bell).toContain('t("updates")');
		/** The primitive supplies `role` and the active indicator, so they are not hand-written. */
		expect(bell).not.toMatch(/role="tab"|aria-selected=/);
	});

	it("the default tab is general and notes do not change it", () => {
		expect(bell).toContain(
			"useState<NotificationsTab>(DEFAULT_NOTIFICATIONS_TAB)",
		);
		expect(bell).not.toMatch(/setTab\([^)]*unseen/);
	});

	/**
	 * The popover tab is not an address. If clicking the bell were navigation, merely opening the
	 * popover would add history entries, and back would reopen the popover. This is the opposite of
	 * the full-page tabs, which have an address because one is a destination and the popover is not.
	 */
	it("the popover tab makes no address", () => {
		expect(bell).not.toMatch(/useSearch|useNavigate/);
	});

	/** This is a preview, not an inbox. Both tabs draw only the first few rows. */
	it("the general tab draws only the first few rows", () => {
		const panel = popoverPanelOf("general");
		expect(panel).toContain("GENERAL_POPOVER_LIMIT");
		expect(panel).not.toContain("hasNextPage");
		expect(panel).not.toContain('"showMore"');
	});

	/**
	 * The limit for the announcements tab is set by the list on its own surface axis. If the bell
	 * trimmed it itself, a second path for ordering and filtering would open beside it.
	 */
	it("the updates tab passes the preview surface", () => {
		expect(popoverPanelOf("updates")).toContain('surface="popover"');
	});

	/**
	 * `Mark all read` belongs to the general tab. If it sat in the header, it would remain
	 * visible while the updates tab is shown, describing a list that is not on screen.
	 */
	it("mark all read lives only inside the general tab", () => {
		expect(popoverPanelOf("general")).toContain("MarkAllReadSlot");
		expect(popoverPanelOf("updates")).not.toContain("MarkAllReadSlot");
		expect(popoverPanelOf("updates")).not.toContain('"markAllRead"');
		expect(popoverPanelOf("updates")).not.toContain("markAllRead");
	});

	/**
	 * Announcements have no concept of mark-all-read. Read state is per announcement. A single action
	 * that clears them all would make releases the user never opened count as opened.
	 */
	it("builds no action that marks all notes read", () => {
		expect(bell).not.toMatch(/markAllUpdates|readAllUpdates/);
	});

	/**
	 * The footer link's label differs per tab, and both link to the same tab on the destination page.
	 */
	it("the footer link follows the tab", () => {
		expect(popoverPanelOf("general")).toContain('t("viewAll")');
		expect(popoverPanelOf("updates")).toContain('t("viewAllUpdates")');
		expect(bell).toContain("notificationsSearchForTab");
		/**
		 * Serialization is not written by hand. If the default leaked into the address, the same screen
		 * would have two addresses.
		 */
		expect(bell).not.toContain("?tab=");
	});

	/**
	 * Opening and reading are different actions, in both domains. Opening the popover, selecting a
	 * tab, or seeing an announcement row on screen marks nothing as read. This file has no vocabulary
	 * for recording read state, which is the structural expression of that fact. The record made when
	 * an announcement is opened belongs to the place that actually opens it
	 * (`update-notes-provider.tsx`).
	 */
	it("opening the box marks nothing read", () => {
		expect(bell).not.toMatch(/markSeen|openNote|lastSeen/);
		/** Opening the surface does one thing: it fetches a fresh value for stale data. */
		expect(bell).toContain("refresh()");
		expect(bell).not.toMatch(/markAllRead\.mutate\(\)[^\n]*open/);
	});
});

describe("the bell has two markers that never overlap", () => {
	/**
	 * Priority and label composition live in a shared pure function (`notificationAttention`). If the
	 * screen re-derived the conditions, it could draw a count and a dot together, a state that should
	 * not be representable.
	 */
	it("what is drawn and said comes from one function", () => {
		expect(bell).toContain("notificationAttention({");
		expect(bell).toContain("attention.badge");
		expect(bell).toContain("attention.dot");
		expect(bell).toContain("aria-label={bellLabel(attention, unseenUpdate)}");
	});

	/**
	 * The dot carries no number. A `1` would be a lie: three backlogged items still produce one dot.
	 * The unread count is the inbox's vocabulary, not the popover's.
	 */
	it("the dot draws no number", () => {
		const dot = bell.slice(bell.indexOf("attention.dot"));
		expect(dot).not.toContain("AnimatedCount");
	});

	it("the marker is decoration", () => {
		expect(bell).not.toMatch(/attention\.dot[\s\S]{0,400}aria-label/);
		const dot = bell.slice(bell.indexOf("attention.dot"));
		expect(dot.slice(0, 400)).toContain('aria-hidden="true"');
	});
});
