import { describe, expect, it } from "vitest";
import { safeMobileReturnPath } from "../../lib/return-path.ts";
import { CREATOR_ROUTE, creatorProfilePath } from "./creator-route.ts";

/**
 * The identity in the address is the **member id**, and the value is always encoded.
 *
 * The two lines this file guards both break silently — a path that skips encoding works fine with
 * ordinary ids, and if the route pattern differs from the route file name, navigation goes nowhere.
 */
describe("creatorProfilePath", () => {
	it("turns the member id into a path", () => {
		expect(creatorProfilePath("member-1")).toBe("/creators/member-1");
	});

	it("encodes values that would shake the path", () => {
		/** Without encoding, this value becomes a **different path** (and the return-path check rejects it). */
		expect(creatorProfilePath("a/b?c#d")).toBe("/creators/a%2Fb%3Fc%23d");
		expect(creatorProfilePath("an id with a name")).not.toContain(" ");
	});

	it("the route pattern has the same shape as the route file", () => {
		expect(CREATOR_ROUTE).toBe("/creators/[creatorId]");
	});
});

describe("usable as a return path as is", () => {
	/**
	 * **This check is the most valuable part of this file.** When a guest presses follow, this path is
	 * carried into login, and the value only becomes a destination if `safeMobileReturnPath` accepts
	 * it. If it is rejected, login succeeds but returns to **the first screen**, and that symptom
	 * raises no error at all.
	 */
	it.each([
		"member-1",
		"a/b?c#d",
		"an id with a name",
		"%",
	])("the path of %s passes the return check", (id) => {
		const path = creatorProfilePath(id);
		expect(safeMobileReturnPath(path)).toBe(path);
	});
});
