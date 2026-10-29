import {
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import { STORY_LIFECYCLE_ACTIONS } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	workLifecycleConfirm,
	workLifecycleErrorMessage,
	workLifecycleLabel,
} from "./lifecycle.ts";

/**
 * Lifecycle copy for the `Published` row. Every string here is a promise, so tests pin exact values.
 * The confirm copy is the last sentence read before a hard-to-undo press. If it disagrees with real
 * behavior, the user is harmed in the direction they cannot reverse. Three invariants:
 * - The archive copy states that it is not deleted. `Archived` reads as deletion to most people.
 * - The archive confirm warns that restore returns the work to private. Restore has no confirm,
 *   so this promise must be read before archiving.
 * - No copy implies a review step. There is no pre-review, so such words are false.
 */

/**
 * Words that imply a review step this product does not have: `review requested`, `awaiting review`, `approval`, `pending`,
 * `coming soon`. If any of them appears in the copy, the copy is false.
 */
const REVIEW_WORDS = [
	"review requested",
	"awaiting review",
	"approv",
	"pending",
	"coming soon",
];

describe("workLifecycleConfirm", () => {
	it("only publish and archive ask for confirmation", () => {
		/**
		 * Not every action gets a confirm. An always-on confirm stops being read, and the confirms that
		 * matter go unread too. Unpublish is not confirmed: a mistaken press is undone by publishing
		 * again.
		 */
		expect(workLifecycleConfirm("publish", "Title")).not.toBeNull();
		expect(workLifecycleConfirm("archive", "Title")).not.toBeNull();
		expect(workLifecycleConfirm("unpublish", "Title")).toBeNull();
		expect(workLifecycleConfirm("restore", "Title")).toBeNull();
	});

	it("the confirmation names its target", () => {
		/**
		 * Confirm copy must name the work by title, not `this story`. After a list reorder, `this story` cannot tell
		 * the user which row was pressed.
		 */
		for (const action of ["publish", "archive"] as const)
			expect(
				workLifecycleConfirm(action, "The Night Library")?.title,
			).toContain("The Night Library");
	});

	it("the archive confirmation says it is **not deleted** and that metrics remain", () => {
		const confirm = workLifecycleConfirm("archive", "Title");
		const text = confirm?.lines.join(" ") ?? "";
		expect(text).toContain("is not deleted");
		expect(text).toContain("views");
	});

	it("the archive confirmation says up front where restore lands: private, not public", () => {
		const text =
			workLifecycleConfirm("archive", "Title")?.lines.join(" ") ?? "";
		expect(text).toContain("restore it as private");
		expect(text).toContain("Restoring doesn't make it public again");
	});

	it("the publish confirmation says there is no review", () => {
		const text =
			workLifecycleConfirm("publish", "Title")?.lines.join(" ") ?? "";
		expect(text).toContain("There is no review step");
		expect(text).toContain("anyone can see it");
	});

	it("no copy implies review, approval or waiting", () => {
		const all = [
			...STORY_LIFECYCLE_ACTIONS.flatMap(
				(action) => workLifecycleConfirm(action, "Title")?.lines ?? [],
			),
			...STORY_LIFECYCLE_ACTIONS.map(
				(action) => workLifecycleConfirm(action, "Title")?.title ?? "",
			),
			...STORY_LIFECYCLE_ACTIONS.map(workLifecycleLabel),
		].join(" ");

		for (const word of REVIEW_WORDS) expect(all).not.toContain(word);
	});

	it("reversible actions get no destructive emphasis", () => {
		/**
		 * Archive is not deletion, so its confirm must not use a destructive (red) button. The color
		 * would contradict the copy.
		 */
		for (const action of ["publish", "archive"] as const)
			expect(workLifecycleConfirm(action, "Title")?.destructive).toBe(false);
	});
});

describe("workLifecycleErrorMessage", () => {
	const apiError = (code: string, status = 409) =>
		new RowCatApiError({ status, code, message: "rejected" });

	it("the two forbidden transitions get different copy", () => {
		/**
		 * Both rejections return 409, so folding by status code would show one message. The next steps
		 * differ: an archived work must be restored first, while restoring a public work is not an
		 * action.
		 */
		const archived = workLifecycleErrorMessage(
			"publish",
			apiError(STORY_LIFECYCLE_ERROR_CODE.archived),
		);
		const notArchived = workLifecycleErrorMessage(
			"restore",
			apiError(STORY_LIFECYCLE_ERROR_CODE.notArchived),
		);
		expect(archived).not.toBe(notArchived);
		expect(archived).toContain("Restore");
	});

	it("the adult eligibility rejection does not say to try again", () => {
		/**
		 * The user's next step is identity verification. Folding this into a generic failure leaves them
		 * stuck with no way forward.
		 */
		const message = workLifecycleErrorMessage(
			"publish",
			apiError(STORY_PUBLISH_ERROR_CODE.adultNotPermitted, 403),
		);
		expect(message).toContain("adult verification");
		expect(message).not.toContain("try again");
	});

	it("an unknown failure names the action and suggests retrying", () => {
		const messages = STORY_LIFECYCLE_ACTIONS.map((action) =>
			workLifecycleErrorMessage(action, new Error("network")),
		);
		for (const message of messages) expect(message).toContain("try again");
		// Each action has its own sentence, so the message says which action failed.
		expect(new Set(messages).size).toBe(STORY_LIFECYCLE_ACTIONS.length);
	});

	it("a 404 does not explain existence", () => {
		/**
		 * The server returns the same 404 for someone else's work and a missing work, so the copy must
		 * not tell them apart.
		 */
		expect(
			workLifecycleErrorMessage("archive", apiError("not_found", 404)),
		).toBe("The story couldn't be found.");
	});
});
