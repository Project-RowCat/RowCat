import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shellRouteFor } from "#/components/app-shell/shell-route.ts";
import { account } from "#/lib/i18n/messages/en/account.ts";

/**
 * Static check that the exit paths from the entry gate actually leave.
 *
 * The bug shape in this slice: an exit labelled as leaving led back behind the gate. An earlier gate
 * sent account deletion to a /account-deletion guide, which said to delete on the account screen;
 * that screen sits behind the gate, so following the guide returned users to the gate.
 * Types, links and rendering cannot catch this. It needs several files read together, so the policy
 * is checked in source (the web tests have no React rendering).
 *
 * Four checks:
 * - one shared exit implementation across both gates
 * - account deletion is a real action inside the gate, not a link
 * - no gate links to /account, which is behind the gate and would loop
 * - both screens draw the exit
 *
 * Both gates can trap people: an under-14 member whose guardian never consents could not even
 * delete their account.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

const read = (...segments: string[]): string =>
	readFileSync(join(...segments), "utf8");

/** The only implementation of the exit path. Both gates use this file. */
const shell = read(HERE, "gate-shell.tsx");

/** The three screens the gate renders. A screen missing from this list is not checked. */
const PANELS = {
	age: read(HERE, "age-panel.tsx"),
	guardian: read(HERE, "guardian-panel.tsx"),
} as const;

const matches = (routeId: string) => [
	{ routeId: "__root__", params: {} },
	{ routeId: "/(app)", params: {} },
	{ routeId, params: {} },
];

describe("entry gate exits", () => {
	/**
	 * Account deletion is an action, not guidance. Sharing this action with the account screen also
	 * keeps the two from diverging. If the gate built its own confirmation dialog, password
	 * verification and the confirmation phrase would exist in two copies, and a mismatch would surface
	 * in an irreversible action.
	 */
	it("can delete the account right inside the gate", () => {
		expect(shell).toContain("DeleteAccountTrigger");
	});

	it("sign-out clears server state too", () => {
		expect(shell).toContain("authClient.signOut()");
		expect(shell).toContain("resetViewerState");
	});

	it("a path to the deletion guide remains", () => {
		expect(shell).toContain('to="/account-deletion"');
	});

	/**
	 * Sending users to the account screen would make a loop, not an exit. That screen is behind the
	 * gate, so pressing the link brings the user back here.
	 */
	it("no gate sends to the account screen", () => {
		for (const [name, source] of Object.entries(PANELS))
			expect(source, `${name} gate`).not.toContain('to="/account"');
		expect(shell).not.toContain('to="/account"');
	});

	/**
	 * Both screens must draw the exit. If one does not, a person on that screen is trapped,
	 * usually an under-14 member waiting for guardian consent.
	 */
	it("both gates draw the same exit", () => {
		for (const [name, source] of Object.entries(PANELS))
			expect(source, `${name} gate`).toContain("<GateExit");
	});

	/**
	 * The reason the account screen cannot be a gate exit is pinned to the route predicate. If the
	 * account screen ever becomes a public document, this test fails first, and the basis of the rule
	 * above changes with it.
	 */
	it("the account screen is behind the gate — only the guide is outside", () => {
		expect(shellRouteFor(matches("/(app)/account/")).publicDocument).toBe(
			false,
		);
		expect(
			shellRouteFor(matches("/(app)/account-deletion/")).publicDocument,
		).toBe(true);
	});

	/**
	 * The deletion guide must also say that deletion is possible from the gate. The test checks only
	 * that the fact is mentioned, not the wording. Many readers of this guide cannot log in or have
	 * not passed the gate; if the guide names only the account screen, it offers them no path.
	 */
	it("the account deletion guide says deletion works from the gate too", () => {
		const guide = read(
			WEB_SRC,
			"features",
			"account",
			"account-deletion-guide.tsx",
		);
		expect(guide).toContain('t("accountDeletionGuide.ifAScreenAskingFor")');
		expect(account.accountDeletionGuide.ifAScreenAskingFor).toContain(
			"waiting for guardian consent",
		);
	});

	/**
	 * The guardian screen is not this gate's screen. Its viewer is a guardian holding a link, not a
	 * member, so logout and account deletion are not their actions. An exit drawn there would be a
	 * button that deletes someone else's account.
	 */
	it("the guardian page has no deletion or sign-out", () => {
		const guardianPage = read(HERE, "guardian-consent-page.tsx");
		expect(guardianPage).not.toContain("GateExit");
		expect(guardianPage).not.toContain("DeleteAccountTrigger");
		expect(guardianPage).not.toContain("signOut");
	});
});
