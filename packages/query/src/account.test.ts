import {
	type AccountDetails,
	DEFAULT_GALLERY_FILTERS,
	type Viewer,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	ACCOUNT_QUERY_KEY,
	nicknameMutationOptions,
	showAdultMutationOptions,
} from "./account.ts";
import { galleryQueryKey } from "./gallery.ts";
import { storyDetailQueryKey } from "./story.ts";
import {
	PERSONALIZATION_QUERY_KEY,
	refreshViewerState,
	resetViewerState,
	VIEWER_QUERY_KEY,
} from "./viewer.ts";

/**
 * Cache policy for account writes: what each cache cell ends up as once a write settles. Whether
 * the request was sent is the SDK's job, not this file's.
 * - Whether an optimistic value really reverts on failure.
 * - Whether turning off adult display discards cached adult works or only marks them stale. Stale
 *   marking would keep drawing just-hidden works until the refetch finishes. No React: the policy
 *   is rules on QueryClient, not a hook, so markup changes cannot break it.
 */

const VIEWER: Viewer = {
	id: "member-1",
	nickname: "Cat",
	status: "approved",
	role: "user",
	verified: true,
	adult: true,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
};

const ACCOUNT: AccountDetails = {
	email: "cat@example.test",
	emailVerified: false,
	hasPassword: true,
	twoFactorEnabled: false,
	methods: [{ provider: "credential", linkedAt: "2026-01-01T00:00:00.000Z" }],
	createdAt: "2026-01-01T00:00:00.000Z",
};

const PERSONALIZATION = { favorites: ["s1"], following: [], blocked: [] };

const GALLERY_KEY = galleryQueryKey(DEFAULT_GALLERY_FILTERS);

const DETAIL_KEY = storyDetailQueryKey("s1");

/**
 * Seeds cache values without registering a queryKey and queryFn, so no refetch can run. Without an
 * observer, invalidation would look like a no-op, so the state is checked instead: isInvalidated
 * for invalidation, and whether the value is gone for reset.
 */
function seed(queryClient: QueryClient): void {
	queryClient.setQueryData(VIEWER_QUERY_KEY, VIEWER);
	queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, PERSONALIZATION);
	queryClient.setQueryData(ACCOUNT_QUERY_KEY, ACCOUNT);
	queryClient.setQueryData(GALLERY_KEY, { pages: [], pageParams: [] });
	queryClient.setQueryData(DETAIL_KEY, { id: "s1" });
}

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

/** Fake client with only the one function needed; calling any other member fails on the spot. */
const clientOf = (me: Partial<RowCatClient["me"]>): RowCatClient =>
	({ me }) as RowCatClient;

/**
 * Runs the mutation for real through MutationObserver. The onMutate/onError/onSuccess callbacks in
 * mutationOptions never run on their own. Calling them by hand would let the test invent their
 * order and arguments, so a test could pass while the library calls them differently.
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

const viewerIn = (queryClient: QueryClient) =>
	queryClient.getQueryData<Viewer>(VIEWER_QUERY_KEY);

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
	queryClient.getQueryState(key)?.isInvalidated === true;

describe("nicknameMutationOptions", () => {
	it("on success it aligns the cache with the server's confirmed viewer", async () => {
		const queryClient = newClient();
		seed(queryClient);
		const confirmed: Viewer = { ...VIEWER, nickname: "NewName" };

		const result = await run(
			queryClient,
			nicknameMutationOptions(
				clientOf({ updateNickname: async () => confirmed }),
				queryClient,
			),
			{ nickname: "  NewName  " },
		);

		expect(result).toBe("success");
		expect(viewerIn(queryClient)?.nickname).toBe("NewName");
	});

	it("changes the viewer optimistically while the request runs", async () => {
		const queryClient = newClient();
		seed(queryClient);
		let seenDuringRequest: string | undefined;

		await run(
			queryClient,
			nicknameMutationOptions(
				clientOf({
					updateNickname: async (input) => {
						// While the request is in flight, the cache is exactly what the user sees on screen.
						seenDuringRequest = viewerIn(queryClient)?.nickname;
						return { ...VIEWER, nickname: input.nickname };
					},
				}),
				queryClient,
			),
			{ nickname: "  NewName  " },
		);

		// Surrounding whitespace is also trimmed in the optimistic value, so the header name does not
		// shift when the response arrives.
		expect(seenDuringRequest).toBe("NewName");
	});

	it("on failure it reverts the optimistic value", async () => {
		const queryClient = newClient();
		seed(queryClient);

		const result = await run(
			queryClient,
			nicknameMutationOptions(
				clientOf({
					updateNickname: async () => {
						throw new Error("refused");
					},
				}),
				queryClient,
			),
			{ nickname: "NewName" },
		);

		expect(result).toBe("error");
		expect(viewerIn(queryClient)?.nickname).toBe(VIEWER.nickname);
	});

	/**
	 * The server joins member nicknames on work queries, so the next fetch already returns the new
	 * name. The problem is work DTOs already in the cache: their creator name is frozen at query time.
	 * Without invalidation, a list restored by back navigation keeps the old name.
	 */
	it("on success it invalidates the gallery and story details (keeping values)", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			nicknameMutationOptions(
				clientOf({
					updateNickname: async () => ({ ...VIEWER, nickname: "NewName" }),
				}),
				queryClient,
			),
			{ nickname: "NewName" },
		);

		expect(isInvalidated(queryClient, GALLERY_KEY)).toBe(true);
		expect(isInvalidated(queryClient, DETAIL_KEY)).toBe(true);
		// Invalidation, not reset: the set of works the viewer can see does not change with the name.
		expect(queryClient.getQueryData(DETAIL_KEY)).toBeDefined();
	});

	it("personalization and account caches are untouched", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			nicknameMutationOptions(
				clientOf({
					updateNickname: async () => ({ ...VIEWER, nickname: "NewName" }),
				}),
				queryClient,
			),
			{ nickname: "NewName" },
		);

		expect(queryClient.getQueryData(PERSONALIZATION_QUERY_KEY)).toEqual(
			PERSONALIZATION,
		);
		expect(isInvalidated(queryClient, PERSONALIZATION_QUERY_KEY)).toBe(false);
		expect(queryClient.getQueryData(ACCOUNT_QUERY_KEY)).toEqual(ACCOUNT);
		expect(isInvalidated(queryClient, ACCOUNT_QUERY_KEY)).toBe(false);
	});
});

describe("showAdultMutationOptions", () => {
	it("on success it aligns the cache with the server's confirmed viewer", async () => {
		const queryClient = newClient();
		seed(queryClient);
		const confirmed: Viewer = { ...VIEWER, showAdult: true };

		await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({ updateShowAdult: async () => confirmed }),
				queryClient,
			),
			{ showAdult: true },
		);

		expect(viewerIn(queryClient)?.showAdult).toBe(true);
	});

	it("flips the switch optimistically while the request runs", async () => {
		const queryClient = newClient();
		seed(queryClient);
		let seenDuringRequest: boolean | undefined;

		await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({
					updateShowAdult: async (input) => {
						seenDuringRequest = viewerIn(queryClient)?.showAdult;
						return { ...VIEWER, showAdult: input.showAdult };
					},
				}),
				queryClient,
			),
			{ showAdult: true },
		);

		expect(seenDuringRequest).toBe(true);
	});

	/**
	 * Reached when the server rejects turning something on without eligibility. If not reverted, the
	 * switch stays on and draws a state the server refused as if it were true.
	 */
	it("on failure it reverts the optimistic value", async () => {
		const queryClient = newClient();
		seed(queryClient);

		const result = await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({
					updateShowAdult: async () => {
						throw new Error("refused");
					},
				}),
				queryClient,
			),
			{ showAdult: true },
		);

		expect(result).toBe("error");
		expect(viewerIn(queryClient)?.showAdult).toBe(false);
	});

	/**
	 * The most important assertion in this file. Turning off adult display changes the set of visible
	 * works itself. Cached adult works are not merely stale; they must not be shown, so invalidation
	 * (a stale mark) is not enough and the values must be gone.
	 */
	it("on success it drops gallery and story detail values (not an invalidation)", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({
					updateShowAdult: async () => ({ ...VIEWER, showAdult: false }),
				}),
				queryClient,
			),
			{ showAdult: false },
		);

		expect(queryClient.getQueryData(GALLERY_KEY)).toBeUndefined();
		expect(queryClient.getQueryData(DETAIL_KEY)).toBeUndefined();
	});

	/**
	 * Query entries are not removed. The detail screen uses useSuspenseQuery; if its entry disappears,
	 * the component waiting on it loses its observer and stays on the placeholder forever.
	 */
	it("the story detail query entry itself stays", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({
					updateShowAdult: async () => ({ ...VIEWER, showAdult: false }),
				}),
				queryClient,
			),
			{ showAdult: false },
		);

		expect(
			queryClient.getQueryCache().find({ queryKey: DETAIL_KEY }),
		).toBeDefined();
	});

	it("personalization and account caches are untouched", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			showAdultMutationOptions(
				clientOf({
					updateShowAdult: async () => ({ ...VIEWER, showAdult: true }),
				}),
				queryClient,
			),
			{ showAdult: true },
		);

		expect(queryClient.getQueryData(PERSONALIZATION_QUERY_KEY)).toEqual(
			PERSONALIZATION,
		);
		expect(queryClient.getQueryData(ACCOUNT_QUERY_KEY)).toEqual(ACCOUNT);
	});
});

/**
 * Checks that the account key actually sits under the ["viewer"] prefix. The point: login and
 * logout already clear the viewer prefix, so the account cell (which holds the email) is cleared
 * too. Otherwise the previous person's email could briefly show after an account switch, an
 * irreversible exposure.
 */
describe("account cache lifetime", () => {
	it("the account key is under the viewer prefix", () => {
		expect(ACCOUNT_QUERY_KEY.slice(0, VIEWER_QUERY_KEY.length)).toEqual([
			...VIEWER_QUERY_KEY,
		]);
	});

	it("sign-out cleanup clears account info", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await resetViewerState(queryClient);

		expect(queryClient.getQueryData(ACCOUNT_QUERY_KEY)).toBeUndefined();
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
	});

	it("sign-in cleanup clears account info", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await refreshViewerState(queryClient);

		expect(queryClient.getQueryData(ACCOUNT_QUERY_KEY)).toBeUndefined();
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeUndefined();
	});

	/**
	 * Confirms that invalidating by the viewer prefix actually reaches this cell; the batch depends on
	 * it.
	 */
	it("invalidating by the viewer prefix marks the account query stale too", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await queryClient.invalidateQueries({ queryKey: VIEWER_QUERY_KEY });

		expect(isInvalidated(queryClient, ACCOUNT_QUERY_KEY)).toBe(true);
		// Also checks that the prefix stops at the viewer axis; the gallery is a different axis.
		expect(isInvalidated(queryClient, GALLERY_KEY)).toBe(false);
	});
});
