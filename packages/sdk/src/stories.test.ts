import { describe, expect, it } from "vitest";
import type { ApiRequest, RowCatTransport } from "./client.ts";
import { isRowCatApiError } from "./errors.ts";
import { createStoriesApi } from "./stories.ts";

/**
 * Contract boundary for the cover resource. This file guards one thing: binary requests must not
 * silently break.
 *
 * Most mistakes fail loudly (a missing field makes parsing reject). Image bytes leaking into `body`
 * look like a successful request instead. `JSON.stringify(blob)` does not throw; it yields the two
 * characters `{}`, and the server receives those two characters instead of the image. The symptom
 * appears nowhere on the client and surfaces only as a server 400 (decode failure), so whoever
 * investigates starts in the image pipeline.
 *
 * The test therefore checks by identity (`toBe`) that the same Blob object went into `rawBody`, and
 * that the `body` slot is empty. Either check alone is insufficient. The first passes a state where
 * both slots are filled; the second passes a state where wrong bytes are filled.
 *
 * No network is used. Swapping the transport makes what was sent observable, which is all this
 * layer can verify. Whether the bytes reach the server is the API test's job.
 */

/**
 * A transport that records each request. The other two capabilities are not used by this resource's
 * cover path.
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

const storiesOf = (reply: (request: ApiRequest) => unknown) => {
	const { transport, sent } = transportOf(reply);
	return { api: createStoriesApi(transport), sent };
};

const STORY = {
	id: "story-1",
	title: "The Night Library",
	description: "Late Night with the Librarian",
	author: "Cat",
	coverUrl: "https://api.test/v2/stories/story-1/cover?v=abcdef0123456789",
	orientation: null,
	adult: false,
	visibility: "private",
	promptProtected: false,
	tags: ["Fantasy"],
	favorites: 12,
	creator: { id: "member-1", nickname: "Cat" },
	playMode: "chat",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-03-01T00:00:00.000Z",
	sizeBytes: 4096,
};

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
	try {
		await run();
	} catch (error) {
		return isRowCatApiError(error) ? error.code : `unexpected:${String(error)}`;
	}
	return "no-error";
};

/** Mimics a real file. Both typed and untyped files actually arrive. */
const imageOf = (type: string) =>
	new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type });

describe("stories.setCover", () => {
	/**
	 * The most important assertion in this file.
	 *
	 * Identity (`toBe`) is used because value comparison would miss this mistake. A Blob that leaks
	 * into the `body` slot becomes the string "{}" after `JSON.stringify`. That is normal
	 * serialization, not an exception, so the request goes out unchanged. The failure only shows as a
	 * server decode error, which looks the same as uploading a corrupted image.
	 */
	it("puts the bytes in rawBody as is and leaves body empty", async () => {
		const { api, sent } = storiesOf(() => ({ story: STORY }));
		const image = imageOf("image/png");

		await api.setCover("story-1", image);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("PUT");
		expect(sent[0]?.path).toBe("/stories/story-1/cover");
		// The same object goes through: no copy, no wrapping, no serialization.
		expect(sent[0]?.rawBody).toBe(image);
		expect(sent[0]?.contentType).toBe("image/png");
		/** The JSON slot must be empty so the transport does not take the `JSON.stringify` path. */
		expect(sent[0]?.body).toBeUndefined();
	});

	/**
	 * A file with no extension has an empty `type` string. Sent as-is, the header disappears entirely.
	 * fetch then picks a type or none, and the server logs lose the clue about what was uploaded. The
	 * server's judgment depends on the bytes anyway. The fallback is `application/octet-stream`.
	 */
	it("a file without a type is sent as application/octet-stream", async () => {
		const { api, sent } = storiesOf(() => ({ story: STORY }));
		const image = imageOf("");

		await api.setCover("story-1", image);

		expect(sent[0]?.contentType).toBe("application/octet-stream");
		expect(sent[0]?.rawBody).toBe(image);
	});

	/**
	 * An id containing `/` or `?` breaks the path entirely and could overwrite another story's cover.
	 */
	it("encodes the story id in the path", async () => {
		const { api, sent } = storiesOf(() => ({ story: STORY }));

		await api.setCover("a/b?c", imageOf("image/webp"));

		expect(sent[0]?.path).toBe("/stories/a%2Fb%3Fc/cover");
	});

	it("returns the story after the change", async () => {
		const { api } = storiesOf(() => ({ story: STORY }));
		await expect(
			api.setCover("story-1", imageOf("image/jpeg")),
		).resolves.toEqual(STORY);
	});

	/**
	 * Does not trust a 200 blindly. This value becomes the screen's `<img src>`. If a mismatched shape
	 * passed, a broken image that looks like a changed cover would be cached.
	 */
	it("a malformed response is invalid_response", async () => {
		const { api } = storiesOf(() => ({ story: { ...STORY, coverUrl: 42 } }));
		expect(
			await codeOf(() => api.setCover("story-1", imageOf("image/png"))),
		).toBe("invalid_response");

		const error = await api
			.setCover("story-1", imageOf("image/png"))
			.catch((cause: unknown) => cause);
		expect(isRowCatApiError(error)).toBe(true);
		/** States which verb the failure came from, so PUT and DELETE failures are not mixed. */
		expect(String(error)).toContain("PUT /stories/:id/cover");
	});

	it("passes the abort signal through", async () => {
		const { api, sent } = storiesOf(() => ({ story: STORY }));
		const controller = new AbortController();

		await api.setCover("story-1", imageOf("image/png"), {
			signal: controller.signal,
		});

		expect(sent[0]?.signal).toBe(controller.signal);
	});
});

describe("stories.removeCover", () => {
	it("sends DELETE to the same address without a body", async () => {
		const { api, sent } = storiesOf(() => ({
			story: { ...STORY, coverUrl: null },
		}));

		await expect(api.removeCover("story-1")).resolves.toEqual({
			...STORY,
			coverUrl: null,
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("DELETE");
		expect(sent[0]?.path).toBe("/stories/story-1/cover");
		/**
		 * DELETE has nothing to send. A made-up `{}` that the server does not read would signal that the
		 * endpoint takes input, and that false signal would harden into the contract.
		 */
		expect(sent[0]?.body).toBeUndefined();
		expect(sent[0]?.rawBody).toBeUndefined();
		expect(sent[0]?.contentType).toBeUndefined();
	});

	it("encodes the story id in the path", async () => {
		const { api, sent } = storiesOf(() => ({
			story: { ...STORY, coverUrl: null },
		}));
		await api.removeCover("a/b?c");
		expect(sent[0]?.path).toBe("/stories/a%2Fb%3Fc/cover");
	});

	/**
	 * Delete failures must not be silent either. The screen does not set `coverUrl` to `null` itself;
	 * it draws the story the server confirmed, so a passing garbage value would become the screen's
	 * state.
	 */
	it("a malformed response is invalid_response", async () => {
		const { api } = storiesOf(() => ({ removed: true }));
		const error = await api
			.removeCover("story-1")
			.catch((cause: unknown) => cause);

		expect(isRowCatApiError(error)).toBe(true);
		expect(isRowCatApiError(error) ? error.code : null).toBe(
			"invalid_response",
		);
		expect(String(error)).toContain("DELETE /stories/:id/cover");
	});

	it("passes the abort signal through", async () => {
		const { api, sent } = storiesOf(() => ({
			story: { ...STORY, coverUrl: null },
		}));
		const controller = new AbortController();

		await api.removeCover("story-1", { signal: controller.signal });

		expect(sent[0]?.signal).toBe(controller.signal);
	});
});

/**
 * The address and body of the four transitions.
 *
 * Silent breakage is the risk here as well. The four methods share one helper, so if one path
 * fragment is off, another transition goes out. Pressing `archive` would send `Restore`.
 * The response is still `{ story }`, so parsing and the success display both pass, and the mismatch
 * shows only after the user refreshes the list.
 *
 * The absence of a body is checked too. If a destination were carried in the body, a forbidden
 * transition could be expressed as a request, and blocking it would rest on a single server branch.
 * The contract removed that slot for this reason.
 */
describe("stories lifecycle", () => {
	const reply = () => ({ story: STORY });

	it.each([
		["makePublic", "publish"],
		["makeUnlisted", "unlist"],
		["makePrivate", "unpublish"],
		["archive", "archive"],
		["restore", "restore"],
	] as const)("%s POSTs to /%s", async (method, segment) => {
		const { api, sent } = storiesOf(reply);
		await api[method]("story-1");

		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.path).toBe(`/stories/story-1/${segment}`);
	});

	it("carries no body; the path states the destination", async () => {
		const { api, sent } = storiesOf(reply);
		await api.archive("story-1");
		expect(sent[0]?.body).toBeUndefined();
		expect(sent[0]?.rawBody).toBeUndefined();
	});

	it("encodes the story id in the path", async () => {
		const { api, sent } = storiesOf(reply);
		await api.restore("a/b?c");
		expect(sent[0]?.path).toBe("/stories/a%2Fb%3Fc/restore");
	});

	it("returns the story after the change", async () => {
		/**
		 * A whole story comes back, not an axis such as `{ visibility: … }`. The return type exists so
		 * the screen does not assemble its own cache from that value.
		 */
		const { api } = storiesOf(reply);
		expect(await api.makePublic("story-1")).toEqual(STORY);
	});

	it("a malformed response is invalid_response", async () => {
		const { api } = storiesOf(() => ({ visibility: "archived" }));
		expect(await codeOf(() => api.archive("story-1"))).toBe("invalid_response");
	});

	it("passes the abort signal through", async () => {
		const controller = new AbortController();
		const { api, sent } = storiesOf(reply);
		await api.makePrivate("story-1", { signal: controller.signal });
		expect(sent[0]?.signal).toBe(controller.signal);
	});
});
