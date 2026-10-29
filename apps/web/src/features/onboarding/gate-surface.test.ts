import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MembershipGate, Viewer } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { appGateFor } from "./membership-gate-state.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const read = (...segments: string[]): string =>
	readFileSync(join(...segments), "utf8");

const viewerWith = (patch: Partial<Viewer>): Viewer =>
	({
		id: "m1",
		nickname: "Someone",
		status: "approved",
		role: "user",
		verified: false,
		adult: false,
		showAdult: false,
		ageStatus: "adult",
		membershipGate: null as MembershipGate,
		...patch,
	}) as Viewer;

/**
 * The gate must be the only content while it stands; the app shell must not remain in the DOM.
 *
 * Previously the gate was drawn inside the shell. The fixed full-screen cover hid the surroundings
 * visually, but the header and sidebar stayed in the DOM, with three effects:
 * - Accessibility: twenty-odd invisible controls stayed in the tab order. The notification and
 *   account menus opened behind the cover, so keyboard users could not get out.
 * - Semantics: two nested <main> landmarks.
 * - Data: unread-notification queries went out to users the gate was holding.
 *
 * None of these appear in screenshots or manual clicks, so the test locks structure rather than
 * values: the gate branch must replace the shell (return before AppShell), decided by one pure
 * function.
 */
describe("the entry gate replaces the shell", () => {
	const layout = read(WEB_SRC, "routes", "(app)", "route.tsx");

	it("the gate returns before the shell draws", () => {
		const gateAt = layout.indexOf("<AppGatePanel");
		const shellAt = layout.indexOf("<AppShell");
		expect(gateAt).toBeGreaterThan(-1);
		expect(shellAt).toBeGreaterThan(-1);
		expect(gateAt).toBeLessThan(shellAt);
		expect(layout).toContain("return <AppGatePanel gate={gate} />");
	});

	/**
	 * Prevents a wrapping gate from returning. A `<MembershipGate>{outlet}</…>` shape would put the
	 * shell above the surface again and bring back all three symptoms described above.
	 */
	it("the gate does not wrap the canvas", () => {
		expect(layout).not.toContain("<MembershipGate");
	});

	/**
	 * Public documents pass through. That decision reads the axis in shell-route.ts; the layout must
	 * not spell out path prefixes itself.
	 */
	it("does not restate the public-document axis here", () => {
		expect(layout).toContain("shell.publicDocument");
		expect(layout).not.toContain("startsWith(");
	});

	/**
	 * The gate surface keeps its own <main>. With the shell gone, it is this document's only landmark.
	 */
	it("the gate surface has its own landmark", () => {
		expect(read(HERE, "gate-shell.tsx")).toContain("<main");
	});
});

/**
 * Which gate stands is answered by one pure function over the server's single value, so the screen
 * never reassembles the order from other axes.
 */
describe("appGateFor", () => {
	it("guests and failed lookups pass", () => {
		expect(appGateFor(null)).toBeNull();
	});

	it("passes with no condition", () => {
		expect(appGateFor(viewerWith({}))).toBeNull();
	});

	it("age", () => {
		expect(appGateFor(viewerWith({ membershipGate: "age_required" }))).toBe(
			"age",
		);
	});

	it("guardian consent", () => {
		expect(
			appGateFor(viewerWith({ membershipGate: "guardian_consent_required" })),
		).toBe("guardian");
	});

	/** If the server does not hold the member, the screen must not invent a gate from other axes. */
	it("does not invent a gate the server did not raise", () => {
		expect(
			appGateFor(viewerWith({ membershipGate: null, ageStatus: "unknown" })),
		).toBeNull();
	});
});
