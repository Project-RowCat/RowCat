import { describe, expect, it } from "vitest";
import type { ApiRequest, RowCatTransport } from "./client.ts";
import { createNotificationsApi } from "./notifications.ts";

/**
 * Contract boundary for notifications.
 *
 * This file is a net that always runs. API route tests skip without a real Postgres
 * (`describe.skipIf`), but this file swaps the transport, so it runs anywhere and breaking changes
 * fail here at minimum.
 *
 * The discriminated union must accept each kind with exactly its own fields, and reject a kind it
 * does not know rather than letting the defect move to render time.
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

const APP_UPDATE_ROW = {
	id: "n-app",
	createdAt: "2026-08-20T00:00:00.000Z",
	readAt: null,
	kind: "app_update",
	appPlatform: "ios",
	appVersion: "1.4.0",
};

const FOLLOW_ROW = {
	id: "n-follow",
	createdAt: "2026-08-20T00:00:00.000Z",
	readAt: null,
	kind: "follow",
	actor: { id: "m-bob", displayName: "Cat", avatarUrl: null },
};

const pageOf = (items: unknown[]) => ({ items, nextCursor: null });

describe("notification contract: kinds", () => {
	/** Kinds pass through unchanged, side by side. */
	it("known kinds pass as is", async () => {
		const { transport } = transportOf(() =>
			pageOf([FOLLOW_ROW, APP_UPDATE_ROW]),
		);
		const page = await createNotificationsApi(transport).list();
		expect(page.items.map((item) => item.kind)).toEqual([
			"follow",
			"app_update",
		]);
	});

	/**
	 * An unknown kind drops the whole response.
	 *
	 * The server removes such rows from its own list (`toDto` filters out null), so reaching this
	 * point means the server was deployed ahead of the contract. Failing then is better than rendering
	 * silently. Every other resource in this repo makes the same call.
	 */
	it("unknown kinds do not pass", async () => {
		const { transport } = transportOf(() =>
			pageOf([{ ...APP_UPDATE_ROW, kind: "carrier_pigeon" }]),
		);
		await expect(createNotificationsApi(transport).list()).rejects.toThrow();
	});

	/**
	 * An announcement has no slot for an actor, an address, or copy. This checks that absence by value.
	 */
	it("an actor or address attached to an announcement does not enter the model", async () => {
		const { transport } = transportOf(() =>
			pageOf([
				{ ...APP_UPDATE_ROW, actor: FOLLOW_ROW.actor, href: "itms-apps://x" },
			]),
		);
		const page = await createNotificationsApi(transport).list();
		expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
			["appPlatform", "appVersion", "createdAt", "id", "kind", "readAt"].sort(),
		);
	});
});

const PUBLISHED_ROW = {
	id: "n-published",
	createdAt: "2026-08-21T00:00:00.000Z",
	readAt: null,
	kind: "creator_story_published",
	actor: { id: "m-cat", displayName: "Cat", avatarUrl: null },
	story: { id: "s-new", title: "The Rewinding Night Shop" },
};

describe("notification contract: creator_story_published", () => {
	it("a row with an actor and a story passes as is", async () => {
		const { transport } = transportOf(() => pageOf([PUBLISHED_ROW]));
		const page = await createNotificationsApi(transport).list();
		const row = page.items[0];
		expect(row?.kind).toBe("creator_story_published");
		if (row?.kind !== "creator_story_published")
			throw new Error("different kind");
		expect(row.actor?.id).toBe("m-cat");
		expect(row.story).toEqual({
			id: "s-new",
			title: "The Rewinding Night Shop",
		});
	});

	/**
	 * A row whose story has disappeared passes through.
	 *
	 * The reference is `set null`, so this is the shape the server really sends. Dropping the row
	 * would let one row block the whole inbox.
	 */
	it("a row whose story is gone passes too", async () => {
		const { transport } = transportOf(() =>
			pageOf([{ ...PUBLISHED_ROW, story: null, actor: null }]),
		);
		const page = await createNotificationsApi(transport).list();
		const row = page.items[0];
		if (row?.kind !== "creator_story_published")
			throw new Error("different kind");
		expect(row.story).toBeNull();
		expect(row.actor).toBeNull();
	});

	/**
	 * Story content has no place in the model.
	 *
	 * Intro text, tags, cover, and rating are not used. A rating would force this row to know the
	 * adult-content display setting, a judgment the server's view gate already makes. Idempotency keys
	 * are excluded too: if the client began branching on the server's key, the key's format would
	 * become a deployment-ordering problem.
	 */
	it("story content and idempotency keys attached do not enter the model", async () => {
		const { transport } = transportOf(() =>
			pageOf([
				{
					...PUBLISHED_ROW,
					adult: true,
					tags: ["Time Rewind"],
					coverUrl: "https://example.test/cover.webp",
					sourceKey: "story-published:s-new",
					href: "/stories/s-new",
				},
			]),
		);
		const page = await createNotificationsApi(transport).list();
		expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
			["actor", "createdAt", "id", "kind", "readAt", "story"].sort(),
		);
	});

	it("the story object is only id and title", async () => {
		const { transport } = transportOf(() =>
			pageOf([
				{
					...PUBLISHED_ROW,
					story: { id: "s-new", title: "Title", description: "Intro" },
				},
			]),
		);
		const page = await createNotificationsApi(transport).list();
		const row = page.items[0];
		if (row?.kind !== "creator_story_published")
			throw new Error("different kind");
		expect(Object.keys(row.story ?? {}).sort()).toEqual(["id", "title"]);
	});
});
