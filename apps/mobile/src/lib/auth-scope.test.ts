import type { Viewer } from "@rowcat/domain";
import { VIEWER_QUERY_KEY } from "@rowcat/query";
import type { RowCatClient } from "@rowcat/sdk";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../test/sqlite-node.ts";
import type { LocalScopeController } from "./local-data/activation.ts";
import { viewerDatabaseName } from "./local-data/database.ts";
import { completeAuthentication } from "./session-transition.ts";

/**
 * **Which identity picks the local data — this file's assertion is that one thing.**
 *
 * ```text
 * Better Auth user.id   the **sign-in method's** identifier
 * Viewer.id (/v2/me)    the product's ownership identity — works, favorites and the sync namespace are all this
 * ```
 *
 * Opening the SQLite file from the Better Auth `user.id` would make that file **permanently
 * separate** from every other RowCat resource. And the mismatch is silent: sign-in works and the
 * screen opens, and it surfaces only when adding a second sign-in method (or reissuing the auth
 * account) makes that person's conversations appear to vanish all at once. There is no way to undo
 * it.
 *
 * `isolation.test.ts` guards "Alice's and Bob's files differ"; here we guard **where Alice comes
 * from**.
 */

/** Auth account id and member id are **different values**. The server actually answers that way. */
const AUTH_USER_A = "auth-user-1a2b3c";
const AUTH_USER_B = "auth-user-9z8y7x";

const MEMBER_A = "member-aaaa1111";
const MEMBER_B = "member-bbbb2222";

const viewerOf = (id: string, nickname: string): Viewer => ({
	id,
	nickname,
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
});

/**
 * Auth account → member. The table stands in for what the server's `ensureMember` does. **The
 * property this verifies is that the call site cannot skip this table.**
 */
const MEMBERS: Record<string, Viewer> = {
	[AUTH_USER_A]: viewerOf(MEMBER_A, "Alice"),
	[AUTH_USER_B]: viewerOf(MEMBER_B, "Bob"),
};

/** Auth account the current session cookie points to. No value means guest. */
let signedInAs: string | null = null;

const client = {
	me: {
		get: async (): Promise<Viewer | null> =>
			signedInAs ? (MEMBERS[signedInAs] ?? null) : null,
	},
} as unknown as RowCatClient;

let queryClient: QueryClient;
let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

beforeEach(() => {
	signedInAs = null;
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
	queryClient.clear();
});

/**
 * Follows the same order the app does after sign-in. The point here is not passing the auth account
 * id into the scope — and there is no way to: the completion procedure returns only the member.
 */
const signIn = async (authUserId: string) => {
	signedInAs = authUserId;
	const viewer = await completeAuthentication({
		queryClient,
		client,
		signOut: async () => {},
	});
	return controller.activate(viewer.id);
};

describe("the identity that picks the local scope", () => {
	it("the member id picks the file, not the auth account id", async () => {
		const scope = await signIn(AUTH_USER_A);

		expect(scope.viewerId).toBe(MEMBER_A);
		expect(scope.viewerId).not.toBe(AUTH_USER_A);
		expect(viewerDatabaseName(scope.viewerId)).toBe(
			viewerDatabaseName(MEMBER_A),
		);
		expect(viewerDatabaseName(scope.viewerId)).not.toBe(
			viewerDatabaseName(AUTH_USER_A),
		);
	});

	it("the identity in the query cache is the member id too", async () => {
		await signIn(AUTH_USER_A);
		expect(queryClient.getQueryData<Viewer | null>(VIEWER_QUERY_KEY)?.id).toBe(
			MEMBER_A,
		);
	});

	/**
	 * Two auth accounts → two members → two files. If any link in this chain changed to the auth
	 * identity, this assertion could still pass, so read it **together with** the `not.toBe` above.
	 */
	it("different accounts don't carry data over", async () => {
		const alice = await signIn(AUTH_USER_A);
		const room = await alice.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});

		const bob = await signIn(AUTH_USER_B);

		expect(bob.viewerId).toBe(MEMBER_B);
		expect(await bob.stores.chat.listRooms()).toEqual([]);
		expect(await bob.stores.chat.getRoom(room.id)).toBeNull();
	});

	/**
	 * Sign-out **closes access**; it does not erase. Signing in again yields the same member id, and
	 * the same member id opens the same file — a new connection, same contents.
	 */
	it("signing in again with the same account opens the same data", async () => {
		const first = await signIn(AUTH_USER_A);
		await first.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});

		await controller.release();
		signedInAs = null;

		const again = await signIn(AUTH_USER_A);

		expect(again).not.toBe(first);
		expect(again.db).not.toBe(first.db);
		expect((await again.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"Alice's room",
		]);
	});

	/**
	 * The auth account changed but the member is the same (the person added another sign-in method):
	 * **the same file** opens. If the file name had been tied to the auth identity, this person would
	 * lose their conversations the moment they changed sign-in method.
	 */
	it("the same member is the same file even with a different auth account", async () => {
		const viaPassword = await signIn(AUTH_USER_A);
		await viaPassword.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});
		await controller.release();

		// The same person came back with Google — the auth account id differs, the member is the same.
		const SECOND_AUTH_ACCOUNT = "auth-user-google-alice";
		MEMBERS[SECOND_AUTH_ACCOUNT] = viewerOf(MEMBER_A, "Alice");

		const viaGoogle = await signIn(SECOND_AUTH_ACCOUNT);

		expect(viaGoogle.viewerId).toBe(MEMBER_A);
		expect(
			(await viaGoogle.stores.chat.listRooms()).map((r) => r.title),
		).toEqual(["Alice's room"]);
	});

	/**
	 * If `/me` returns no member, **no file is opened at all.** Inventing an identity from the
	 * session's user object to open a database would produce a file tied to no server resource.
	 */
	it("without a member the scope doesn't open", async () => {
		signedInAs = "auth-user-without-member";

		await expect(
			completeAuthentication({
				queryClient,
				client,
				signOut: async () => {},
			}),
		).rejects.toMatchObject({ failure: "session_without_viewer" });

		expect(controller.current()).toBeNull();
	});
});
