import type { Notification } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	markAllNotificationsReadMutationOptions,
	markNotificationReadMutationOptions,
	NOTIFICATIONS_LIST_QUERY_KEY,
	NOTIFICATIONS_QUERY_KEY_PREFIX,
	NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
	type NotificationsInfiniteData,
} from "./notifications.ts";
import { resetViewerState, VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for notification writes. Whether the request went out is not checked here (that is
 * the SDK's job). This file checks what happens to each slot when a click finishes. Four results
 * are never visible by eye:
 * - Whether the optimistic read rolls back on failure. The screen would briefly show a right
 *   value and then lose it.
 * - Re-pressing an already read row must not lower the count. If it does, the badge shows less
 *   than the real number.
 * - Mark-all-read must not touch the read time of rows already read. Otherwise yesterday's read
 *   notifications look newly read.
 * - Whether logout discards this prefix's values or only marks them stale. If only stale, the
 *   next user's header keeps the previous user's unread count (this is a P0).
 *
 * No React. The policy is a set of rules on `QueryClient`, not a hook.
 */

const notification = (
	id: string,
	readAt: string | null = null,
): Notification => ({
	id,
	kind: "follow",
	actor: { id: `a-${id}`, displayName: "Cat", avatarUrl: null },
	createdAt: "2026-08-20T00:00:00.000Z",
	readAt,
});

/**
 * Inbox across two pages. One page is not enough to check whether patches reach the later page.
 */
const seed = (
	queryClient: QueryClient,
	items: Notification[][] = [[notification("n1"), notification("n2")]],
	/**
	 * `null` means the unread-count slot does not exist at all. `undefined` would be swallowed by the
	 * default parameter (2 would be seeded), making that case impossible to test.
	 */
	unread: number | null = 2,
): void => {
	queryClient.setQueryData<NotificationsInfiniteData>(
		NOTIFICATIONS_LIST_QUERY_KEY,
		{
			pages: items.map((page, index) => ({
				items: page,
				nextCursor: index === items.length - 1 ? null : `cursor-${index}`,
			})),
			pageParams: items.map((_, index) =>
				index === 0 ? "" : `cursor-${index}`,
			),
		},
	);
	if (unread !== null)
		queryClient.setQueryData<number>(
			NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
			unread,
		);
};

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

/**
 * Fake client providing only the functions needed. Calling any other function fails at that point.
 */
const clientOf = (
	notifications: Partial<RowCatClient["notifications"]>,
): RowCatClient => ({ notifications }) as RowCatClient;

/**
 * Runs the mutation for real. `mutationOptions` callbacks sit on the options object and do not run
 * by themselves. Calling them by hand would have the test invent the order and the arguments, so
 * the test could pass even when the library calls them differently.
 */
async function run<TVariables>(
	queryClient: QueryClient,
	options: object,
	variables: TVariables,
): Promise<"success" | "error"> {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(variables);
		return "success";
	} catch {
		return "error";
	}
}

const unreadIn = (queryClient: QueryClient) =>
	queryClient.getQueryData<number>(NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY);

const rowsIn = (queryClient: QueryClient): Notification[] =>
	(
		queryClient.getQueryData<NotificationsInfiniteData>(
			NOTIFICATIONS_LIST_QUERY_KEY,
		)?.pages ?? []
	).flatMap((page) => page.items);

const readAtIn = (queryClient: QueryClient, id: string) =>
	rowsIn(queryClient).find((row) => row.id === id)?.readAt;

describe("query keys", () => {
	/**
	 * This one assertion underpins all logout cleanup. If the prefix leaves `["viewer"]`, viewer
	 * cleanup misses this slot, and the symptom is the previous user's notifications on the next
	 * user's screen.
	 */
	it("all under the viewer prefix", () => {
		expect(NOTIFICATIONS_QUERY_KEY_PREFIX[0]).toBe(VIEWER_QUERY_KEY[0]);
		expect(NOTIFICATIONS_LIST_QUERY_KEY.slice(0, 2)).toEqual([
			...NOTIFICATIONS_QUERY_KEY_PREFIX,
		]);
		expect(NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY.slice(0, 2)).toEqual([
			...NOTIFICATIONS_QUERY_KEY_PREFIX,
		]);
	});
});

describe("markNotificationReadMutationOptions", () => {
	it("draws the row and count optimistically while the request runs", async () => {
		const queryClient = newClient();
		seed(queryClient);
		let during: { readAt: string | null | undefined; unread?: number } | null =
			null;

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({
					markRead: async () => {
						// While the request is in flight, the cache at this point is what the user sees.
						during = {
							readAt: readAtIn(queryClient, "n1"),
							unread: unreadIn(queryClient),
						};
						return "2026-08-20T01:00:00.000Z";
					},
				}),
				queryClient,
			),
			"n1",
		);

		/**
		 * Compare the whole object. Reading fields one by one makes TypeScript not see assignments inside
		 * the callback and narrow `during` to `never`. The follow-side tests have the same shape for this
		 * reason.
		 */
		expect(during).toEqual({ readAt: expect.any(String), unread: 1 });
	});

	it("on success it overwrites with the server's confirmed time", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({ markRead: async () => "2026-08-20T01:00:00.000Z" }),
				queryClient,
			),
			"n1",
		);

		expect(readAtIn(queryClient, "n1")).toBe("2026-08-20T01:00:00.000Z");
		expect(readAtIn(queryClient, "n2")).toBeNull();
		expect(unreadIn(queryClient)).toBe(1);
	});

	it("on failure the row and count both return", async () => {
		const queryClient = newClient();
		seed(queryClient);

		const result = await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({
					markRead: async () => {
						throw new Error("network");
					},
				}),
				queryClient,
			),
			"n1",
		);

		expect(result).toBe("error");
		expect(readAtIn(queryClient, "n1")).toBeNull();
		expect(unreadIn(queryClient)).toBe(2);
	});

	/**
	 * Re-pressing an already read row leaves the server count unchanged too. Removing it only on
	 * screen would leave the badge smaller than the real count until the next poll restores it.
	 */
	it("an already read row does not lower the count", async () => {
		const queryClient = newClient();
		seed(queryClient, [
			[notification("n1", "2026-08-19T00:00:00.000Z"), notification("n2")],
		]);

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({ markRead: async () => "2026-08-19T00:00:00.000Z" }),
				queryClient,
			),
			"n1",
		);

		expect(unreadIn(queryClient)).toBe(2);
	});

	/**
	 * The optimistic decrement must not go below zero (§84). There is a real moment where the popover
	 * is open but the list has not loaded, and the count sits at 0. A negative value shown then would
	 * read as a bug.
	 */
	it("the count never goes below 0", async () => {
		const queryClient = newClient();
		seed(queryClient, [[notification("n1")]], 0);

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({ markRead: async () => "2026-08-20T01:00:00.000Z" }),
				queryClient,
			),
			"n1",
		);

		expect(unreadIn(queryClient)).toBe(0);
	});

	/**
	 * Does not create a missing slot. A value the server was never asked for would otherwise look
	 * present.
	 */
	it("does not invent a missing count cell", async () => {
		const queryClient = newClient();
		seed(queryClient, [[notification("n1")]], null);

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({ markRead: async () => "2026-08-20T01:00:00.000Z" }),
				queryClient,
			),
			"n1",
		);

		expect(unreadIn(queryClient)).toBeUndefined();
	});

	/**
	 * Later pages are patched too. Scanning only the first page would make clicks after `Show more` do
	 * nothing.
	 */
	it("patches rows on the second page too", async () => {
		const queryClient = newClient();
		seed(queryClient, [[notification("n1")], [notification("n2")]]);

		await run(
			queryClient,
			markNotificationReadMutationOptions(
				clientOf({ markRead: async () => "2026-08-20T01:00:00.000Z" }),
				queryClient,
			),
			"n2",
		);

		expect(readAtIn(queryClient, "n2")).toBe("2026-08-20T01:00:00.000Z");
	});
});

describe("markAllNotificationsReadMutationOptions", () => {
	it("on success the count becomes 0 and every held page is read", async () => {
		const queryClient = newClient();
		seed(queryClient, [[notification("n1")], [notification("n2")]]);

		await run(
			queryClient,
			markAllNotificationsReadMutationOptions(
				clientOf({ markAllRead: async () => 2 }),
				queryClient,
			),
			undefined,
		);

		expect(unreadIn(queryClient)).toBe(0);
		expect(rowsIn(queryClient).every((row) => row.readAt !== null)).toBe(true);
	});

	/**
	 * The server only changed rows where `read_at is null`. Overwriting all of them with now would
	 * make yesterday's read notifications look just read.
	 */
	it("an already read row's time is untouched", async () => {
		const queryClient = newClient();
		const already = "2026-08-19T00:00:00.000Z";
		seed(queryClient, [[notification("n1", already), notification("n2")]]);

		await run(
			queryClient,
			markAllNotificationsReadMutationOptions(
				clientOf({ markAllRead: async () => 1 }),
				queryClient,
			),
			undefined,
		);

		expect(readAtIn(queryClient, "n1")).toBe(already);
		expect(readAtIn(queryClient, "n2")).not.toBeNull();
	});

	/** Only confirmed writes paint. If the request fails, no slot changes. */
	it("on failure no cell changes", async () => {
		const queryClient = newClient();
		seed(queryClient);

		const result = await run(
			queryClient,
			markAllNotificationsReadMutationOptions(
				clientOf({
					markAllRead: async () => {
						throw new Error("network");
					},
				}),
				queryClient,
			),
			undefined,
		);

		expect(result).toBe("error");
		expect(unreadIn(queryClient)).toBe(2);
		expect(rowsIn(queryClient).every((row) => row.readAt === null)).toBe(true);
	});
});

describe("account switch", () => {
	/**
	 * This slice's P0 (§76, §123). Invalidation alone leaves the stored value in place, and the header
	 * badge observes the slot and redraws it immediately. The previous user's unread count would stay
	 * on screen before the next user has even logged in.
	 */
	it("signing out **drops** the list and the count", async () => {
		const queryClient = newClient();
		seed(queryClient, [[notification("n1")]], 7);

		await resetViewerState(queryClient);

		expect(unreadIn(queryClient)).toBeUndefined();
		expect(rowsIn(queryClient)).toEqual([]);
	});
});
