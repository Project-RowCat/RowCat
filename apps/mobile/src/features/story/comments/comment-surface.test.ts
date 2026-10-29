import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Boundary checks for the mobile comment surface, asking the same questions as the web's
 * `comment-surface.test.ts`. This app's tests do not render screens, so these check the source for
 * three places that could silently break as replies are added. Both apps must hold the same three,
 * or their meaning drifts:
 *
 * ```text
 * recursion        if the thread renders itself, depth becomes the screen's call, not the contract's
 * tombstone text   a change that draws deleted bodies or names faintly can land at any time
 * reply fan-out    opening twenty rows that each fire a reply query is invisible on screen
 * ```
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const read = (name: string): string => readFileSync(join(HERE, name), "utf8");

/** Source with comments removed, so a comment naming a forbidden pattern does not trip the check. */
const code = (name: string): string =>
	read(name)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("threads — recursion can't be expressed", () => {
	it("a thread doesn't draw itself", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("export function CommentThread");
		expect(thread.match(/<CommentThread/g)).toBeNull();
	});

	it("reply rows get no operation slot", () => {
		const thread = code("comment-thread.tsx");
		const replyRow = thread.slice(thread.indexOf("rows.map"));
		expect(replyRow).toContain("<CommentRow");
		expect(replyRow).not.toContain("footer=");
	});

	/** Replies load only on expand: without `enabled`, one screen would issue twenty-one requests. */
	it("no reply lookup goes out before expanding", () => {
		expect(code("comment-thread.tsx")).toContain("enabled: expanded");
	});

	/** The screen does not re-spell `parentId === null`; that decision belongs to the domain. */
	it("a domain function answers whether replying is possible", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("canReplyToComment(comment)");
		expect(thread).not.toMatch(/parentId\s*===\s*null\s*&&/);
	});

	/**
	 * The virtualizer measures rows itself. This thread is one `FlatList` item whose height grows on
	 * expand; a fixed `getItemLayout` would freeze that height and expanded threads would overlap.
	 */
	it("doesn't tell the expanded row's height by hand", () => {
		expect(code("../story-detail-screen.tsx")).not.toContain("getItemLayout");
	});
});

describe("tombstones — doesn't draw what was deleted", () => {
	it("doesn't guess deletion from the body's shape", () => {
		for (const file of ["comment-row.tsx", "comment-thread.tsx"]) {
			const source = code(file);
			expect(source).not.toMatch(/body\s*===\s*""/);
			expect(source).not.toMatch(/body\.length\s*===\s*0/);
			expect(source).not.toMatch(/!comment\.body/);
		}
		expect(code("comment-row.tsx")).toContain('comment.state === "visible"');
	});

	/** The copy is the same value as on web; written separately, each app would describe the same row differently. */
	it("the screen doesn't invent the tombstone sentence", () => {
		const row = code("comment-row.tsx");
		expect(row).toContain("DELETED_COMMENT_PLACEHOLDER");
		expect(row).not.toContain('"This comment was deleted."');
	});

	/** No avatar, name, or profile link: there is no author to navigate to. */
	it("tombstones have no path to the profile", () => {
		const row = code("comment-row.tsx");
		const tombstoneBranch = row.slice(
			row.indexOf('comment.state === "visible" ? ('),
		);
		expect(tombstoneBranch).toContain("CREATOR_ROUTE");
		/** The link exists only inside the live branch; the ternary's else side is a single `View`. */
		expect(row.match(/CREATOR_ROUTE/g)).toHaveLength(2);
	});
});

describe("reactions — draws only values the server confirmed", () => {
	it("the screen doesn't compute the like count", () => {
		const row = code("comment-row.tsx");
		expect(row).toContain("String(comment.likeCount)");
		expect(row).not.toMatch(/likeCount\s*[+-]\s*1/);
		expect(row).not.toContain("setQueryData");
	});

	it("a guest's heart isn't a button", () => {
		expect(code("comment-row.tsx")).toContain("if (!canReact)");
	});

	it("the screen doesn't invent accessible names", () => {
		expect(code("comment-row.tsx")).toContain("commentLikeLabel(comment)");
	});

	/**
	 * Do not convey state by color alone. The pressed state rides on `accessibilityState.selected`;
	 * the fill is visual feedback layered on top, per the `@rowcat/ui-native` rule.
	 */
	it("the pressed state stands as an accessibility state too", () => {
		expect(code("comment-row.tsx")).toContain("selected: comment.viewerLiked");
	});
});

describe("the body is still plain text", () => {
	it("uses neither markdown nor HTML", () => {
		for (const file of [
			"comment-row.tsx",
			"comment-thread.tsx",
			"comment-composer.tsx",
		]) {
			const source = code(file);
			expect(source).not.toContain("dangerouslySetInnerHTML");
			expect(source).not.toContain("react-markdown");
			expect(source).not.toContain("WebView");
		}
	});
});

describe("there's one compose form", () => {
	it("replies go through the same component", () => {
		const thread = code("comment-thread.tsx");
		expect(thread).toContain("<CommentComposer");
		expect(thread).toContain("parentId={comment.id}");

		const composer = code("comment-composer.tsx");
		expect(composer).toContain("submitting.current");
		expect(composer).toContain("StoryCommentCreateRequest.safeParse");
		expect(composer).not.toMatch(/trim\(\)\.length\s*>\s*0/);
	});

	/**
	 * The four eligibility branches apply to the reply form too. Re-listing them there would let one
	 * of them (usually the fourth) drop out.
	 */
	it("the reply form goes through the four viewer eligibilities too", () => {
		const composer = code("comment-composer.tsx");
		for (const branch of ["sign-in", "restricted", "unverified"])
			expect(composer).toContain(`action === "${branch}"`);
		expect(code("comment-thread.tsx")).toContain("action={action}");
	});
});

describe("deletion follows the server's answer", () => {
	it("passes both axes to the delete mutation", () => {
		const screen = code("../story-detail-screen.tsx");
		expect(screen).toContain(
			"removal.mutate({ id: target.id, parentId: target.parentId })",
		);
	});

	/** A pending deletion locks only its own row; locking the whole list would make other rows unpressable. */
	it("the delete lock is per row", () => {
		expect(code("comment-thread.tsx")).toContain(
			"deleting={deleting === comment.id}",
		);
		expect(code("comment-thread.tsx")).toContain(
			"deleting={deleting === reply.id}",
		);
	});
});
