import type {
	DeletedStoryComment,
	Viewer,
	VisibleStoryComment,
} from "@rowcat/domain";
import { isOwnComment } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../../../lib/session-state.ts";
import { viewerAction } from "../../../lib/viewer-action.ts";
import { resolveCommentsState } from "./comments-state.ts";

/**
 * The two comment-section verdicts: **the list slot** and **eligibility for the composer**.
 *
 * How the cache moves (no append unless the last page was seen; deletes wait for confirmation) is
 * already locked by `@rowcat/query`'s own tests. This file covers only the decisions this app
 * layers on top.
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

const comment = (authorId: string): VisibleStoryComment => ({
	id: `comment-${authorId}`,
	storyId: "story-1",
	parentId: null,
	state: "visible",
	author: { id: authorId, nickname: "Someone", avatarUrl: null },
	body: "I enjoyed reading it",
	createdAt: "2026-01-01T00:00:00.000Z",
	replyCount: 0,
	likeCount: 0,
	viewerLiked: false,
});

/** A row kept only as structure because replies remain: no author, no body. */
const tombstone = (): DeletedStoryComment => ({
	id: "comment-gone",
	storyId: "story-1",
	parentId: null,
	state: "deleted",
	createdAt: "2026-01-01T00:00:00.000Z",
	replyCount: 2,
});

describe("list cells", () => {
	it("rows mean a list", () => {
		expect(
			resolveCommentsState({
				status: "success",
				paused: false,
				commentCount: 3,
			}),
		).toBe("list");
	});

	it("zero is empty — not a failure", () => {
		expect(
			resolveCommentsState({
				status: "success",
				paused: false,
				commentCount: 0,
			}),
		).toBe("empty");
	});

	it("tells paused from running", () => {
		expect(
			resolveCommentsState({
				status: "pending",
				paused: false,
				commentCount: 0,
			}),
		).toBe("loading");
		expect(
			resolveCommentsState({
				status: "pending",
				paused: true,
				commentCount: 0,
			}),
		).toBe("offline");
	});

	/**
	 * §76: a comment failure ends inside this section.
	 *
	 * The guarantee is that this verdict is kept apart from the work's state. Folding them together
	 * would turn a screen whose work info loaded but whose discussion did not into a full error.
	 */
	it("even on failure it doesn't state the story's status", () => {
		expect(
			resolveCommentsState({ status: "error", paused: false, commentCount: 0 }),
		).toBe("failed");
	});

	it("draws received rows even when a background refresh fails", () => {
		expect(
			resolveCommentsState({
				status: "success",
				paused: true,
				commentCount: 5,
			}),
		).toBe("list");
	});
});

describe("compose field eligibility", () => {
	it("guests can read but not write", () => {
		/**
		 * Reading needs no eligibility: the list query carries no identity. Only writing goes to sign-in.
		 * The point is not to draw the composer and then block it; hearing "sign in" only after you write
		 * is the worst order.
		 */
		expect(viewerAction({ phase: "guest", viewer: null })).toBe("sign-in");
	});

	it("confirmed members can write", () => {
		expect(viewerAction({ phase: "authenticated", viewer: ALICE })).toBe(
			"allowed",
		);
	});

	it("sanctioned members can't write", () => {
		expect(
			viewerAction({
				phase: "authenticated",
				viewer: { ...ALICE, status: "suspended" },
			}),
		).toBe("restricted");
	});

	it("doesn't call it guest when the session can't be checked", () => {
		const state: SessionState = { phase: "unavailable", viewer: null };
		expect(viewerAction(state)).toBe("unverified");
	});
});

describe("delete is drawn only on my rows", () => {
	it("true for my comment", () => {
		expect(isOwnComment(comment(ALICE.id), ALICE.id)).toBe(true);
	});

	it("false for someone else's comment", () => {
		/**
		 * Pressing it would only yield a 404 (ownership is baked into the server predicate), so a screen
		 * that looks like it can delete someone else's comment is itself the defect.
		 */
		expect(isOwnComment(comment("member-bob"), ALICE.id)).toBe(false);
	});

	it("for guests no row is theirs", () => {
		expect(isOwnComment(comment(ALICE.id), null)).toBe(false);
	});

	it("same nickname but a different member id is someone else's", () => {
		// Nicknames are neither unique nor stable, so they cannot ground an ownership check.
		const impostor: VisibleStoryComment = {
			...comment("member-bob"),
			author: { id: "member-bob", nickname: ALICE.nickname, avatarUrl: null },
		};
		expect(isOwnComment(impostor, ALICE.id)).toBe(false);
	});

	/**
	 * A tombstone belongs to **no one**. Returning true here would bring the delete action back on a
	 * row already deleted, and the presser would get a 404.
	 */
	it("a tombstone isn't even its former author's", () => {
		expect(isOwnComment(tombstone(), ALICE.id)).toBe(false);
	});
});
