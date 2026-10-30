import type { Viewer } from "@rowcat/domain";
import {
	ACCOUNT_QUERY_KEY,
	CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	GALLERY_QUERY_KEY_PREFIX,
	MY_MODERATION_QUERY_KEY,
	MY_REPORTS_QUERY_KEY,
	NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
	PERSONALIZATION_QUERY_KEY,
	STORY_COMMENTS_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
	VIEWER_QUERY_KEY,
} from "@rowcat/query";
import type { RowCatClient } from "@rowcat/sdk";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthFlowError } from "./auth-error.ts";
import {
	completeAuthentication,
	signOutSession,
} from "./session-transition.ts";

/**
 * The moment identity changes: does the previous person's value stay visible to the next one?
 *
 * Every private value seeded here is personal: email, balance, unread notification count, the title
 * and performance of an unpublished manuscript, sanction reasons. With invalidation alone the
 * cached value remains, and a cell with an observer (a badge) redraws at once. `@rowcat/query`
 * already owns that policy, so what this file checks is whether the mobile transition actually goes
 * through it.
 */

const ALICE: Viewer = {
	id: "member-alice",
	nickname: "Alice",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
	localOwner: false,
};

const BOB: Viewer = { ...ALICE, id: "member-bob", nickname: "Bob" };

/** The test decides what `/me` answers. */
let answer: () => Promise<Viewer | null>;
const meGet = vi.fn(() => answer());

const client = { me: { get: meGet } } as unknown as RowCatClient;

let queryClient: QueryClient;

/** Values only Alice could see. None may remain after the transition. */
const PRIVATE_KEYS = [
	ACCOUNT_QUERY_KEY,
	NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
	MY_MODERATION_QUERY_KEY,
	MY_REPORTS_QUERY_KEY,
] as const;

const seedAlicesPrivateState = () => {
	queryClient.setQueryData(VIEWER_QUERY_KEY, ALICE);
	queryClient.setQueryData(ACCOUNT_QUERY_KEY, {
		email: "alice@example.test",
	});
	queryClient.setQueryData(NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY, { unread: 7 });
	queryClient.setQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX, {
		items: [{ title: "A manuscript not yet published" }],
	});
	queryClient.setQueryData(CREATOR_ANALYTICS_QUERY_KEY_PREFIX, {
		items: [{ title: "A manuscript not yet published", views: 12 }],
	});
	queryClient.setQueryData(MY_MODERATION_QUERY_KEY, {
		restrictions: ["…"],
		appeals: [{ id: "appeal-alice", status: "open" }],
	});
	/**
	 * A report the member filed records whom they reported. The whole infinite-query list, including
	 * its accumulated pages, must be removed. Marking it stale is not enough: the cached value keeps
	 * rendering until the refetch finishes.
	 */
	queryClient.setQueryData(MY_REPORTS_QUERY_KEY, {
		pages: [{ items: [{ id: "report-alice", state: "reviewing" }] }],
		pageParams: [""],
	});
};

const remainingPrivateState = () =>
	PRIVATE_KEYS.filter((key) => queryClient.getQueryData(key) !== undefined).map(
		(key) => key.join("."),
	);

beforeEach(() => {
	meGet.mockClear();
	answer = async () => null;
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
});

afterEach(() => {
	queryClient.clear();
});

describe("sign-in complete", () => {
	it("asks /me with the new cookie to settle the member", async () => {
		answer = async () => BOB;

		const viewer = await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		expect(viewer).toEqual(BOB);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(BOB);
	});

	/**
	 * P0. If any of Alice's values survives, Bob's screen draws it until the refetch.
	 */
	it("not a single private value of the previous person remains", async () => {
		seedAlicesPrivateState();
		answer = async () => BOB;

		await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		expect(remainingPrivateState()).toEqual([]);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(BOB);
	});

	/**
	 * Asks the server now instead of using the cached value. With the 60-second freshness, a
	 * just-signed-out account's value would still count as fresh and skip the network.
	 */
	it("asks the server again even when the cache is fresh", async () => {
		queryClient.setQueryData(VIEWER_QUERY_KEY, ALICE);
		answer = async () => BOB;

		await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		expect(meGet).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(BOB);
	});

	/**
	 * Authenticated but no member. Never invent the viewer from the session: a database opened under
	 * an invented identity connects to no server resource, and that state never heals itself.
	 */
	it("when /me is null it ends in failure and closes that session", async () => {
		answer = async () => null;
		const signOut = vi.fn(async () => {});

		await expect(
			completeAuthentication({ queryClient, client, signOut }),
		).rejects.toMatchObject({ failure: "session_without_viewer" });

		expect(signOut).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
	});

	it("failing to ask /me isn't a sign-out", async () => {
		answer = async () => {
			throw new Error("network down");
		};
		const signOut = vi.fn(async () => {});

		await expect(
			completeAuthentication({ queryClient, client, signOut }),
		).rejects.toMatchObject({ failure: "unreachable" });

		// The session is not closed: the cookie is valid, and the next attempt is the retry.
		expect(signOut).not.toHaveBeenCalled();
	});
});

describe("Sign out", () => {
	it("on success the viewer empties and no private value remains", async () => {
		seedAlicesPrivateState();
		const signOut = vi.fn(async () => {});

		await signOutSession({ queryClient, client, signOut });

		expect(signOut).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
		expect(remainingPrivateState()).toEqual([]);
	});

	/**
	 * The response was lost but the server deleted the session. The server confirmed it, so end as
	 * success. Reporting failure here would leave the user working in an account that is already
	 * signed out.
	 */
	it("the response was lost but if the session really disappeared it ends in success", async () => {
		seedAlicesPrivateState();
		answer = async () => null;

		await signOutSession({
			queryClient,
			client,
			signOut: async () => {
				throw new AuthFlowError("unreachable");
			},
		});

		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
		expect(remainingPrivateState()).toEqual([]);
	});

	/**
	 * P0. The request never reached the server, so this is still Alice. Clearing caches here would
	 * leave a half-identity state: the screen shows guest while the cookie is alive and the local
	 * database is closed.
	 */
	it("doesn't sign out if the server still says Alice", async () => {
		seedAlicesPrivateState();
		answer = async () => ALICE;

		await expect(
			signOutSession({
				queryClient,
				client,
				signOut: async () => {
					throw new AuthFlowError("unreachable");
				},
			}),
		).rejects.toMatchObject({ failure: "sign_out_failed" });

		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(ALICE);
	});

	it("if it can't even check, it erases nothing", async () => {
		seedAlicesPrivateState();
		answer = async () => {
			throw new Error("network down");
		};

		await expect(
			signOutSession({
				queryClient,
				client,
				signOut: async () => {
					throw new AuthFlowError("unreachable");
				},
			}),
		).rejects.toMatchObject({ failure: "sign_out_failed" });

		// An unconfirmed state is not treated as confirmed: it stays as Alice.
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(ALICE);
		expect(queryClient.getQueryData(ACCOUNT_QUERY_KEY)).toBeDefined();
	});
});

describe("a late response", () => {
	/**
	 * P0. If a query started as Alice succeeds after Bob is active, TanStack Query stores the response
	 * under the current key: the screen shows Bob, but the value is Alice's. This is why the first
	 * line of a transition is `cancelQueries()`; removing that line breaks this test.
	 */
	it("a lookup started as Alice can't land in Bob's cache", async () => {
		let releaseAlice: ((viewer: Viewer) => void) | undefined;

		const alicesRequest = queryClient.fetchQuery({
			queryKey: VIEWER_QUERY_KEY,
			queryFn: () =>
				new Promise<Viewer>((resolve) => {
					releaseAlice = resolve;
				}),
		});
		/** A cancelled query ends as a rejection. Catch it so that rejection does not fail the test. */
		const settled = alicesRequest.catch(() => undefined);

		answer = async () => BOB;
		await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		// Only now does Alice's response arrive.
		releaseAlice?.(ALICE);
		await settled;

		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(BOB);
	});
});

/**
 * The surface added with discover and story detail.
 *
 * The checks above cover private values on the account screen. Public screens hold no such values,
 * but the relations they draw all come from the viewer axis: which story is hearted, which comment
 * gets a delete control, whether a list includes the viewer's own private works. If values survive,
 * Bob's screen draws them as Alice's until the refetch. The policy already lives in `@rowcat/query`
 * (`refreshViewerState` and `resetViewerState` reset these four prefixes; invalidation keeps the
 * value). What this checks is whether the mobile transition goes through that policy.
 */
const PUBLIC_SURFACE_KEYS = [
	PERSONALIZATION_QUERY_KEY,
	GALLERY_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
	STORY_COMMENTS_QUERY_KEY_PREFIX,
] as const;

const seedAlicesPublicSurface = () => {
	queryClient.setQueryData(VIEWER_QUERY_KEY, ALICE);
	/** Works Alice saved and creators she follows. These drive hearts and the following feed. */
	queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, {
		favorites: ["story-alice-favorite"],
		following: ["member-carol"],
		blocked: [],
	});
	/** A list loaded while signed in can include Alice's private and adult works. */
	queryClient.setQueryData(GALLERY_QUERY_KEY_PREFIX, {
		pages: [{ items: [{ id: "story-alice-private" }] }],
	});
	queryClient.setQueryData(STORY_DETAIL_QUERY_KEY_PREFIX, {
		id: "story-alice-private",
		title: "A story only Alice can see",
	});
	/** This list contains Alice's comment, and the screen draws delete on it because of ownership. */
	queryClient.setQueryData(STORY_COMMENTS_QUERY_KEY_PREFIX, {
		pages: [{ items: [{ id: "comment-1", author: { id: ALICE.id } }] }],
	});
};

const remainingPublicSurface = () =>
	PUBLIC_SURFACE_KEYS.filter(
		(key) => queryClient.getQueryData(key) !== undefined,
	).map((key) => key.join("."));

describe("the viewer axis of public screens", () => {
	/**
	 * P0. Alice's hearts must not appear for even one frame on Bob's screen. If personalization
	 * survives, Bob's discover screen shows hearts on stories Alice saved; if comments survive,
	 * Alice's comments appear with delete buttons.
	 */
	it("from Alice → Bob no personalization, list, detail or comment remains", async () => {
		seedAlicesPublicSurface();
		answer = async () => BOB;

		await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		expect(remainingPublicSurface()).toEqual([]);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(BOB);
	});

	/**
	 * Logout is not symmetric with login, and the asymmetry is intended.
	 *
	 * On login the new viewer is unknown, so cached values are discarded and asked again. On logout
	 * the result is known, so the guest value is written first and only the rest is invalidated. That
	 * keeps the screen from flickering until the refetch.
	 *
	 * So the check is not "the cache is empty" but "Alice's relations are gone". Personalization
	 * settles to empty (no hearts, no following), detail and comments that only Alice could see are
	 * dropped, and the public list only gets a stale mark. It is not reset because most of that list
	 * is public works that stay visible after sign-out; dropping it would restart discover from empty
	 * every time an account is left.
	 */
	it("Alice's relations don't remain after sign-out", async () => {
		seedAlicesPublicSurface();

		await signOutSession({
			queryClient,
			client,
			signOut: async () => {},
		});

		/** The confirmed answer "guest" is written. */
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
		/** The arrays that drew hearts and following are empty. */
		expect(queryClient.getQueryData(PERSONALIZATION_QUERY_KEY)).toEqual({
			favorites: [],
			following: [],
			blocked: [],
		});
		/** Works only Alice could see, and the comment list that drew ownership-based delete, are dropped. */
		expect(
			queryClient.getQueryData(STORY_DETAIL_QUERY_KEY_PREFIX),
		).toBeUndefined();
		expect(
			queryClient.getQueryData(STORY_COMMENTS_QUERY_KEY_PREFIX),
		).toBeUndefined();
		/** The public list only gets a stale mark; the next fetch replaces it with the guest result. */
		expect(
			queryClient.getQueryState(GALLERY_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(true);
	});

	/**
	 * The other side of the boundary. Do not clear the whole cache when identity changes:
	 * `queryClient.clear()` also drops useful public cache, so the whole app would reload on every
	 * account switch. Values that do not depend on the viewer (a public profile's identity, the same
	 * for everyone) must survive.
	 */
	it("doesn't discard public values unrelated to the viewer", async () => {
		const publicProfileKey = ["creators", "profile", "member-carol"];
		queryClient.setQueryData(publicProfileKey, { nickname: "Carol" });
		answer = async () => BOB;

		await completeAuthentication({
			queryClient,
			client,
			signOut: async () => {},
		});

		expect(queryClient.getQueryData(publicProfileKey)).toEqual({
			nickname: "Carol",
		});
	});
});
