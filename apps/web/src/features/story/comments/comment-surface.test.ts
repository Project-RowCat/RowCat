import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks the boundaries of the comment surface. This repo's web tests do not render
 * React, so the checks read the source. They are needed because replies added three places where
 * the surface could silently go wrong:
 * - Recursion, where a thread renders itself and depth becomes the screen's call.
 * - The original text of a tombstone, which a later change could draw greyed out.
 * - Reply fan-out, where opening a page of 20 rows fires 20 reply queries. The screen would look
 *   fine, only slower in development.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const read = (name: string): string => readFileSync(join(HERE, name), "utf8");

/**
 * `code()` strips block comments before scanning. Comments in this repo explain why, including the
 * names of things deliberately not done. Banning those words would flag the very file that explains
 * the rule, which pushes toward deleting the comments.
 */
const code = (name: string): string =>
	read(name)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("threads — recursion is not representable", () => {
	/**
	 * A thread must not render itself: once `CommentThread` calls `CommentThread`, depth becomes the
	 * screen's call. The server enforces one level (a reply to a reply returns 409), but if the screen
	 * did not know, every thread would show a button that always fails with 409.
	 */
	it("the thread does not render itself", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("export function CommentThread");
		expect(thread.match(/<CommentThread/g)).toBeNull();
	});

	/**
	 * Reply rows get no `footer`. That slot carries the reply button and the thread, so giving it to a
	 * reply row would allow nesting.
	 */
	it("reply rows get no action slot", () => {
		const thread = code("comment-thread.tsx");
		const replyRow = thread.slice(thread.indexOf("rows.map"));
		expect(replyRow).toContain("<CommentRow");
		expect(replyRow).not.toContain("footer=");
	});

	/**
	 * Replies load only on expand. Without `enabled`, opening a list of twenty rows would fire twenty
	 * reply queries, and that cost applies even to the many rows that have no replies.
	 */
	it("no replies query before expanding", () => {
		expect(code("comment-thread.tsx")).toContain("enabled: expanded");
	});

	/**
	 * Reply eligibility is answered by a domain function. The screen does not re-check `parentId ===
	 * null`, since that judgment belongs to the domain.
	 */
	it("whether a reply is possible is answered by the domain function", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("canReplyToComment(comment)");
		expect(thread).not.toMatch(/parentId\s*===\s*null\s*&&/);
	});
});

describe("tombstones — what was deleted is not drawn", () => {
	/**
	 * Discriminated by tag. Checking for an empty body string relies on the contract forbidding empty
	 * strings (`min(1)`), which would break silently the day the contract changes.
	 */
	it("does not guess deletion from the body's shape", () => {
		for (const file of ["comment-row.tsx", "comment-thread.tsx"]) {
			const source = code(file);
			expect(source).not.toMatch(/body\s*===\s*""/);
			expect(source).not.toMatch(/body\.length\s*===\s*0/);
			expect(source).not.toMatch(/!comment\.body/);
		}
		expect(code("comment-row.tsx")).toContain('comment.state === "visible"');
	});

	/**
	 * The tombstone sentence is one value shared by both apps. If each wrote its own, the same row
	 * would be explained in different words.
	 */
	it("the screen does not make up the tombstone sentence", () => {
		const row = code("comment-row.tsx");
		expect(row).toContain('t("deleted")');
		expect(row).not.toContain("This comment was deleted.");
	});

	/** A tombstone has no actions: no like, report, delete or reply. */
	it("a tombstone has no action row", () => {
		const row = code("comment-row.tsx");
		expect(row).toContain('const deleted = comment.state === "deleted"');
		expect(row).toContain("{!deleted && (own || canReport) && (");
		expect(row).toContain("{!deleted && (");
	});
});

describe("reactions — only server-confirmed values are drawn", () => {
	/**
	 * The like is not optimistic. If the screen applied plus or minus one, five quick presses would
	 * give 5 while the server's truth is always 0 or 1. The unique constraint is the final authority.
	 */
	it("the screen does not compute the like count", () => {
		const row = code("comment-row.tsx");
		expect(row).toContain("{comment.likeCount}");
		expect(row).not.toMatch(/likeCount\s*[+-]\s*1/);
		expect(row).not.toContain("setQueryData");
	});

	/** Guests see the count only, not a button that would return 401 when pressed. */
	it("a guest's heart is not a button", () => {
		expect(code("comment-row.tsx")).toContain("if (!canReact)");
	});

	/**
	 * The accessible name comes from the domain (`commentLikeLabel`). The pressed or unpressed state
	 * must go into the name.
	 */
	it("the screen does not make up the accessible name", () => {
		expect(code("comment-row.tsx")).toContain("commentLikeLabel(comment)");
	});
});

describe("the body is still plain text", () => {
	/**
	 * No HTML or markdown rendering, even now that replies exist. The repo has no trusted markdown
	 * pipeline, and a comment would make the least trusted input its first consumer.
	 */
	it("uses neither HTML nor markdown", () => {
		for (const file of [
			"comment-row.tsx",
			"comment-thread.tsx",
			"comment-section.tsx",
			"comment-composer.tsx",
		]) {
			const source = code(file);
			expect(source).not.toContain("dangerouslySetInnerHTML");
			expect(source).not.toContain("react-markdown");
			expect(source).not.toContain("innerHTML");
		}
	});
});

describe("there is one compose form", () => {
	/**
	 * A separate reply form would duplicate the limits, normalization, IME handling and double-submit
	 * lock. One of those, usually IME, would then exist on only one side, and the bug would appear
	 * only for people replying in Korean.
	 */
	it("replies go through the same component", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("<CommentComposer");
		expect(thread).toContain("parentId={comment.id}");

		const composer = code("comment-composer.tsx");
		expect(composer).toContain("isComposing");
		expect(composer).toContain("submittingRef");
		expect(composer).toContain("StoryCommentCreateRequest.safeParse");
		expect(composer).not.toMatch(/trim\(\)\.length\s*>\s*0/);
	});
});

describe("deletion follows the server's answer", () => {
	/**
	 * The delete result has two outcomes (the row disappears or becomes a tombstone). If the screen
	 * guessed from `replyCount`, the guess goes stale the moment someone else replies. The screen
	 * would drop a thread with replies, and it would come back on refresh.
	 */
	it("passes both axes to the delete mutation", () => {
		const section = code("comment-section.tsx");
		expect(section).toContain("id: pendingDelete.id");
		expect(section).toContain("parentId: pendingDelete.parentId");
	});

	it("a delete that becomes a tombstone says so in the confirmation", () => {
		expect(code("comment-section.tsx")).toContain("tombstoneNotice=");
		expect(read("delete-comment-dialog.tsx")).toContain(
			't("deleteWithReplies")',
		);
	});
});
