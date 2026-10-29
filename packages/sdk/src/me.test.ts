import { describe, expect, it } from "vitest";
import type { ApiRequest, RowCatTransport } from "./client.ts";
import { isRowCatApiError } from "./errors.ts";
import { createMeApi } from "./me.ts";

/**
 * Contract boundary for the me and account resources, checked in two directions. Outgoing: a
 * structurally invalid request must not reach the network. Observing that requires recording calls,
 * so the transport is swapped for a recording one. Incoming: a 200 that differs from the contract
 * must not pass. This matters because the account response carries email and login methods. If the
 * server leaks internal auth values (user.id, tokens) and validation is skipped, they stick to
 * screen and cache.
 */

/**
 * Records requests. The other two capabilities are unused by this resource, so calling them fails
 * on the spot.
 */
function transportOf(reply: (request: ApiRequest) => unknown): {
	transport: RowCatTransport;
	sent: ApiRequest[];
} {
	const sent: ApiRequest[] = [];
	return {
		sent,
		transport: {
			requestJson: async (request) => {
				sent.push(request);
				return reply(request);
			},
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: () => Promise.reject(new Error("does not write")),
		},
	};
}

const meOf = (reply: (request: ApiRequest) => unknown) => {
	const { transport, sent } = transportOf(reply);
	return { api: createMeApi(transport), sent };
};

const VIEWER = {
	id: "member-1",
	nickname: "Cat",
	status: "approved",
	role: "user",
	verified: true,
	adult: true,
	showAdult: false,
	/**
	 * The age axis is only ever sent for the account itself. The contract requires these fields, so if
	 * they are missing here, validation drops the response. This is one side of the boundary this file
	 * guards: if the server omits the axis, the SDK does not let the response through.
	 */
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
};

const ACCOUNT = {
	email: "cat@example.test",
	emailVerified: false,
	hasPassword: true,
	twoFactorEnabled: false,
	methods: [
		{ provider: "credential", linkedAt: "2026-01-01T00:00:00.000Z" },
		{ provider: "google", linkedAt: "2026-02-01T00:00:00.000Z" },
	],
	createdAt: "2026-01-01T00:00:00.000Z",
};

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
	try {
		await run();
	} catch (error) {
		return isRowCatApiError(error) ? error.code : `unexpected:${String(error)}`;
	}
	return "no-error";
};

describe("me.account", () => {
	it("returns a contract-conforming response as is", async () => {
		const { api, sent } = meOf(() => ACCOUNT);
		expect(await api.account()).toEqual(ACCOUNT);
		expect(sent[0]?.path).toBe("/me/account");
		expect(sent[0]?.method).toBe("GET");
		// Neither the path nor the body has a slot for 'whose' the request is about.
		expect(sent[0]?.search).toBeUndefined();
		expect(sent[0]?.body).toBeUndefined();
	});

	/**
	 * A server that does not know this field (between deploy steps) has no two-step verification, so
	 * the response is read as off.
	 */
	it("a response without the two-factor field is off", async () => {
		const { twoFactorEnabled: _omitted, ...legacy } = ACCOUNT;
		const { api } = meOf(() => legacy);
		expect((await api.account()).twoFactorEnabled).toBe(false);
	});

	it("a malformed response is invalid_response", async () => {
		const { api } = meOf(() => ({ ...ACCOUNT, email: undefined }));
		expect(await codeOf(() => api.account())).toBe("invalid_response");
	});

	it("a sign-in method outside the vocabulary does not pass", async () => {
		const { api } = meOf(() => ({
			...ACCOUNT,
			methods: [{ provider: "naver", linkedAt: "2026-01-01T00:00:00.000Z" }],
		}));
		/**
		 * Stops here instead of rendering a provider it does not know. Rendering a label-less value would
		 * eventually show an internal string such as `providerId` to the user. The value used to be
		 * `kakao`: a method absent from the vocabulary made a good example. When Kakao actually arrived,
		 * `naver` took that slot. The test needs a value outside the vocabulary, not a specific provider.
		 * A commit that adds a method must also check this test, since a name that later takes the slot
		 * would silently flip the test.
		 */
		expect(await codeOf(() => api.account())).toBe("invalid_response");
	});

	/**
	 * The contract drops internal auth values even if the server leaks them by mistake. Without this
	 * assertion, 'not sent now' is the only guarantee, and it holds only until the next refactor.
	 */
	it("auth internals not in the contract vanish during parsing", async () => {
		const { api } = meOf(() => ({
			...ACCOUNT,
			userId: "auth-user-1",
			accountId: "google-123",
			password: "hash",
			accessToken: "token",
			sessionToken: "session",
			methods: [
				{
					provider: "google",
					linkedAt: "2026-02-01T00:00:00.000Z",
					accountId: "google-123",
					idToken: "id-token",
				},
			],
		}));

		const account = await api.account();
		expect(Object.keys(account).sort()).toEqual([
			"createdAt",
			"email",
			"emailVerified",
			"hasPassword",
			"methods",
			"twoFactorEnabled",
		]);
		expect(Object.keys(account.methods[0] ?? {}).sort()).toEqual([
			"linkedAt",
			"provider",
		]);
	});
});

describe("me.updateNickname", () => {
	it("sends the trimmed value and returns the confirmed viewer", async () => {
		const { api, sent } = meOf(() => ({ ...VIEWER, nickname: "NewName" }));

		expect(await api.updateNickname({ nickname: "  NewName  " })).toEqual({
			...VIEWER,
			nickname: "NewName",
		});
		expect(sent[0]?.method).toBe("PATCH");
		expect(sent[0]?.path).toBe("/me/nickname");
		// Sends the parsed result, not the raw input, so the length the server stores matches the length
		// the screen checked.
		expect(sent[0]?.body).toEqual({ nickname: "NewName" });
	});

	it("an empty nickname fails before sending", async () => {
		const { api, sent } = meOf(() => VIEWER);
		expect(await codeOf(() => api.updateNickname({ nickname: "   " }))).toBe(
			"invalid_request",
		);
		// Asserting that no round trip happens is the point of this check.
		expect(sent).toHaveLength(0);
	});

	it("a too-long nickname also fails before sending", async () => {
		const { api, sent } = meOf(() => VIEWER);
		expect(
			await codeOf(() => api.updateNickname({ nickname: "a".repeat(21) })),
		).toBe("invalid_request");
		expect(sent).toHaveLength(0);
	});

	it("a malformed response is invalid_response", async () => {
		const { api } = meOf(() => ({ nickname: "NewName" }));
		expect(
			await codeOf(() => api.updateNickname({ nickname: "NewName" })),
		).toBe("invalid_response");
	});
});

describe("me.updateShowAdult", () => {
	it("returns the confirmed viewer", async () => {
		const { api, sent } = meOf(() => ({ ...VIEWER, showAdult: true }));

		expect(await api.updateShowAdult({ showAdult: true })).toEqual({
			...VIEWER,
			showAdult: true,
		});
		expect(sent[0]?.path).toBe("/me/show-adult");
		expect(sent[0]?.body).toEqual({ showAdult: true });
	});

	/**
	 * A response from an old server that does not know this axis is read as 'no re-confirmation
	 * required'. That server does not actually gate viewing, so the reading is correct. Dropping the
	 * response would remove every adult viewer during rollout.
	 */
	it("an old response without the recheck axis reads as false", async () => {
		const { adultRecheckRequired: _omitted, ...legacy } = VIEWER;
		const { api } = meOf(() => legacy);
		expect(await api.updateShowAdult({ showAdult: false })).toEqual(VIEWER);
	});

	it("a non-boolean value fails before sending", async () => {
		const { api, sent } = meOf(() => VIEWER);
		expect(
			await codeOf(() =>
				// Simulates a value that bypasses the contract, such as one from a call site in another
				// language or a serialization bug.
				api.updateShowAdult({ showAdult: "yes" as unknown as boolean }),
			),
		).toBe("invalid_request");
		expect(sent).toHaveLength(0);
	});

	it("a malformed response is invalid_response", async () => {
		const { api } = meOf(() => null);
		expect(await codeOf(() => api.updateShowAdult({ showAdult: false }))).toBe(
			"invalid_response",
		);
	});
});

const ANALYTICS_WORK = {
	id: "story-1",
	title: "The Night Library",
	visibility: "private",
	hidden: false,
	views: 8240,
	playStarts: 910,
	favorites: 260,
	comments: 61,
	windowViews: 8240,
	windowPlayStarts: 910,
	updatedAt: "2026-03-01T00:00:00.000Z",
};

const ANALYTICS = {
	summary: {
		views: 12450,
		playStarts: 1320,
		favorites: 384,
		comments: 92,
		windowViews: 12450,
		windowPlayStarts: 1320,
	},
	items: [ANALYTICS_WORK],
	total: 1,
	page: 1,
	pageSize: 24,
	pageCount: 1,
	window: "all",
	since: null,
};

/**
 * The projection boundary for analytics responses, guarded once more on the client. The server
 * assertions (`routes/me/creator-analytics.test.ts`) need a real Postgres and are skipped entirely
 * (`describe.skipIf`) without one. If that were the only guard, CI without a database would guard
 * nothing. This check covers the contract schema itself, so it always runs.
 */
describe("me.creatorAnalytics", () => {
	it("returns a contract-conforming response as is", async () => {
		const { api, sent } = meOf(() => ANALYTICS);
		expect(await api.creatorAnalytics()).toEqual(ANALYTICS);
		expect(sent[0]?.path).toBe("/me/creator-analytics");
		expect(sent[0]?.method).toBe("GET");
		// The target member has no slot in the path or the query; the default query is empty.
		expect(sent[0]?.search?.toString()).toBe("");
	});

	/**
	 * Default values are kept out of the URL: the same query sent under two URLs would split the
	 * cache.
	 */
	it("the default page is not in the address; only the next page is", async () => {
		const { api, sent } = meOf(() => ANALYTICS);
		await api.creatorAnalytics({ page: 1 });
		await api.creatorAnalytics({ page: 2 });
		expect(sent[0]?.search?.toString()).toBe("");
		expect(sent[1]?.search?.toString()).toBe("page=2");
	});

	/**
	 * The most important assertion for this resource in this file. If the server accidentally leaks a
	 * work row or a join result, fields outside the contract are dropped here. Three kinds matter
	 * most: the work body (playback payload), viewer identity (who viewed or saved it), and metrics
	 * that are not measured (`downloads`, `chatStarts`). If the last ones leaked, the screen would
	 * start drawing them as `Downloads` (download), and the product would appear to measure what it does
	 * not. Play starts arrive only as `playStarts`: a fact the device reports after it sets up the
	 * session, not the 200 of `/play`.
	 */
	it("drops fields outside the contract", async () => {
		const { api } = meOf(() => ({
			...ANALYTICS,
			summary: { ...ANALYTICS.summary, downloads: 77, chatStarts: 12 },
			items: [
				{
					...ANALYTICS_WORK,
					downloads: 77,
					chatStarts: 12,
					plays: 3,
					playPayload: { scenario: "A body that must not leak" },
					viewers: ["member-9"],
					favoritedBy: ["member-9"],
					commenters: ["member-9"],
					owner: "member-1",
				},
			],
		}));

		const analytics = await api.creatorAnalytics();
		expect(Object.keys(analytics.items[0] ?? {}).sort()).toEqual([
			"comments",
			"favorites",
			"hidden",
			"id",
			"playStarts",
			"title",
			"updatedAt",
			"views",
			"visibility",
			"windowPlayStarts",
			"windowViews",
		]);
		expect(Object.keys(analytics.summary).sort()).toEqual([
			"comments",
			"favorites",
			"playStarts",
			"views",
			"windowPlayStarts",
			"windowViews",
		]);
		expect(JSON.stringify(analytics)).not.toContain(
			"A body that must not leak",
		);
		expect(JSON.stringify(analytics)).not.toContain("member-9");
	});

	/** Metrics that are not counts are rejected, since the screen draws them as-is. */
	it("does not pass a 200 that breaks the contract", async () => {
		const { api } = meOf(() => ({
			...ANALYTICS,
			items: [{ ...ANALYTICS_WORK, views: "Many" }],
		}));
		expect(await codeOf(() => api.creatorAnalytics())).toBe("invalid_response");
	});

	/**
	 * A response missing the totals entirely is also rejected. Missing values are not filled with 0.
	 */
	it("does not fill a response without totals with 0", async () => {
		const { api } = meOf(() => ({ ...ANALYTICS, summary: undefined }));
		expect(await codeOf(() => api.creatorAnalytics())).toBe("invalid_response");
	});
});

const INBOX_ITEM = {
	comment: {
		id: "c1",
		storyId: "s1",
		parentId: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		replyCount: 0,
		state: "visible",
		author: { id: "member-2", nickname: "Carol", avatarUrl: null },
		body: "Loved it",
		likeCount: 0,
		viewerLiked: false,
	},
	story: { id: "s1", title: "My story", visibility: "public", hidden: false },
} as const;

describe("me.creatorComments", () => {
	it("returns a conforming response as is and names no target member", async () => {
		const page = { items: [INBOX_ITEM], nextCursor: "next" };
		const { api, sent } = meOf(() => page);
		expect(await api.creatorComments()).toEqual(page);
		expect(sent[0]?.path).toBe("/me/creator-comments");
		expect(sent[0]?.method).toBe("GET");
		expect(sent[0]?.search?.toString()).toBe("");
	});

	/** The next page carries the server's cursor as-is. The client never builds a cursor. */
	it("carries the cursor as is and leaves the default page size out of the address", async () => {
		const { api, sent } = meOf(() => ({ items: [], nextCursor: null }));
		await api.creatorComments({ cursor: "opaque==" });
		expect(sent[0]?.search?.toString()).toBe("cursor=opaque%3D%3D");
	});

	/**
	 * A response with tombstones mixed in is rejected whole. The inbox carries only live statements
	 * (the same set as the comment count in analytics). If that line passed, the screen would draw a
	 * line with nothing to read.
	 */
	it("does not pass a 200 mixed with tombstones", async () => {
		const { api } = meOf(() => ({
			items: [
				{
					comment: {
						id: "c2",
						storyId: "s1",
						parentId: null,
						createdAt: "2026-09-01T00:00:00.000Z",
						replyCount: 1,
						state: "deleted",
					},
					story: INBOX_ITEM.story,
				},
			],
			nextCursor: null,
		}));
		expect(await codeOf(() => api.creatorComments())).toBe("invalid_response");
	});

	/**
	 * Even if a work row leaks whole, fields outside the contract (playback payload, owner) are
	 * dropped.
	 */
	it("drops fields outside the contract", async () => {
		const { api } = meOf(() => ({
			items: [
				{
					...INBOX_ITEM,
					story: {
						...INBOX_ITEM.story,
						owner: "member-1",
						playPayload: { scenario: "A body that must not leak" },
					},
					reportCount: 3,
				},
			],
			nextCursor: null,
		}));
		const page = await api.creatorComments();
		expect(Object.keys(page.items[0]?.story ?? {}).sort()).toEqual([
			"hidden",
			"id",
			"title",
			"visibility",
		]);
		expect(JSON.stringify(page)).not.toContain("A body that must not leak");
		expect(JSON.stringify(page)).not.toContain("reportCount");
	});
});

/*
 * Account security: password setting, login method disconnection, and sessions. What this section
 * guards is the incoming side. The server tests guard the same boundary, but they skip without a
 * real Postgres (`describe.skipIf`), so an always-running net is needed here too. Creator analytics
 * has the same pairing for the same reason.
 */

const SESSIONS = {
	sessions: [
		{
			id: "session-current",
			current: true,
			createdAt: "2026-08-01T00:00:00.000Z",
			expiresAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "session-other",
			current: false,
			createdAt: "2026-07-01T00:00:00.000Z",
			expiresAt: "2026-08-30T00:00:00.000Z",
		},
	],
};

describe("me.setPassword", () => {
	it("a length violation never reaches the network", async () => {
		const { api, sent } = meOf(() => ACCOUNT);
		expect(await codeOf(() => api.setPassword({ newPassword: "short" }))).toBe(
			"invalid_request",
		);
		expect(sent).toHaveLength(0);
	});

	/**
	 * The password is not trimmed. Changing even one character would make the stored value differ from
	 * what the user typed, and the account would no longer log in with the password it knows.
	 */
	it("the value sent is the original", async () => {
		const { api, sent } = meOf(() => ACCOUNT);
		const raw = "  padded-secret-value  ";
		await api.setPassword({ newPassword: raw });
		expect(sent[0]?.body).toEqual({ newPassword: raw });
		expect(sent[0]?.path).toBe("/me/account/password");
	});

	/**
	 * The failure message does not include the input, because that string leaks into error reporters
	 * and the console.
	 */
	it("the refusal copy has no password", async () => {
		const { api } = meOf(() => ACCOUNT);
		const secret = "tiny";
		try {
			await api.setPassword({ newPassword: secret });
			expect.unreachable();
		} catch (error) {
			expect(isRowCatApiError(error) ? error.message : "").not.toContain(
				secret,
			);
		}
	});

	it("a 200 that breaks the contract does not pass", async () => {
		const { api } = meOf(() => ({ hasPassword: true }));
		expect(
			await codeOf(() =>
				api.setPassword({ newPassword: "correct-horse-battery" }),
			),
		).toBe("invalid_response");
	});
});

describe("me.disconnectLoginMethod", () => {
	it("a provider outside the vocabulary never reaches the network", async () => {
		const { api, sent } = meOf(() => ACCOUNT);
		expect(
			await codeOf(() =>
				// biome-ignore lint/suspicious/noExplicitAny: the check is whether a value outside the contract gets rejected.
				api.disconnectLoginMethod({ provider: "naver" as any }),
			),
		).toBe("invalid_request");
		expect(sent).toHaveLength(0);
	});

	it("returns the confirmed account", async () => {
		const { api, sent } = meOf(() => ACCOUNT);
		expect(await api.disconnectLoginMethod({ provider: "google" })).toEqual(
			ACCOUNT,
		);
		expect(sent[0]?.path).toBe("/me/account/login-methods/disconnect");
		expect(sent[0]?.body).toEqual({ provider: "google" });
	});
});

describe("me.sessions", () => {
	it("returns the list", async () => {
		const { api, sent } = meOf(() => SESSIONS);
		expect(await api.sessions()).toEqual(SESSIONS.sessions);
		expect(sent[0]?.method).toBe("GET");
		expect(sent[0]?.path).toBe("/me/account/sessions");
	});

	/**
	 * The most important assertion in this file. If the server accidentally leaks a library session
	 * row whole, it contains the session token. The schema drops fields outside the contract, so the
	 * value stops here. If it did not stop, other devices' sessions would sit in browser memory and
	 * query devtools, and the HttpOnly session cookie would lose its meaning.
	 */
	it("a session token the server leaked does not pass", async () => {
		const { api } = meOf(() => ({
			sessions: [
				{
					...SESSIONS.sessions[0],
					token: "leaked-session-token",
					userId: "auth-user-1",
					ipAddress: "203.0.113.7",
					userAgent: "Mozilla/5.0",
				},
			],
		}));
		const sessions = await api.sessions();
		expect(Object.keys(sessions[0] ?? {}).sort()).toEqual([
			"createdAt",
			"current",
			"expiresAt",
			"id",
		]);
		expect(JSON.stringify(sessions)).not.toContain("leaked-session-token");
		expect(JSON.stringify(sessions)).not.toContain("auth-user-1");
	});

	it("a 200 that breaks the contract does not pass", async () => {
		const { api } = meOf(() => ({ sessions: [{ id: "x" }] }));
		expect(await codeOf(() => api.sessions())).toBe("invalid_response");
	});
});

describe("me.revokeSession", () => {
	it("returns the list after the change", async () => {
		const { api, sent } = meOf(() => SESSIONS);
		expect(await api.revokeSession({ sessionId: "session-other" })).toEqual(
			SESSIONS.sessions,
		);
		expect(sent[0]?.body).toEqual({ sessionId: "session-other" });
	});

	it("an empty reference never reaches the network", async () => {
		const { api, sent } = meOf(() => SESSIONS);
		expect(await codeOf(() => api.revokeSession({ sessionId: "" }))).toBe(
			"invalid_request",
		);
		expect(sent).toHaveLength(0);
	});
});

describe("me.revokeOtherSessions", () => {
	/**
	 * The body is not sent. Even an empty object would eventually gain a field deciding what to keep,
	 * and that field would become a parameter that keeps others' sessions alive or ends one's own.
	 */
	it("goes out without a body", async () => {
		const { api, sent } = meOf(() => SESSIONS);
		await api.revokeOtherSessions();
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.path).toBe("/me/account/sessions/revoke-others");
		expect(sent[0]?.body).toBeUndefined();
	});
});

describe("scene image upload", () => {
	const asset = {
		mediaId: "media-1",
		url: "https://api.example/v2/media/media-1",
		width: 800,
		height: 600,
	};

	it("puts the bytes in the body as is; no base64 wrapping", async () => {
		const { api, sent } = meOf(() => ({ asset }));
		const file = new Blob(["bytes"], { type: "image/png" });

		await api.uploadSceneImage(file);

		expect(sent[0]).toMatchObject({
			method: "POST",
			path: "/me/scene-images",
			rawBody: file,
			contentType: "image/png",
		});
		/** Not a JSON body: with no fields, there is no slot for the owner either. */
		expect(sent[0]?.body).toBeUndefined();
	});

	it("a file without a stated type still gets the header", async () => {
		const { api, sent } = meOf(() => ({ asset }));
		await api.uploadSceneImage(new Blob(["bytes"]));
		expect(sent[0]?.contentType).toBe("application/octet-stream");
	});

	it("a 200 that breaks the contract does not pass", async () => {
		const { api } = meOf(() => ({ asset: { mediaId: "media-1" } }));
		await expect(api.uploadSceneImage(new Blob(["bytes"]))).rejects.toSatisfy(
			isRowCatApiError,
		);
	});

	it("the response has four keys; storage key, owner and status do not leak", async () => {
		const { api } = meOf(() => ({ asset }));
		const received = await api.uploadSceneImage(new Blob(["bytes"]));
		expect(Object.keys(received).sort()).toEqual([
			"height",
			"mediaId",
			"url",
			"width",
		]);
	});
});

describe("me.setPinnedStories", () => {
	const WORK = {
		id: "story-1",
		originDraftId: null,
		title: "Featured",
		visibility: "private",
		adult: false,
		promptProtected: false,
		hidden: false,
		coverUrl: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
	};

	it("PUTs one final list and returns the list the server confirmed", async () => {
		const { api, sent } = meOf(() => ({ items: [WORK] }));
		const result = await api.setPinnedStories({ storyIds: ["story-1"] });
		expect(sent[0]).toMatchObject({
			method: "PUT",
			path: "/me/pinned-stories",
			body: { storyIds: ["story-1"] },
		});
		/**
		 * Does not fabricate the result from the sent id: the title and visibility come from the
		 * response.
		 */
		expect(result).toEqual([WORK]);
	});

	it("duplicates and over-cap lists are blocked before sending", async () => {
		const { api, sent } = meOf(() => ({ items: [] }));
		await expect(
			api.setPinnedStories({ storyIds: ["a", "a"] }),
		).rejects.toSatisfy(isRowCatApiError);
		await expect(
			api.setPinnedStories({ storyIds: ["a", "b", "c", "d"] }),
		).rejects.toSatisfy(isRowCatApiError);
		expect(sent).toEqual([]);
	});

	it("a response that is not the owner projection is invalid_response", async () => {
		const { api } = meOf(() => ({ items: [{ id: "story-1" }] }));
		await expect(api.pinnedStories()).rejects.toMatchObject({
			code: "invalid_response",
		});
	});
});
