import { describe, expect, it } from "vitest";
import {
	type CommentRowAction,
	canReportTarget,
	commentRowAction,
} from "./report-visibility.ts";

/**
 * Checks the visibility of report entry points by value.
 *
 * Not authorization (the server is the authority). It is locked by value anyway because there are
 * three call sites (work detail, comment row, profile header). A per-site check would eventually
 * show a report to guests, who fill out the whole form before learning they need to log in.
 */

describe("reporting public targets", () => {
	/**
	 * Guests and unverified identity share a case. Folding the latter into "member" would open the
	 * form for someone who may not be a member, and they would get a 401 after filling it out.
	 */
	it("not drawn unless a confirmed member", () => {
		expect(canReportTarget({ viewerId: null, ownerId: "creator" })).toBe(false);
		expect(canReportTarget({ viewerId: null, ownerId: null })).toBe(false);
	});

	/** Own content is not drawn: the server does not block it, but it is meaningless. */
	it("not drawn on your own", () => {
		expect(canReportTarget({ viewerId: "me", ownerId: "me" })).toBe(false);
	});

	it("drawn on someone else's", () => {
		expect(canReportTarget({ viewerId: "me", ownerId: "creator" })).toBe(true);
	});

	/**
	 * Ownerless public works are reportable. When a creator leaves and their identity is erased, the
	 * work stays in the catalogue (represented by `story.owner` being NULL), and if its content is a
	 * problem it must still be reportable. The report target is the work, not the person.
	 */
	it("drawn on ownerless stories too", () => {
		expect(canReportTarget({ viewerId: "me", ownerId: null })).toBe(true);
	});
});

describe("comment row operations are exclusive", () => {
	const at = (input: { own: boolean; viewerId: string | null }) =>
		commentRowAction(input);

	/**
	 * Delete on own rows, report on others' rows. Rendering both together is the easiest mistake in
	 * this table, and that screen makes another person's comment look deletable (pressing it gives a
	 * 404, because ownership is in the server predicate).
	 */
	it("your own comment has only delete", () => {
		expect(at({ own: true, viewerId: "me" })).toBe<CommentRowAction>("delete");
	});

	it("someone else's comment has only report", () => {
		expect(at({ own: false, viewerId: "me" })).toBe<CommentRowAction>("report");
	});

	/** Guests get no trigger at all: the `⋯` that would open an empty menu is not drawn. */
	it("guests get no operations", () => {
		expect(at({ own: false, viewerId: null })).toBeNull();
	});

	/**
	 * Ownership takes precedence over identity. If the third branch checked only `viewerId`, a brief
	 * wobble in identity lookup would make own-comment delete disappear and come back, which reads as
	 * flicker to someone scanning the list.
	 */
	it("when ownership is true it's delete regardless of identity", () => {
		expect(at({ own: true, viewerId: null })).toBe<CommentRowAction>("delete");
	});
});
