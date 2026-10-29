import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of notifications: what the types cannot catch.
 *
 * The rules themselves are checked elsewhere: copy in `notification-copy.test.ts`, destinations in
 * `notification-destination.test.ts`, screen-state order in `notifications-state.test.ts`, and
 * cache policy (optimistic read, non-optimistic mark-all, rollback, count floor, logout reset) in
 * `@rowcat/query`'s `notifications.test.ts`. Here we check that those are **actually called**, and
 * that things that must not be called are not.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * Checked **after stripping comments.** Comments in this repository explain boundaries by naming
 * the forbidden tokens ("we do not write `itms-apps://`"). Scanning raw text would flag the
 * sentence that explains the rule, and everyone would then fix it by deleting the comment.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("notification-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const feature = product.filter((file) =>
	file.path.startsWith("features/notifications/"),
);

describe("the files to check actually exist", () => {
	it("the routes and feature files are all in place", () => {
		for (const path of [
			"app/notifications.tsx",
			"features/notifications/notification-copy.ts",
			"features/notifications/notification-destination.ts",
			"features/notifications/notification-icon.ts",
			"features/notifications/notification-row.tsx",
			"features/notifications/notification-shortcut.tsx",
			"features/notifications/general-notifications.tsx",
			"features/notifications/notifications-screen.tsx",
			"features/notifications/notifications-tabs.tsx",
			"features/notifications/notifications-state.ts",
			"features/notifications/use-notifications.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
		expect(feature.length).toBeGreaterThan(5);
	});

	/** The route file is just a route; the screen belongs to the feature. */
	it("the routes are thin", () => {
		const route = fileAt("app/notifications.tsx");
		expect(route).toContain("<NotificationsScreen />");
		expect(route).not.toContain("useQuery");
		expect(route).not.toContain("useNotifications");
	});
});

describe("the cache policy is one shared package", () => {
	const hook = fileAt("features/notifications/use-notifications.ts");

	/**
	 * The same functions as the web. If mobile started writing its own cache updates, the same
	 * notification would move by different rules in the two apps, a difference visible only by
	 * comparing the two screens side by side.
	 */
	it("actually calls the shared query and mutation options", () => {
		expect(hook).toContain("notificationsInfiniteQueryOptions");
		expect(hook).toContain("notificationUnreadCountQueryOptions");
		expect(hook).toContain("markNotificationReadMutationOptions");
		expect(hook).toContain("markAllNotificationsReadMutationOptions");
		expect(hook).toContain("refreshNotifications");
	});

	/**
	 * No second implementation that edits the cache by hand. Optimistic or not, and rollback, belong
	 * to the shared policy.
	 */
	it("feature code doesn't modify the cache directly", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("setQueryData");
			expect(file.text, file.path).not.toContain("onMutate");
			/** The read timestamp is not invented by the screen: the server confirms it and the shared policy writes it in. */
			expect(file.text, file.path).not.toMatch(/readAt:\s*new Date/);
		}
	});

	/** The interval (60 s) belongs to the shared options. Mobile does not rewrite its own timer or interval. */
	it("doesn't rewrite polling", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("refetchInterval");
			expect(file.text, file.path).not.toContain("setInterval");
		}
	});

	/**
	 * There are exactly **two** places that ask for the unread count: the hook (screen) and the
	 * shortcut (shell). A third would be a change that must answer in review whether that screen also
	 * needs the badge.
	 */
	it("the count lookup has two consumers", () => {
		const consumers = product
			.filter((file) =>
				/\bnotificationUnreadCountQueryOptions\b/.test(file.text),
			)
			.map((file) => file.path)
			.sort();
		expect(consumers).toEqual([
			"features/notifications/notification-shortcut.tsx",
			"features/notifications/use-notifications.ts",
		]);
	});

	/**
	 * **The shortcut is still navigation.**
	 *
	 * The web's bell opens a box, but this one goes to the destination: no sheet or popover, to keep
	 * parity. That it is `navigate` is also a rule: with `push`, the stack grows each time the bell is
	 * pressed.
	 */
	it("the shortcut is navigation, not a popover", () => {
		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		expect(shortcut).toContain('router.navigate("/notifications")');
		expect(shortcut).not.toMatch(
			/\bPopover\b|\bChoiceSheet\b|\bDialog\b|\bSheet\b/,
		);
		/** No preview: neither the list nor the history is drawn by this file. */
		expect(shortcut).not.toMatch(/<NotificationRow|<UpdateNotesList/);
	});

	/**
	 * The badge is not derived from the list: the bell does not take the list query at all.
	 *
	 * The rule for the marker is not decided by this file. The bell now represents two things (unread
	 * notifications and new release notes), so priority and label assembly exist, and they live in the
	 * **same shared pure function** the web's bell uses. Writing them per app would eventually show
	 * the same state as a number on one side and a dot on the other.
	 */
	it("the bell doesn't count from the list", () => {
		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		expect(shortcut).not.toContain("notificationsInfiniteQueryOptions");
		expect(shortcut).not.toMatch(/filter\([^)]*isUnread/);
		expect(shortcut).toContain("notificationAttention");
		/** The bell's count and name are not rebuilt in the bell itself. */
		expect(shortcut).not.toContain("notificationBadgeLabel");
		expect(shortcut).not.toContain("notificationBellLabel");
	});
});

describe("activation order", () => {
	const hook = fileAt("features/notifications/use-notifications.ts");
	const screen = fileAt("features/notifications/notifications-screen.tsx");
	/** Row activation and navigation belong to the `General` tab; the screen only combines the two tabs. */
	const general = fileAt("features/notifications/general-notifications.tsx");

	/** Navigation does not wait for the read request: fire and forget (`mutate`). */
	it("no code waits on the read request", () => {
		for (const file of feature)
			expect(file.text, file.path).not.toContain("mutateAsync");
		expect(hook).toMatch(/read\.mutate\(plan\.markReadId\)/);
	});

	/** The judgment is in a pure function; the hook does not rewrite the plan. */
	it("the activation decision goes through a pure plan", () => {
		expect(hook).toContain("notificationActivationPlan");
		expect(hook).not.toMatch(/isUnread\(/);
	});

	/**
	 * **Opening and reading are different operations.** The focus effect does one thing: a refresh,
	 * which is an invalidation (`refreshNotifications`), not marking as read.
	 */
	it("screen focus doesn't mark as read", () => {
		expect(screen).toMatch(
			/useFocusEffect\([\s\S]{0,200}refreshNotifications\(queryClient\)/,
		);
		expect(screen).not.toMatch(
			/useFocusEffect\([\s\S]{0,300}(activate|markAll)/,
		);
	});

	/**
	 * **The effect lives on the screen, not the tab.** On the tab it would run each time the tabs are
	 * switched, making a tab switch hit the server.
	 */
	it("cells have no focus effects", () => {
		expect(general).not.toContain("useFocusEffect");
	});
});

describe("notifications are server state — they don't live on the device", () => {
	it("no local storage or sync vocabulary", () => {
		for (const file of feature) {
			for (const forbidden of [
				/AsyncStorage/,
				/SecureStore/i,
				/expo-sqlite/,
				/local-data\//,
				/local-sync\//,
				/\bChatStore\b/,
				/\bSyncStore\b/,
				/useMobileLocalScope/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
		}
	});

	/** The SQLite schema has no notifications table — the read state must not diverge between devices. */
	it("the device schema doesn't know notifications", () => {
		expect(fileAt("lib/local-data/migrations.ts")).not.toMatch(/notification/i);
	});

	/**
	 * **Push is not this slice — its meaning changed.**
	 *
	 * For a while this check meant "no push vocabulary anywhere in this app", and that was true (there
	 * was no delivery plane at all). Now there is one, so the rule changed from **absence** to
	 * **boundary**:
	 *
	 * ```text
	 * durable inbox   whether the notification exists · what it means · whether it was read · where it leads
	 * push            an attempt to deliver that event once more to this device. Not authority.
	 * ```
	 *
	 * The inbox slice does not know that delivery. If it began to, code deriving read state from
	 * delivery would eventually appear ("delivered, so treat it as read"), and at that moment
	 * server-owned private state would move with device events.
	 */
	it("the inbox doesn't know the delivery plane", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toMatch(/expo-notifications/);
			expect(file.text, file.path).not.toMatch(/PushToken|DeviceToken/i);
			expect(file.text, file.path).not.toMatch(
				/push_delivery|push_registration/,
			);
			/** It does not import the push slice either: the dependency runs in one direction only. */
			expect(file.text, file.path).not.toMatch(/features\/push\//);
			expect(file.text, file.path).not.toMatch(/lib\/push\//);
		}
	});

	/**
	 * **One file knows the native notifications module.**
	 *
	 * That module does not open in Node, so the more rules mix into it, the more code escapes this
	 * test. Above all, **where the permission prompt is requested** is this slice's product decision.
	 * If several places can call it, one screen mounting someday will open the system dialog.
	 */
	it("one place imports expo-notifications", () => {
		const importers = product
			.filter((file) => /from\s+["']expo-notifications["']/.test(file.text))
			.map((file) => file.path);
		expect(importers).toEqual(["lib/push/native.ts"]);
	});

	/** The inbox does not open store deep links; that belongs to the app-update gate slice. */
	it("there's no store address", () => {
		for (const file of product)
			for (const forbidden of [
				/itms-apps:/,
				/market:\/\//,
				/apps\.apple\.com/,
				/play\.google\.com/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/**
	 * The feature does not guess an origin. Every destination is an in-app route, so no absolute
	 * address belongs here.
	 */
	it("no hard-coded addresses inside the feature", () => {
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/https?:\/\//);
	});
});

describe("shell boundaries", () => {
	/**
	 * The generic `AppBar` is a presentational primitive. Once it knows about notification queries,
	 * identity or routes, the package becomes part of the product. The bell is a feature component and
	 * the screen composes it through `actions`.
	 */
	it("the shared AppBar doesn't know notifications", () => {
		const bar = stripComments(
			readFileSync(join(REPO, "packages/ui-native/src/app-bar.tsx"), "utf8"),
		);
		expect(bar).not.toMatch(/[Nn]otification/);
		expect(bar).not.toContain("@rowcat/query");
		expect(bar).not.toContain("useQuery");
	});

	/**
	 * **The drawer has no notifications.** Its left side is a fixed IA of product sections only, and
	 * notifications are a header utility. `lib/boundaries.test.ts` locks this by the word (`Notifications`); here
	 * we lock it once more through wiring.
	 */
	it("the drawer draws no path to notifications", () => {
		const sidebar = fileAt("features/shell/app-sidebar.tsx");
		expect(sidebar).not.toContain("NotificationShortcut");
		expect(sidebar).not.toContain("/notifications");
		/** The section vocabulary stays as it is too: notifications are not a `MobileAppSection`. */
		expect(fileAt("features/shell/shell-route.ts")).toMatch(
			/MobileAppSection = "discover" \| "chat"/,
		);
	});

	/**
	 * The places that draw the bell directly are **narrowed to two**: the utility group
	 * (`ShellUtilities`) and the discover header (a special row where identity has four branches plus
	 * a balance cell, so it cannot use the group; see the `shell-utilities.tsx` header). Since the
	 * account menu arrived, if each screen wired bell and account separately, one screen would
	 * eventually flip the order or drop the account. So screens place exactly one group row.
	 */
	it("only the bundle and the discover header draw the bell directly", () => {
		const hosts = product
			.filter((file) => file.text.includes("<NotificationShortcut"))
			.map((file) => file.path)
			.sort();
		expect(hosts).toEqual([
			"features/shell/app-header.tsx",
			"features/shell/shell-utilities.tsx",
		]);
	});

	/**
	 * The screens that stand the group. **Two are intentionally absent.**
	 *
	 * The header of the conversation screen (an open room) is the tightest row in this app (four 44pt
	 * targets in 320pt). Adding a cell that carries a count (the balance) there always shrinks the
	 * title, which is why the balance shortcut also does not stand there.
	 *
	 * **The draft editor is also excluded.** Its header already has the drawer, back and the title,
	 * and while editing there is no need for the bell or the account menu. The workspace home
	 * (`/create`) conversely has the group: it is a destination, and "a utility that calls me from any
	 * screen" has its place there.
	 *
	 * The settings screen **is** in this list. Its category screens share one shell, so there is one
	 * slot (`settings-shell.tsx`), and on that row the gear stays drawn with its active indicator on.
	 * The promise is that utilities sit in the same place on every screen, so it is not removed on its
	 * own screen.
	 */
	it("exactly this list of screens draws the utility bundle", () => {
		const hosts = product
			.filter((file) => file.text.includes("<ShellUtilities"))
			.map((file) => file.path)
			.sort();
		expect(hosts).toEqual([
			"features/account/account-screen.tsx",
			"features/chat-library/chat-library-screen.tsx",
			"features/create/create-screen.tsx",
			"features/notifications/notifications-screen.tsx",
			"features/profile/creator-profile-screen.tsx",
			"features/settings/settings-shell.tsx",
			"features/story/story-detail-screen.tsx",
		]);
		for (const forbidden of ["NotificationShortcut", "ShellUtilities"])
			for (const path of [
				"features/chat/chat-screen.tsx",
				"features/create/draft-editor-screen.tsx",
			])
				expect(fileAt(path), `${path} — ${forbidden}`).not.toContain(forbidden);
	});

	/** The basis of the active indicator is one shell-route judgment; do not re-write path prefixes here. */
	it("the bell's active state goes through the shell decision", () => {
		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		expect(shortcut).toContain("mobileShellRouteFor");
		expect(shortcut).not.toContain("startsWith");
	});

	/** Guests and unconfirmed identity get no bell. Do not draw a disabled bell and send them to login. */
	it("the bell stands only for members", () => {
		const shortcut = fileAt("features/notifications/notification-shortcut.tsx");
		expect(shortcut).toMatch(
			/if \(session\.phase !== "authenticated"\) return null;/,
		);
	});
});

describe("account switch isolation", () => {
	/**
	 * The owner of cleanup is the shared policy: `resetViewerState` clears the notification prefix
	 * (`@rowcat/query`'s `notifications.test.ts` verifies it by value). If mobile built a
	 * notification-only logout handler there would be two cleanup paths, and eventually only one would
	 * be fixed.
	 */
	it("doesn't create a notification-only cleanup device", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("resetViewerState");
			expect(file.text, file.path).not.toContain("refreshViewerState");
		}
		/** The transition calls the two shared cleanup functions as-is; notifications are included inside them. */
		const transition = fileAt("lib/session-transition.ts");
		expect(transition).toContain("resetViewerState");
		expect(transition).toContain("refreshViewerState");
	});

	/** No private query goes out before identity is confirmed; the gate is `enabled`. */
	it("the screen's lookup hangs on identity", () => {
		const general = fileAt("features/notifications/general-notifications.tsx");
		expect(general).toMatch(/useNotifications\(\{ enabled: authenticated \}\)/);
	});
});
