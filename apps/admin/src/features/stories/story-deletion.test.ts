import { describe, expect, test } from "vitest";
import { storyDeletionView } from "./story-deletion.ts";

describe("storyDeletionView", () => {
	/** The server's gate is admin; do not draw a button that answers staff with 403. */
	test("no section for non-admins", () => {
		expect(storyDeletionView({ actionCount: 0 }, false)).toEqual({
			state: "hidden",
		});
	});

	/** Do not offer an operation the server rejects with 409; state the reason instead. */
	test("with action records it is a reason instead of a button", () => {
		const view = storyDeletionView({ actionCount: 2 }, true);
		expect(view.state).toBe("blocked");
		if (view.state === "blocked")
			expect(view.message).toContain("2 moderation");
	});

	/** The confirmation states the result up front. */
	test("says it deletes", () => {
		const view = storyDeletionView({ actionCount: 0 }, true);
		expect(view).toMatchObject({
			state: "ready",
			confirmLabel: "Delete story",
		});
		if (view.state === "ready") {
			expect(view.consequence).toContain("404");
			expect(view.consequence).toContain("can't be undone");
		}
	});

	/** "Everything is deleted" would be false; it names what survives. */
	test("says what remains", () => {
		const view = storyDeletionView({ actionCount: 0 }, true);
		if (view.state !== "ready") throw new Error("not ready");
		expect(view.consequence).toContain("Report records");
		expect(view.consequence).toContain("media originals");
	});
});
