import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the **intended differences** between the web and this app as values.
 *
 * A parity audit is not a route count. Many screens the web has and this app lacks should be
 * absent. If that fact is written nowhere in the code, the next person reads it as a gap and fills
 * it, and the screen built that way is either for users who do not exist or a flow that never
 * completes.
 *
 * So this file guards two directions:
 *
 * ```text
 * what must exist          the entry gate · the single path to canonical web addresses
 * what must not exist      guardian receiving screen · Toss callback · legacy compatibility addresses
 * ```
 *
 * The gate's own wiring is held by `features/onboarding/gate-boundaries.test.ts`. This file checks
 * only **the route list** and **canonical addresses** — two files describing the same rule would
 * let only one get fixed.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else files.push(full);
	}
	return files;
}

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = sources(SRC).map((path) => ({
	path: path.slice(SRC.length),
	text: /\.tsx?$/.test(path)
		? stripComments(readFileSync(path, "utf8"))
		: readFileSync(path, "utf8"),
}));

const product = files.filter(
	(file) =>
		/\.tsx?$/.test(file.path) &&
		!file.path.startsWith("test/") &&
		!/\.test\.tsx?$/.test(file.path) &&
		!file.path.endsWith("parity-boundaries.test.ts"),
);

const routes = product
	.filter((file) => file.path.startsWith("app/"))
	.map((file) => file.path)
	.sort();

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("route list", () => {
	/**
	 * **The list is kept as a value so that growth shows up in review.**
	 *
	 * When a route is added there are two questions: is it behind the entry gate (the root guarantees
	 * this), and which web screen is its counterpart? Without a list, that question is raised nowhere.
	 */
	it("this app's routes are exactly this list right now", () => {
		expect(routes).toEqual([
			"app/_layout.tsx",
			"app/account.tsx",
			"app/chat/[roomId].tsx",
			/**
			 * Creator runtime playback — **the address in the conversation section, but not a room.** It
			 * pairs with the web's `/chat/runtime/$storyId`; the old `stories/[storyId]/play.tsx` remains
			 * only as a compatibility address that redirects here (`docs/creator-runtime/player.md` §14).
			 */
			"app/chat/runtime/[storyId].tsx",
			"app/chats.tsx",
			"app/create/[draftId].tsx",
			"app/create/[draftId]/test.tsx",
			"app/create/index.tsx",
			"app/creators/[creatorId].tsx",
			"app/dev-tools.tsx",
			"app/index.tsx",
			"app/login.tsx",
			"app/notifications.tsx",
			"app/settings/_layout.tsx",
			"app/settings/ai.tsx",
			"app/settings/index.tsx",
			"app/settings/personas.tsx",
			"app/stories/[storyId]/index.tsx",
			/**
			 * Retired playback address — a compatibility route that redirects to `/chat/runtime/[storyId]`.
			 *
			 * It stays a folder (not a child of the detail). Deep links and stack restoration may still
			 * point here, so it is not deleted. It draws no screen, so two diverging playback surfaces are
			 * not representable.
			 */
			"app/stories/[storyId]/play.tsx",
			/**
			 * **The two development-only routes are not subject to the web-counterpart
			 * question**(`dev-tools`· `visual-lab`). In release builds those addresses return to the first
			 * screen, and product UI has no path into them — each one's boundary check locks that fact
			 * separately.
			 *
			 * They are still listed because of what the list is for: if a route not listed here appears, the
			 * check must break, and that break makes reviewers ask what the screen is.
			 */
			"app/visual-lab.tsx",
		]);
	});
});

describe("what only the web has — and why that's intended", () => {
	/**
	 * **The markdown renderer belongs to conversation bodies.** It is not a general document renderer:
	 * a screen that drew some other markdown through it would inherit the conversation's folding and
	 * URL policy without having chosen them.
	 */
	it("the markdown renderer is used only by conversation bodies", () => {
		for (const file of product) {
			if (file.path.startsWith("features/markdown/")) continue;
			if (file.path.startsWith("features/chat/")) continue;
			if (file.path.startsWith("features/playtest/")) continue;
			expect(file.text, file.path).not.toMatch(/@rowcat\/markdown/);
		}
	});

	/**
	 * **The guardian-facing screen belongs to the public web.**
	 *
	 * The person who opens `/guardian/:token` is not a member but an adult to whom a child handed the
	 * link, and that device has no reason to have this app. Building a native route here is not parity
	 * but building a screen for a user who does not exist. The child's screen, by contrast, lives
	 * **here** (the entry gate's guardian face).
	 */
	it("no guardian receiving route", () => {
		for (const path of ["app/guardian.tsx", "app/guardian/[token].tsx"])
			expect(routes).not.toContain(path);
	});

	/**
	 * **Legacy address compatibility belongs to the web.** The web's `/personas` remains as a redirect
	 * because of bookmarks and open tabs. This app never had a deep link to that address, and
	 * mimicking a compatibility that never existed would give one screen two addresses.
	 */
	it("doesn't create the old persona address", () => {
		expect(routes).not.toContain("app/personas.tsx");
	});

	/**
	 * **The public account-deletion guide also belongs to the web.** Some people who need to read it
	 * cannot sign in, and store reviewers do not open this app. The deletion **action**, by contrast,
	 * lives here (the account screen and the entry gate hold it directly).
	 */
	it("no deletion guide route, and the operation is inside the app", () => {
		expect(routes).not.toContain("app/account-deletion.tsx");
		expect(fileAt("features/account/delete-account-section.tsx")).toContain(
			"<DeleteAccountTrigger",
		);
		expect(fileAt("features/onboarding/gate-shell.tsx")).toContain(
			"<DeleteAccountTrigger",
		);
	});
});

describe("identity verification is parity, and the adult display opt-in is an intended difference", () => {
	/**
	 * **Do not read these two lines as one cell. That is the whole point of this check.**
	 *
	 * ```text
	 * identity verification (unlocks eligibility)          PARITY        the same web procedure completes inside the app
	 * enable adult UGC display (iOS)        INTENTIONAL   web only, because of App Store UGC policy
	 * disable adult UGC display             PARITY        both platforms disable it in the app
	 * ```
	 *
	 * For a while the first line was also an "intentional difference", with a concrete basis: the
	 * identity authority's handoff required the browser SDK, and this app had no place to run it.
	 * **That basis is gone, so the classification goes with it.** Leaving the stale explanation
	 * "identity verification cannot be done in React Native" would let the next person read it as
	 * still true.
	 */
	it("the identity verification procedure really is in this app", () => {
		for (const path of [
			"features/adult-verification/adult-verification-turn.ts",
			"features/adult-verification/adult-verification-surface.tsx",
			"features/adult-verification/adult-verification-trigger.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(true);
		/** No route was added — it is a temporary flow attached to the account screen and has no address. */
		for (const path of [
			"app/account/verify.tsx",
			"app/account/security.tsx",
			"app/verify.tsx",
		])
			expect(routes).not.toContain(path);
	});

	/**
	 * **On iOS, the only path to enable adult display is the web.** The decision lives in a pure
	 * function; the screen draws its answer. This pins as a value that the function exists in this app
	 * (the rule itself is run by `features/account/adult-content-policy.test.ts`).
	 */
	it("the adult display opt-in's platform boundary is in a pure function", () => {
		const policy = fileAt("features/account/adult-content-policy.ts");
		expect(policy).toContain(
			'platform === "ios" ? "web-only" : "native-confirm"',
		);
		/** Eligibility is decided by the shared function; it is not reassembled here. */
		expect(policy).toContain("AdultVisibilityState");
	});

	/**
	 * **No stale explanation remains.** The sentence "the identity authority's SDK does not run in
	 * React Native" is now false, and the next person who reads it would rebuild a working feature or
	 * revive the web fallback.
	 */
	it("no explanation remains that identity verification can't be done natively", () => {
		for (const file of files) {
			if (!/\.tsx?$/.test(file.path)) continue;
			const raw = readFileSync(join(SRC, file.path), "utf8");
			expect(raw, file.path).not.toMatch(
				/(doesn't|does not|can't|cannot) run (in|on) React Native/,
			);
		}
	});
});

describe("there's one channel for canonical web addresses", () => {
	/**
	 * **The assembly lives in one place.** This app sends people to the web in several spots (deletion
	 * guide, guardian consent, iOS adult-display opt-in, password reset, shared story addresses), and
	 * all of them must join the origin. Joining per spot makes trailing-slash handling and the "draw
	 * nothing without an origin" rule several copies, and the day one drops out, only that screen
	 * draws `//account-deletion` or a dead link.
	 */
	it("one place joins the origin: lib/public-web.ts", () => {
		const builders = product
			.filter((file) => /replace\(\/\\\/\+\$\//.test(file.text))
			.map((file) => file.path);
		expect(builders).toEqual(["lib/public-web.ts"]);
	});

	/**
	 * No code builds a string with `WEB_ORIGIN` outside that module — screens receive **only a
	 * complete address or `null`**.
	 */
	it("screens don't splice the origin into strings", () => {
		for (const file of product) {
			if (file.path === "lib/public-web.ts") continue;
			expect(file.text, file.path).not.toMatch(/\$\{WEB_ORIGIN/);
			expect(file.text, file.path).not.toMatch(/WEB_ORIGIN\s*\+/);
		}
	});
});
