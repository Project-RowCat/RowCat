import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the **wiring** of the membership gate, which the type checker cannot see.
 *
 * The decision itself is checked by value in `membership-gate-state.test.ts`. This file checks
 * where that decision is made exactly once, and whether the gate ever **traps a person**. Violating
 * either still compiles, and the failure only appears on a device:
 *
 * ```text
 * several gates   a route added later opens without the gate, and no error is raised
 * a cover         product screens keep running underneath (effects, queries, dialogs, assistive tech)
 * no exit         someone held at the gate cannot sign out or delete the account
 * ```
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * **Comments are stripped before checking.** Comments in this repository explain boundaries by
 * naming the forbidden words (for example, "do not build the gate from `ageStatus`").
 * Scanning the raw text would flag the explanation of the rule, and people would edit the comment
 * instead of the code.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("gate-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const gateFeature = product.filter((file) =>
	file.path.startsWith("features/onboarding/"),
);

const PANELS = [
	"features/onboarding/age-panel.tsx",
	"features/onboarding/guardian-panel.tsx",
] as const;

describe("the files to check actually exist", () => {
	it("the gate files are all in place", () => {
		for (const path of [
			"features/onboarding/membership-gate-state.ts",
			"features/onboarding/membership-gate.tsx",
			"features/onboarding/gate-shell.tsx",
			"features/onboarding/gate-copy.ts",
			"features/onboarding/birth-date-input.ts",
			...PANELS,
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(true);
	});
});

describe("there's one door", () => {
	/**
	 * **One decision point: the root.** Gates placed per screen get missed when a route is added, and
	 * a missed route opens with no error. To someone holding that URL, the gate simply does not exist.
	 */
	it("the root layout is the only place that reads the gate", () => {
		const readers = product
			.filter((file) => /\buseAppGate\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(readers).toEqual([
			"app/_layout.tsx",
			"features/onboarding/membership-gate.tsx",
		]);

		const renderers = product
			.filter((file) => /<AppGatePanel\b/.test(file.text))
			.map((file) => file.path);
		expect(renderers).toEqual(["app/_layout.tsx"]);
	});

	/**
	 * **Replace, not cover.** Layering the gate above `<Stack>` leaves the product screens alive
	 * underneath: effects run, queries fire, dialogs can open, and assistive tech reads the controls
	 * under the cover (the web did this for a while). So the navigator must sit on the **opposite
	 * branch** of the ternary. A shape that renders both elements side by side does not pass this
	 * regex.
	 *
	 * The fragment on that side is allowed, because a navigator sits beside it when no gate exists
	 * (the update notice). It also disappears when the gate appears. What this check guards is
	 * "replace, not cover", not that there is exactly one child.
	 */
	it("when a gate stands the navigator isn't mounted", () => {
		const layout = fileAt("app/_layout.tsx");
		expect(layout).toMatch(
			/\{gate \? \(\s*<AppGatePanel gate=\{gate\} \/>\s*\) : \(\s*(<>\s*)?<Stack/,
		);
		/** There is one place that draws `<Stack>`. A second navigator would be a second gate. */
		const navigators = product
			.filter((file) => /<Stack\b/.test(file.text))
			.map((file) => file.path);
		expect(navigators).toEqual(["app/_layout.tsx"]);
	});

	/**
	 * **Routes do not set their own gate.** If a route or screen starts reading `membershipGate`, the
	 * decision exists twice, and the two copies diverge while a deploy is rolling out.
	 */
	it("routes and screens don't re-decide the gate", () => {
		for (const file of product) {
			if (file.path.startsWith("features/onboarding/")) continue;
			expect(file.text, file.path).not.toMatch(/\bmembershipGate\b/);
			expect(file.text, file.path).not.toMatch(/\bappGateFor\b/);
		}
	});

	/**
	 * **`ageStatus` is not a second authority.** A branch built from it would create a second priority
	 * algorithm, and that copy would ignore the server's rollout switch.
	 */
	it("the age state doesn't enter the gate decision", () => {
		for (const file of gateFeature)
			expect(file.text, file.path).not.toMatch(/\bageStatus\b/);
	});
});

describe("the device doesn't compute age", () => {
	/**
	 * **P0.** Age, the day of transition, leap years and midnight boundaries are all decided by the
	 * server in the product timezone (`declareAge` in `@rowcat/domain`). A device clock would split
	 * decisions across timezones, and the split would only show as "under 14 but allowed through". On
	 * screen, validation is "is it empty", and the hyphen in the input does not change the value
	 * (`birth-date-input.test.ts`).
	 */
	it("there's no material at all for computing age", () => {
		for (const file of gateFeature)
			for (const forbidden of [
				/\bnew Date\b/,
				/\bDate\.now\b/,
				/getFullYear|getMonth|getDate/,
				/\bdeclareAge\b(?!MutationOptions)/,
				/\bproductDate\b|\baddYears\b|\bresolveAgeStatus\b/,
				/GUARDIAN_CONSENT_AGE|guardianConsentThresholdDate/,
				/thresholdDate/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/** The screen checks one thing: whether the value is empty. */
	it("the age screen's only validation is emptiness", () => {
		const panel = fileAt("features/onboarding/age-panel.tsx");
		expect(panel).toContain("AGE_EMPTY_ERROR");
		expect(panel).toMatch(/if \(!value\)/);
	});
});

describe("the entered value doesn't live on the device", () => {
	/**
	 * **Neither the birth date nor the guardian link token is stored.**
	 *
	 * The first is a value even the server does not store (the screen says so). The second is a
	 * one-time credential. Saving it would make the link reusable, and it would show up on the screen
	 * of whoever signs in on this device next. Not building "resume an unfinished entry" is the
	 * structural form of that rule.
	 */
	it("the gate touches no storage", () => {
		for (const file of gateFeature)
			for (const forbidden of [
				/expo-secure-store|SecureStore/,
				/AsyncStorage/,
				/expo-sqlite|\bChatStore\b|\bAuthoringStore\b|\bSyncStore\b/,
				/useMobileLocalScope/,
				/setQueryData|setQueriesData/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/** Only that screen knows the one-time path, and it does not go into the cache either. */
	it("the guardian link's path doesn't leave that screen", () => {
		const holders = product
			.filter((file) => /\bconsentPath\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(holders).toEqual([
			"features/onboarding/guardian-panel.tsx",
			"lib/public-web.ts",
		]);
	});
});

describe("the screen doesn't lower the gate itself", () => {
	/**
	 * When the guardian approves on another device, this screen **asks for the viewer again.** If
	 * `membershipGate` were built by hand, there would be a window in which an account the server has
	 * not opened yet appears open. A child who sees that window believes the app has opened.
	 */
	it("approval leads to viewer invalidation", () => {
		const panel = fileAt("features/onboarding/guardian-panel.tsx");
		expect(panel).toMatch(/status !== "approved"/);
		expect(panel).toMatch(
			/invalidateQueries\(\{\s*queryKey:\s*VIEWER_QUERY_KEY\s*\}\)/,
		);
	});
});

describe("doesn't trap people", () => {
	/** Both gates share the **same** exit paths. If one is missing, that screen is a dead end. */
	it("both screens draw the way out", () => {
		for (const path of PANELS)
			expect(fileAt(path), path).toContain("<GateExit");
	});

	/**
	 * **The delete action does not go to the account screen.** That screen sits behind this gate, so
	 * sending people there would create a loop: "to delete, first get past the gate". A path labelled
	 * as an exit that is really a loop is worse than having no path at all.
	 */
	it("the way out doesn't go through the account screen", () => {
		for (const file of gateFeature) {
			expect(file.text, file.path).not.toMatch(/["'`]\/account["'`]/);
			expect(file.text, file.path).not.toMatch(
				/router\.(push|navigate|replace)/,
			);
		}
	});

	/**
	 * **No second implementation of an irreversible action.** The two gates and the account screen
	 * share one trigger, one confirmation dialog and one terminal panel. If they diverged, only one of
	 * them could draw a password field for a social-only account, or only one could continue past a
	 * failed account-info lookup.
	 */
	it("deletion goes through the one shared set", () => {
		const shell = fileAt("features/onboarding/gate-shell.tsx");
		expect(shell).toContain("<DeleteAccountTrigger");
		for (const path of PANELS) {
			expect(fileAt(path), path).toContain("useAccountDeletion");
			expect(fileAt(path), path).toContain("<DeletionTerminal");
		}
		/** There is no second state machine and no second authentication path. */
		for (const file of gateFeature)
			for (const forbidden of [
				/createAccountDeletionTurn/,
				/\bdeleteUser\b/,
				/authClient/,
				/requestAccountDeletion/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/**
	 * **Sign-out also calls the existing transition owner.** The order (session → cache → local scope)
	 * is a rule, not markup. Rewriting it here would create a second cleanup path that does not follow
	 * that order.
	 */
	it("signing out goes through the identity provider", () => {
		const shell = fileAt("features/onboarding/gate-shell.tsx");
		expect(shell).toContain("useMobileIdentity");
		expect(shell).toContain("identity.signOut()");
		expect(shell).not.toContain("resetViewerState");
		/**
		 * **The failure is not silent, and it is not component state.**
		 *
		 * While the procedure runs, the session goes to `booting`, which unmounts the gate. A failure
		 * held in local `useState` is therefore already gone when the component mounts again. The person
		 * stuck in the gate would press exit and nothing would happen.
		 */
		expect(shell).toContain("GATE_SIGN_OUT_FAILED");
		expect(shell).toContain("identity.failure");
		expect(shell).not.toContain("useState");
	});

	/**
	 * Once the account is gone, render **none** of the gate's content. A boundary crossed irreversibly
	 * must count as crossed from that moment on.
	 */
	it("once deletion is confirmed the exit panel replaces the screen", () => {
		for (const path of PANELS)
			expect(fileAt(path), path).toMatch(
				/if \(deletion\.terminal\)[\s\S]{0,200}<DeletionTerminal/,
			);
	});
});

describe("doesn't guess addresses", () => {
	/** Do not guess the origin. Without one, no link is drawn. */
	it("doesn't join addresses by hand", () => {
		for (const file of gateFeature)
			expect(file.text, file.path).not.toMatch(/replace\(\/\\\/\+\$\//);
	});
});

describe("the screen the guardian opens isn't in this app", () => {
	/**
	 * `/guardian/:token` is a **public route on the web**. The person who opens that address is an
	 * adult who received the link, not a member, and this app has no reason to be on that device.
	 * Building a native route would make a screen for a user who does not exist in this app, which is
	 * not parity.
	 */
	it("neither the guardian route nor its operation exists", () => {
		for (const path of [
			"app/guardian.tsx",
			"app/guardian/[token].tsx",
			"app/guardian/index.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(false);

		for (const file of product)
			for (const forbidden of [
				/guardianConsentQueryOptions/,
				/guardianVerifyMutationOptions/,
				/guardianConsentMutationOptions/,
				/guardianDeclineMutationOptions/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});
});
