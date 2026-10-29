import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of boundaries: rules the type checker cannot enforce.
 *
 * Every rule below fails the same way. It compiles, and the failure first shows up on a device. It
 * sits beside the web markup scan (`room-row-markup.test.ts`) and the server's route DB-access scan
 * (`no-route-db-access.test.ts`) for the same reason.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * Comments are stripped before scanning. Comments here explain a boundary by naming the banned
 * terms (e.g. "not in SQLite or AsyncStorage"). Scanning raw text would flag that explanation as a
 * violation and push people to delete the comment.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	/** The scanner holds the banned terms as patterns, so scanning itself would always fail. */
	.filter((file) => !file.path.endsWith("boundaries.test.ts"));

/**
 * Creator code is not this file's target.
 *
 * The runtime fixture (`lib/runtime-native/fixture.generated.ts`) is a compiled creator artifact,
 * not our screen. Values such as `fontSize: 20` and `gap: 12` there are runtime-contract vocabulary
 * (`RuntimeStyle` in `@rowcat/runtime`), not a bypass of our design tokens. Reading them as product
 * rules would tell us to "fix" numbers the creator chose.
 *
 * The file is listed by path rather than excluded by the `.generated.ts` suffix, because that
 * suffix would also drop our own generated files, some of which this check must cover.
 */
const CREATOR_SOURCE = new Set(["lib/runtime-native/fixture.generated.ts"]);

/** Tests and harnesses may use Node and dev-only code. Only the product path is scanned. */
const product = all.filter(
	(file) =>
		!file.path.startsWith("test/") &&
		!/\.test\.tsx?$/.test(file.path) &&
		!CREATOR_SOURCE.has(file.path),
);

describe("doesn't take in web presentation", () => {
	it("imports neither @rowcat/ui-web nor apps/web", () => {
		/**
		 * Sharing happens in contracts, domain, SDK, query, chat, authoring and sync. Web components
		 * render on the DOM and never render on mobile, so importing them fails the build long before
		 * anything else.
		 */
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/ui-web/);
			expect(file.text, file.path).not.toMatch(/from\s+["'].*apps\/web/);
			expect(file.text, file.path).not.toMatch(/from\s+["']dexie/);
		}
	});
});

describe("doesn't lean on browser globals", () => {
	it("no window, document, localStorage, IndexedDB, crypto.subtle or import.meta.env", () => {
		/**
		 * Hermes has none of these. The shared packages already keep this boundary (see the
		 * `@rowcat/sync` and `@rowcat/chat` headers), so the only risk is new code adding one here.
		 * `crypto.getRandomValues` is the exception; its wiring lives in `secure-random.ts` alone.
		 */
		const forbidden = [
			/\bwindow\./,
			/\bdocument\./,
			/\blocalStorage\b/,
			/\bindexedDB\b/,
			/crypto\.subtle/,
			/import\.meta\.env/,
		];
		for (const file of product)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	it("doesn't take Node built-ins into product paths", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/from\s+["']node:/);
	});
});

describe("doesn't put secrets in logs", () => {
	it("not a single console call in product paths", () => {
		/**
		 * No allowlist of "safe" log calls. Such a list always lags behind, and the values flowing
		 * through this app are chat bodies, draft manuscripts, DEKs, recovery codes and ciphertext. For
		 * diagnostics, the screen draws PASS/FAIL and counts (`dev-harness.ts`).
		 */
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/\bconsole\.\w+\(/);
	});

	it("the device key is neither SQLite, AsyncStorage nor a plain file", () => {
		const deviceKey = all.find((file) =>
			file.path.endsWith("local-sync/device-key.ts"),
		);
		expect(deviceKey).toBeDefined();
		// Storage is injected. This file knows only three operations.
		expect(deviceKey?.text).not.toMatch(/INSERT|UPDATE|SELECT|AsyncStorage/);

		const schema = all.find((file) =>
			file.path.endsWith("local-data/migrations.ts"),
		);
		expect(schema).toBeDefined();
		/**
		 * No column in the schema may hold a **secret**.
		 *
		 * This pattern used to be `recovery`, when the only place that word could appear was the recovery
		 * code. It no longer is: the local copy kept after a merge discards a value lives in the
		 * `sync_recovery` table. The pattern is narrowed to secrets only. What must stay out is the
		 * recovery **code** and the DEK, not the word "recovery".
		 */
		expect(schema?.text).not.toMatch(/device_key|\bdek\b|recovery_?code/i);
	});
});

describe("the auth identity doesn't take the product identity's place", () => {
	/**
	 * **The most expensive mistake to undo in this repo.**
	 *
	 * Better Auth's `session.user.id` identifies the login **method**. If that value selects the local
	 * database file, the file diverges from the member identity every other RowCat resource uses. The
	 * mismatch is silent: login works and screens open. It surfaces only when a second login method is
	 * added and one person's conversations seem to vanish. Both values are `string`, so the type
	 * checker cannot catch it.
	 */
	it("no session.user anywhere in product paths", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/session\??\.user\b/);
			expect(file.text, file.path).not.toMatch(/\buseSession\b/);
		}
	});

	it("the only value passed to the local scope is the viewer id", () => {
		const bridge = all.find((file) => file.path.endsWith("lib/identity.tsx"));
		expect(bridge).toBeDefined();
		/**
		 * Pins the expression passed to `viewerId=`. Any other value would still compile (both are
		 * strings), so the scan checks it instead.
		 */
		expect(bridge?.text).toMatch(
			/viewerId=\{session\.viewer\?\.id \?\? null\}/,
		);
	});

	/**
	 * The viewer's authority is the single `["viewer"]` query. A provider that keeps a
	 * `useState<Viewer>` copy diverges from it (failed sign-out, background refresh, invalidation
	 * elsewhere), and then nothing says which one is right.
	 */
	it("doesn't create a second viewer state", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/useState<\s*Viewer\b|useState<\s*Viewer\s*\|/,
			);
	});
});

describe("auth secrets don't leak", () => {
	/**
	 * Cookies are not persisted by us. Better Auth's SecureStore owns their lifetime. Any copy we made
	 * would survive sign-out, which does not clear it.
	 */
	it("cookies go into neither SQLite, plain files nor the query cache", () => {
		for (const file of product) {
			if (file.path.endsWith("lib/auth-fetch.ts")) continue;
			if (file.path.endsWith("lib/auth.ts")) continue;
			expect(file.text, file.path).not.toMatch(/\bgetCookie\b/);
			expect(file.text, file.path).not.toMatch(/["']Cookie["']\s*[,:]/);
		}
	});

	it("the auth store's and sync key's prefixes don't collide", () => {
		const auth = all.find((file) => file.path.endsWith("lib/auth.ts"));
		const deviceKey = all.find((file) =>
			file.path.endsWith("local-sync/device-key.ts"),
		);
		expect(auth?.text).toMatch(/"rowcat\.auth"/);
		expect(deviceKey?.text).toMatch(/"rowcat\.sync\.dek\."/);
	});

	/**
	 * The OAuth callback is an **internal path that has passed validation**.
	 *
	 * While there were two screens this value was the constant `"/"`, and this check pinned that
	 * literal. Discovery and story detail made the destination a value (someone who tapped a heart
	 * while logged out must return to that story), so what is locked now is that **the raw input never
	 * reaches that slot**. Passing a string from a deep link or query straight through lets Better
	 * Auth's Expo client turn it into an app deep link and hand it to the provider, and that link
	 * becomes the phishing path.
	 *
	 * The decision itself is tested in `return-path.test.ts`. This test checks the wiring only.
	 */
	it("callback addresses go through validation", () => {
		const identity = all.find((file) => file.path.endsWith("lib/identity.tsx"));
		expect(identity?.text).toMatch(
			/callbackURL: oauthCallbackPath\(returnPath\)/,
		);
		expect(identity?.text).toMatch(
			/const oauthCallbackPath[\s\S]{0,160}safeMobileReturnPath\(returnPath\)/,
		);
	});

	/**
	 * **Failure also has a destination.**
	 *
	 * Without `errorCallbackURL`, Better Auth sends failures to its own default instead of the success
	 * destination: `{API}/v2/auth/error`, which the library serves as English HTML. That is not an app
	 * scheme, so **the browser sheet does not close itself**, and the user is left on a screen this
	 * app never drew.
	 *
	 * Omitting it still compiles and the cancel path still works, so the defect shows up **only when
	 * the server rejects** (account not linked to an existing one, provider returned no email). So the
	 * wiring is locked here.
	 *
	 * The value must also be a constant. Success carries the return destination; a user who failed
	 * needs only a screen where the other ways in are laid out.
	 */
	it("failures come back to the app too", () => {
		const identity = all.find((file) => file.path.endsWith("lib/identity.tsx"));
		expect(identity?.text).toMatch(/errorCallbackURL: OAUTH_ERROR_PATH/);
		expect(identity?.text).toMatch(
			/const OAUTH_ERROR_PATH = ["']\/[a-z-]*["']/,
		);
	});

	/**
	 * Only one place may validate return paths. If screens each start writing `startsWith("/")`, one
	 * of them will eventually miss the check, and that one is an open redirect.
	 */
	it("no second implementation filters the return path by hand", () => {
		for (const file of product) {
			if (file.path.endsWith("lib/return-path.ts")) continue;
			expect(file.text, file.path).not.toMatch(
				/redirect[\s\S]{0,40}startsWith\(\s*["\u0027]\//,
			);
		}
	});
});

describe("passwords don't pass through the RowCat contract", () => {
	/**
	 * Authentication transport belongs to Better Auth. Once a password field exists in `@rowcat/sdk`
	 * or `@rowcat/contracts`, that value becomes part of our product protocol, and undoing it means
	 * changing a contract that is already deployed.
	 */
	it("doesn't call sign-in or sign-up through the SDK client", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(
				/getRowCatClient\(\)[\s\S]{0,40}\.auth\b/,
			);
			expect(file.text, file.path).not.toMatch(/client\.auth\.sign/);
		}
	});
});

describe("the place of native Apple sign-in is narrow", () => {
	/**
	 * **The second place this app handles credentials.**
	 *
	 * In the browser round trip the token never reaches the app (the plugin stores only the cookie).
	 * The native sheet does the opposite: **it hands the app the id token**. As more files learn that
	 * value, more places open where it can leak into logs, state or storage. This is the same axis as
	 * BYO provider keys sitting behind the single `local-provider` module.
	 */
	it("one place imports expo-apple-authentication", () => {
		const knowers = product
			.filter((file) => /expo-apple-authentication/.test(file.text))
			.map((file) => file.path);
		expect(knowers).toEqual(["lib/apple-auth.ts"]);
	});

	/**
	 * **The adapter decides nothing.** It returns one fact about what happened. Completing the
	 * session, clearing caches and choosing copy all belong to the caller. Calling
	 * `completeAuthentication` here would make cleanup differ per method, and the defect would show
	 * only to people who used that method.
	 */
	it("the adapter knows neither the completion procedure nor the identity", () => {
		const adapter = product.find((file) => file.path === "lib/apple-auth.ts");
		expect(adapter).toBeDefined();
		for (const forbidden of [
			"completeAuthentication",
			"authClient",
			"queryClient",
			"getRowCatClient",
			"AuthFlowError",
			"Platform",
		])
			expect(adapter?.text, forbidden).not.toContain(forbidden);
	});

	/**
	 * **The two nonce forms must not be swapped.**
	 *
	 * The hash goes to Apple and the raw value goes to the server (see the `apple-nonce.ts` header).
	 * Swapping them still compiles (both are hex strings), and the symptom is "only Apple gets
	 * rejected by the server", which is invisible without a device. The derivation itself is checked
	 * by value in `apple-nonce.test.ts`. This test checks the **wiring**.
	 */
	it("the hash goes to Apple and the original to the server", () => {
		const adapter = product.find((file) => file.path === "lib/apple-auth.ts");
		expect(adapter?.text).toMatch(/nonce:\s*nonce\.hashed/);
		expect(adapter?.text).toMatch(/nonce:\s*nonce\.raw/);

		const identity = product.find((file) => file.path === "lib/identity.tsx");
		expect(identity?.text).toMatch(
			/idToken:\s*\{[\s\S]{0,120}nonce:\s*attempt\.nonce/,
		);
		/** The hashed nonce never goes to the server from this file. */
		expect(identity?.text).not.toMatch(/nonce:\s*attempt\.hashed/);
	});

	/**
	 * **No silent fallback.** If the native path ends in an error, retrying through the browser round
	 * trip would hide a misconfigured audience on that deployment indefinitely, and the user would see
	 * the sheet twice. The only fallback branch is `unavailable`, which is a fact ("this device has no
	 * such sheet", always the case on Android), not an error.
	 */
	it("doesn't cover a native failure with a browser round trip", () => {
		const identity = product.find((file) => file.path === "lib/identity.tsx");
		expect(identity?.text).not.toMatch(/catch[\s\S]{0,80}signIn\.social/);
	});
});

/**
 * Files on the public screens (discover, story detail, public profile). The two checks below apply
 * only to this list.
 *
 * Route files are included on purpose: moving a screen into a feature and then re-gating it in the
 * route breaks the rule the same way.
 *
 * Adding the profile to this list is new in this slice. The screen has two member-only actions
 * (follow, block), but identity and public works must still show to guests. The existence of
 * actions does not justify gating the whole screen behind auth.
 */
/**
 * Product surface: **everything except the development-only visual QA lab.**
 *
 * The two kinds of checks below ask which bowl (component) a **product screen** picks up. The
 * visual QA lab (`features/visual-lab/`) is outside the question: its job is to stand up every
 * public bowl one by one and compare it with web, so by definition it calls all of them.
 *
 * The lab is excluded by **removing it from the set**, not by adding paths to the list. Adding it
 * would turn the list from "product surfaces that use this bowl" into "any file that calls this
 * bowl", and the next person would naturally add a product screen next to that entry. Keeping it
 * out means any product file that picks up the bowl breaks the check, as intended.
 *
 * Whether the lab exists is verified below. If the folder moves, this exception would silently
 * cover nothing.
 */
const VISUAL_LAB = "features/visual-lab/";
const productSurface = product.filter(
	(file) => !file.path.startsWith(VISUAL_LAB),
);

const publicSurface = product.filter(
	(file) =>
		file.path.startsWith("features/discover/") ||
		file.path.startsWith("features/story/") ||
		file.path.startsWith("features/profile/") ||
		file.path === "app/index.tsx" ||
		file.path === "app/stories/[storyId].tsx" ||
		file.path === "app/creators/[creatorId].tsx",
);

describe("public screens don't wait for auth or device storage", () => {
	it("the files to check actually exist", () => {
		/**
		 * If the filter above selects nothing, the checks below pass silently. This must fail when files
		 * move.
		 */
		expect(publicSurface.length).toBeGreaterThan(5);
	});

	/**
	 * **One of the hardest-to-undo structural mistakes this repo can make.**
	 *
	 * `useMobileAppPhase()` overlaps session state with SQLite state. If a public screen branches on
	 * it, reading public works starts depending on Better Auth and the device file. The defect is
	 * invisible to a developer who is logged in. It shows up when a logged-out user opens the app, or
	 * when `/me` is briefly slow.
	 *
	 * The type checker cannot catch this (both are plain boolean checks). The pure-function
	 * counterparts are `discover-state.test.ts` and `story-state.test.ts`.
	 */
	it("doesn't split public surfaces with useMobileAppPhase", () => {
		for (const file of publicSurface)
			expect(file.text, file.path).not.toMatch(/\buseMobileAppPhase\b/);
	});

	/**
	 * Reading the local scope is allowed: it is passed as an argument to pure decisions, and unit
	 * tests confirm that the reading is irrelevant. What is blocked is the form that returns early on
	 * it. `if (scope.status !== "ready") return …` alone makes the gallery wait for SQLite.
	 */
	it("doesn't end screens early on storage state", () => {
		for (const file of publicSurface)
			expect(file.text, file.path).not.toMatch(
				/if\s*\([^)]*scope\.status[^)]*\)\s*return/,
			);
	});
});

describe("product code doesn't call the API directly", () => {
	/**
	 * The single door is `getRowCatClient()`. Writing ``fetch(`${API_BASE_URL}/stories`)`` in a
	 * feature scatters path rules outside `@rowcat/contracts`, and such a request carries **no
	 * session** (only `auth-fetch.ts` attaches cookies).
	 */
	it("no fetch in feature code", () => {
		for (const file of product) {
			if (file.path.startsWith("lib/")) continue;
			expect(file.text, file.path).not.toMatch(/\bfetch\s*\(/);
			expect(file.text, file.path).not.toMatch(/\bAPI_BASE_URL\b/);
		}
	});

	/**
	 * Query keys and cache policy also belong to the shared packages. A mobile-only key puts server
	 * state in a different cell than web, so one favorite would update under different rules in each
	 * app.
	 */
	it("doesn't create mobile-only query keys", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/queryKey:\s*\[\s*["'](?!viewer)/,
			);
	});
});

describe("doesn't draw what doesn't exist yet", () => {
	/**
	 * What this slice **deliberately does not do.** A button is a promise. Drawing one while the
	 * screen that completes it does not exist means drawing a promise we cannot keep. A disabled
	 * button reads as "coming soon" too.
	 *
	 * The three that were here once (`stories.play`, `createRoom`, `Start conversation`) were removed because this
	 * slice built them. Their place is taken by the **next slice's boundary**. If the list empties,
	 * this check silently passes while protecting nothing.
	 */
	it("doesn't draw `Coming soon`", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/[Cc]oming soon/);
			expect(file.text, file.path).not.toMatch(/Coming soon/i);
		}
	});

	/**
	 * The chat list (`/chats`) now exists, so the direction of this check flipped.
	 *
	 * It used to say "no screen calls `listRooms`". That guarded that once a screen reads the room
	 * list, the navigation IA and the destination after deleting a room are decided together. Both are
	 * decided now (the shell's `Conversations` section and `/chats`). Deleting the list would make this check
	 * silently pass while protecting nothing, so it now pins **the call sites** instead.
	 *
	 * Having exactly one call site matters for the list's **nature**, not its order. A screen that
	 * reads the room list holds every conversation title for this account. With two such screens, the
	 * scope check applies to one, and a subscription gets forgotten in the other (where it goes stale
	 * silently).
	 */
	it("one subscription hook reads the room list", () => {
		/**
		 * The storage layer is not subject to this check: it is where the port is **defined**, plus the
		 * dev harness. It is listed rather than marked "does not call", because if that file moves, the
		 * check would protect nothing.
		 */
		const STORE_LAYER = new Set([
			"lib/local-data/chat-store.ts",
			"lib/local-data/stores.ts",
			"lib/local-data/dev-harness.ts",
		]);
		const readers = product
			.filter((file) => !STORE_LAYER.has(file.path))
			.filter((file) => /\blistRooms\b/.test(file.text))
			.map((file) => file.path);
		expect(readers).toEqual(["lib/local-data/use-rooms.ts"]);
	});

	/**
	 * **And the consumers of this hook are exactly two.**
	 *
	 * A second screen was attached to this query when the drawer appeared. The two screens ask
	 * different questions (a list to find and manage, versus the few recent rooms to return to). Only
	 * the **rule for choosing rows to draw** differs, and both rules live in `@rowcat/chat`. A change
	 * that adds a third consumer must answer in review whether that screen also needs every
	 * conversation title for this account.
	 */
	it("one unified library hook calls that hook", () => {
		/**
		 * The two screens (the browse-and-manage list, and the short recent list) now both pass through
		 * the **unified library hook**. It merges conversation rooms and runtime-library rows into one
		 * list. If that merge lived in two places, the drawer and `/chats` would eventually disagree on
		 * order.
		 */
		const consumers = product
			.filter((file) => file.path !== "lib/local-data/use-rooms.ts")
			.filter((file) => /\buseLocalRooms\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(consumers).toEqual([
			"features/chat-library/use-conversation-library.ts",
		]);
		const library = product
			.filter(
				(file) =>
					file.path !== "features/chat-library/use-conversation-library.ts",
			)
			.filter((file) => /\buseConversationLibrary\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(library).toEqual([
			"features/chat-library/use-room-library.ts",
			"features/shell/use-recent-rooms.ts",
		]);
	});

	/**
	 * **And the list never reads a message.**
	 *
	 * Drawing the last utterance on each row would add one query per room (N+1). Once the list screen
	 * reads conversation content, what is visible over someone's shoulder is the conversation, not its
	 * title. Search matching titles only is the same decision (`room-library.ts` in `@rowcat/chat`).
	 * The rule can only break if the list screen holds messages in the first place, so the check pins
	 * that.
	 */
	it("the conversation list doesn't read messages", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/chat-library/")) continue;
			expect(file.text, file.path).not.toMatch(/\blistRecentMessages\b/);
			expect(file.text, file.path).not.toMatch(/\blistAllMessages\b/);
			expect(file.text, file.path).not.toMatch(/\blistMemories\b/);
		}
	});

	/**
	 * The tail rewrite passes through **one door in the chat hook.**
	 *
	 * If screens call `editUserMessage`, `editAssistantMessage` or `deleteFromMessage` directly, the
	 * order is lost. The running generation must be cut and the history **rewritten before** the
	 * commit, so a late response does not attach to the spot just deleted (`rewriteHistory` in
	 * `use-chat-generation.ts`). An abort signal alone is not enough: a request that already received
	 * its whole body passes straight through the signal and arrives as a **success**.
	 *
	 * The defect passes compile and tests, and its symptom (a response left under a deleted
	 * conversation) is quiet.
	 */
	it("screens don't call the store's tail rewrite directly", () => {
		const allowed = new Set([
			"features/chat/generation/use-generation.ts",
			"features/chat/messages/use-actions.tsx",
		]);
		for (const file of product) {
			if (file.path.startsWith("lib/local-data/")) continue;
			if (allowed.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/\beditUserMessage\b/);
			expect(file.text, file.path).not.toMatch(/\beditAssistantMessage\b/);
			expect(file.text, file.path).not.toMatch(/\bdeleteFromMessage\b/);
		}
	});

	/**
	 * Memory writes belong to one memory workspace.
	 *
	 * If another screen starts calling them, the cascade on room deletion and this write meet in
	 * different transactions, and memories of a deleted room can come back.
	 */
	it("memory writes don't happen outside the memory workspace", () => {
		for (const file of product) {
			if (file.path.startsWith("lib/local-data/")) continue;
			if (file.path === "features/chat/memory/panel.tsx") continue;
			expect(file.text, file.path).not.toMatch(/\bcreateMemory\b/);
			expect(file.text, file.path).not.toMatch(/\bupdateMemory\b/);
			expect(file.text, file.path).not.toMatch(/\bdeleteMemory\b/);
		}
	});

	/**
	 * Room writes also belong to one room-management hook, for the same reason.
	 *
	 * Deletion takes messages and memories along **in the same transaction** (the `deleteRoom`
	 * contract), followed by leaving the room's screen. A second call site would split that ordering
	 * across two places.
	 */
	it("room rename and delete go through one composition module", () => {
		/**
		 * The hook no longer calls storage operations by name. The pure composition it calls does
		 * (`room-mutations.ts`), which lets the rules be checked without rendering.
		 */
		const writers = product
			.filter((file) => !file.path.startsWith("lib/local-data/"))
			.filter((file) => /\brenameRoom\b|\bdeleteRoom\b/.test(file.text))
			.map((file) => file.path);
		expect(writers).toEqual(["features/chat/room/mutations.ts"]);
	});

	/**
	 * **The creation tool exists now, so the rule here changed from absence to a boundary.**
	 *
	 * It used to say "no creating or publishing drafts". That was honest: having `AuthoringStore`
	 * wired in did not mean any screen used it. That premise is gone, so the boundary now locks
	 * **which folder owns these operations**. Leaving it as an absence would have let this check be
	 * deleted once the creation screen arrived, protecting nothing.
	 *
	 * Details live in `features/create/create-boundaries.test.ts`.
	 */
	it("only the creation folder creates and publishes drafts", () => {
		for (const file of product) {
			if (file.path.startsWith("lib/local-data/")) continue;
			if (file.path.startsWith("features/create/")) continue;
			expect(file.text, file.path).not.toMatch(/\bcreateDraft\b/);
			expect(file.text, file.path).not.toMatch(/\bpublishDraft\b/);
		}
	});
});

describe("the places that know BYO providers are narrow", () => {
	/**
	 * **Only the two adapters may know the provider endpoints.**
	 *
	 * If that address appears anywhere else, this app gets a second path to that host, and the path
	 * carries none of what the adapters enforce (error vocabulary, no body reads, no retries, abort
	 * signal).
	 */
	it("two adapters know the provider addresses", () => {
		const knowers = product
			.filter((file) =>
				/api\.anthropic\.com|generativelanguage\.googleapis/.test(file.text),
			)
			.map((file) => file.path)
			.sort();
		expect(knowers).toEqual([
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
		]);
	});

	/**
	 * **Also narrow: the files that know the secret-access port.**
	 *
	 * Storage, transport, the assembly point, and scope wiring, plus the three generation wirings that
	 * hand the port to transport. Settings, account, creation and profile are not here: those screens
	 * know only the summary (`Linked`). If this list starts growing, the boundary is eroding.
	 *
	 * The third wiring is the creator-runtime playback generation adapter. It belongs here for the
	 * same reason as conversation and auxiliary requests: if a creator's code running on a BYO target
	 * fell back to managed, the request would reach our server, which the person chose not to send.
	 *
	 * **The second slot, `utility-generation.ts`, is why this list stays fixed.** It used to hold
	 * `features/chat/memory/use-maintenance.ts`, and once reply suggestions landed the same wiring was
	 * about to be duplicated. The list would have reached eight, and a list that long makes the next
	 * auxiliary request adding one more line look ordinary. Instead the wiring was folded into one
	 * file. Maintenance and reply suggestions both call that function, and neither knows the
	 * credential port.
	 */
	it("seven places know the credential access port", () => {
		const knowers = product
			.filter((file) =>
				/ProviderCredentialAccess|useProviderCredentialScope|withCredential/.test(
					file.text,
				),
			)
			.map((file) => file.path)
			.sort();
		expect(knowers).toEqual([
			"features/chat/generation/use-generation.ts",
			"features/chat/utility-generation.ts",
			"features/runtime-player/use-runtime-generation.ts",
			"lib/generation/transport.ts",
			"lib/local-data/scope.tsx",
			"lib/local-data/stores.ts",
			"lib/local-provider/store.ts",
		]);
	});

	/**
	 * **The API key never reaches SQLite.** If the credential implementation knew the database,
	 * copying summaries into a plaintext file would be easy, and that copy would eventually carry the
	 * secret too.
	 */
	it("the credential implementation doesn't know SQLite", () => {
		for (const file of product) {
			if (!file.path.startsWith("lib/local-provider/")) continue;
			for (const forbidden of [
				"MobileDatabase",
				"SqlRunner",
				"expo-sqlite",
				"sqlite.ts",
				"INSERT",
				"SELECT",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
		}
	});

	/**
	 * **Connections do not sync.** There is no slot for them in the codec registry or the table order,
	 * so the protocol does not know this value exists. If it did, the user's API key would be uploaded
	 * to the server.
	 */
	it("provider connections aren't in the sync vocabulary", () => {
		const registry = all.find((file) =>
			file.path.endsWith("local-sync/registry.ts"),
		);
		expect(registry).toBeDefined();
		for (const forbidden of ["provider", "credential", "apiKey"])
			expect(registry?.text, forbidden).not.toContain(forbidden);

		const tables = all.find((file) =>
			file.path.endsWith("local-data/tables.ts"),
		);
		expect(tables).toBeDefined();
		for (const forbidden of ["provider_credential", "provider_connection"])
			expect(tables?.text, forbidden).not.toContain(forbidden);
	});

	/**
	 * Do not narrow the target vocabulary to `"rowcat"`, whether by type alias or literal comparison.
	 * The only branch point is transport. Everything else keeps `GenerationTarget` from `@rowcat/chat`
	 * as is.
	 */
	it("doesn't narrow the target vocabulary to managed alone", () => {
		for (const file of product) {
			if (file.path === "lib/generation/transport.ts") continue;
			expect(file.text, file.path).not.toMatch(
				/provider\s*[=!]==\s*["\u0027]rowcat["\u0027]/,
			);
		}
	});

	/**
	 * **BYO adapters do not know the managed path's vocabulary.** These requests never go through our
	 * server, so attempt identity, the SDK and storage have no reason to enter those files.
	 */
	it("adapters don't know the managed path's vocabulary", () => {
		for (const path of [
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
		]) {
			const adapter = product.find((file) => file.path === path);
			expect(adapter, path).toBeDefined();
			for (const forbidden of [
				"generationId",
				"newGenerationId",
				"@rowcat/sdk",
				"react",
				"ChatStore",
			])
				expect(adapter?.text, `${path} — ${forbidden}`).not.toContain(
					forbidden,
				);
		}
	});

	/**
	 * **No automatic retry on the direct-call path.** A retry after the stream has started even one
	 * character charges twice in the same turn and produces two responses in different styles, and the
	 * bill goes to the user's own provider account.
	 */
	it("adapters don't retry on their own", () => {
		for (const path of [
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
			"lib/generation/transport.ts",
		]) {
			const file = product.find((entry) => entry.path === path);
			expect(file, path).toBeDefined();
			for (const forbidden of ["retryCount", "maxRetries", "setTimeout"])
				expect(file?.text, `${path} — ${forbidden}`).not.toContain(forbidden);
			/** Common shape of a retry loop: rebuilding the same request inside a `for`. */
			expect(file?.text, path).not.toMatch(/for\s*\([^)]*attempt/);
		}
	});

	/**
	 * **Provider response bodies are not read.** They can include account and organization
	 * information, and sometimes echo back the prompt we sent.
	 */
	it("adapters don't read error bodies", () => {
		for (const path of [
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
		]) {
			const file = product.find((entry) => entry.path === path);
			expect(file?.text, path).not.toMatch(/response\.text\(\)/);
			expect(file?.text, path).not.toMatch(/response\.json\(\)/);
		}
	});

	/**
	 * **The key never goes into a URL.** Query strings land in proxy logs, access logs and diagnostic
	 * reports, some of which are outside our control.
	 */
	it("the Gemini adapter doesn't put the key in the query", () => {
		const gemini = product.find(
			(file) => file.path === "lib/generation/gemini.ts",
		);
		expect(gemini?.text).toContain("x-goog-api-key");
		expect(gemini?.text).not.toMatch(/[?&]key=/);
	});

	/**
	 * **Native failures are not described as browser failures.** This runtime has no CORS, no
	 * extension and no CSP, and guidance about a cause that does not exist sends the user somewhere
	 * wrong.
	 */
	it("the error vocabulary has no browser branch", () => {
		const errors = product.find(
			(file) => file.path === "lib/generation/errors.ts",
		);
		expect(errors).toBeDefined();
		for (const forbidden of ["browser_blocked", "CORS", "extension"])
			expect(errors?.text, forbidden).not.toContain(forbidden);
	});
});

describe("automatic maintenance has only wiring", () => {
	/**
	 * The **rules** for maintenance live once in `@rowcat/chat` (cadence, batching, validation,
	 * rewind). If the app re-writes any of them, the same conversation summarizes differently on web
	 * and mobile, and the difference shows up on only one platform. It appears only when you compare
	 * the two screens side by side.
	 *
	 * Specifically, this blocks cutting batches with `slice` or re-typing constants. That line looks
	 * like an ordinary diff in review, and when it is wrong it appears as "summaries look odd only in
	 * this app".
	 */
	it("the app doesn't rewrite batch or cadence rules", () => {
		for (const file of product) {
			if (file.path === "features/chat/memory/use-maintenance.ts") {
				// The wiring calls only the runner and target resolution, not the rule functions.
				expect(file.text, file.path).not.toMatch(/\bselectMaintenanceBatch\b/);
				expect(file.text, file.path).not.toMatch(/\bplanMemoryMaintenance\b/);
				expect(file.text, file.path).not.toMatch(/\bplanMaintenanceRewind\b/);
			}
			expect(file.text, file.path).not.toMatch(
				/CHAT_MAINTENANCE_(TRIGGER|BATCH_MAX|RECENT_KEEP)\s*=/,
			);
		}
	});

	/**
	 * The maintenance commit passes through one repository operation (`applyMemoryMaintenance`). If a
	 * screen assembles memory writes to imitate it, the summary, frontier and memories meet in
	 * **different transactions**, and a room whose frontier advanced alone records that span as
	 * processed while never processing it again.
	 */
	it("maintenance commits go through one store operation", () => {
		const callers = product
			.filter((file) => /\bapplyMemoryMaintenance\b/.test(file.text))
			.map((file) => file.path)
			.filter((path) => !path.startsWith("lib/local-data/"));
		expect(callers).toEqual(["features/chat/memory/use-maintenance.ts"]);
	});
});

describe("screens don't call sync directly", () => {
	/**
	 * The wiring that wakes automatic sync on local writes belongs to the **assembly point**
	 * (`local-data/stores.ts` wraps the stores as write signals). If a screen, composer or generation
	 * hook calls `syncNow()` or similar directly, there is a second execution path alongside the
	 * coordinator, and the single-run guard, backoff and account isolation do not apply to it.
	 */
	it("doesn't push sync directly after sending a message", () => {
		for (const file of product) {
			if (file.path.startsWith("lib/local-data/")) continue;
			if (file.path.startsWith("lib/local-sync/")) continue;
			expect(file.text, file.path).not.toMatch(/\bsyncNow\b/);
			expect(file.text, file.path).not.toMatch(/\bapplyPull\b/);
			/**
			 * `requestSync` is the one entry point open to the sync feature screens (`features/sync/`). It
			 * is a coordinated door for "now it can run" moments, such as unlocking or finishing pairing. It
			 * is not a second execution path, since the single-run, backoff and ownership checks all apply.
			 * That this screen cannot call the controller directly is locked by
			 * `features/sync/sync-boundaries.test.ts`.
			 */
			if (file.path.startsWith("features/sync/")) continue;
			expect(file.text, file.path).not.toMatch(/\brequestSync\b/);
		}
	});
});

describe("the conversation screen doesn't expose the prompt", () => {
	/**
	 * The replay snapshot holds content the creator hid (protected-prompt works). If screen code draws
	 * that value, or starts parsing the assembled system prompt, what `promptProtected` guards leaks
	 * through a debugging UI.
	 */
	it("doesn't draw the seed's authored content", () => {
		const chat = product.filter((file) =>
			file.path.startsWith("features/chat/"),
		);
		expect(chat.length).toBeGreaterThan(4);
		for (const file of chat) {
			expect(file.text, file.path).not.toMatch(/seed\.scenario/);
			expect(file.text, file.path).not.toMatch(/seed\.playGuide/);
			expect(file.text, file.path).not.toMatch(/seed\.lore/);
			expect(file.text, file.path).not.toMatch(/\bsystem\b\s*\}/);
		}
	});
});

describe("doesn't bypass the design system", () => {
	/**
	 * **Blocks the reintroduction of what this slice removed.**
	 *
	 * The app once had `#18181b`, `#71717a` and `#fafafa` scattered across fourteen screens. Those
	 * literals cannot express the light theme (each has one value), and nobody could tell which were
	 * the same meaning: `#141416` and `#18181b` were both "card background".
	 *
	 * The source of values is `@rowcat/design` alone, and the way to pick by meaning is `useTheme()`.
	 */
	it("doesn't write color literals", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
			expect(file.text, file.path).not.toMatch(/\brgba?\(/);
			expect(file.text, file.path).not.toMatch(/\bhsla?\(|\boklch\(/);
		}
	});

	/**
	 * Also blocks picking a color directly. Importing `nativeDarkColors.card` makes that screen ignore
	 * the theme and draw dark forever. It is the same defect as a literal, but harder to find.
	 */
	it("doesn't skip the theme to read the palette directly", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(
				/nativeLightColors|nativeDarkColors/,
			);
			expect(file.text, file.path).not.toMatch(/@rowcat\/design\/native/);
			expect(file.text, file.path).not.toMatch(/\buseColorScheme\b/);
		}
	});

	/**
	 * Font size and weight are not chosen by screens either. Scattered `fontSize: 13` destroys the
	 * hierarchy, and then nothing can answer "which one is the title". The `Text` variants are that
	 * answer.
	 *
	 * **Line height now falls under this too.** It used to be an exception (long bodies need more
	 * spacing than the variant default, and that is still true). But under that exception, only
	 * **three values, 22, 25 and 22,** actually grew. Story descriptions, comments and bubbles each
	 * picked their own, and none matched what web uses in the same spot (`leading-7`, 28). The meaning
	 * now has a name (`<Text leading="reading">`), so the exception is closed.
	 */
	it("doesn't write font size, weight or line height by hand", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bfontSize:/);
			expect(file.text, file.path).not.toMatch(/\bfontWeight:/);
			expect(file.text, file.path).not.toMatch(/\blineHeight:/);
		}
	});

	/**
	 * **Do not override color with `color: undefined`.**
	 *
	 * React Native style merging writes `undefined` as a value. If the last object carries `color:
	 * undefined`, the color `tone` chose is erased and the **platform default (black)** remains.
	 *
	 * The defect is quiet for that reason. In the light theme the black looks plausible, and **only in
	 * dark theme** does the text sink into the background. Favorite counts had disappeared this way
	 * while compile and tests passed. Pick conditional colors through `tone`.
	 */
	it("doesn't cover conditional colors with undefined in style", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/color:[^,;}\n]*\bundefined\b/);
	});

	/**
	 * **Spacing also comes from the scale, but the check must be narrow.**
	 *
	 * Unlike color and type, a broad spacing check becomes wrong immediately. A rule like
	 * `\b(4|8|12|16)\b` catches widths, heights, offsets, pixel math, ratios and tap sizes alike, and
	 * then people turn the check off.
	 *
	 * So it is narrowed on two axes:
	 *
	 * ```text
	 * which property   only gap · padding* · margin* (width, height, left and top are geometry)
	 * which value      only values actually present in `space` (4·8·12·16·24·32·48·1)
	 * ```
	 *
	 * The second axis is the point of the rule. What it catches is always "a value from the shared
	 * scale, retyped by hand". Numbers outside the scale (2·3·5·6·10·14·20·40) are **intended feature
	 * geometry** and pass: the bubble's 14, the 10 inside a card, the 5 between a heart and its count.
	 * `0` passes too, since "no padding" is not a scale value.
	 *
	 * The goal is not to eliminate numbers but to keep the source of ordinary rhythm in one place.
	 */
	it("doesn't write the shared scale's values into spacing by hand", () => {
		const SPACING_PROPERTY =
			/\b(gap|rowGap|columnGap|padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingStart|paddingEnd|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|marginStart|marginEnd):\s*(-?\d+)\b/g;
		/** Values `space` in `@rowcat/design` actually holds. Any other number is feature geometry. */
		const SCALE = new Set([1, 4, 8, 12, 16, 24, 32, 48]);

		for (const file of product)
			for (const [text, , value] of file.text.matchAll(SPACING_PROPERTY))
				expect(
					SCALE.has(Math.abs(Number(value))),
					`${file.path} — \`${text}\` is a space scale value. Write it as a token.`,
				).toBe(false);
	});

	/**
	 * Do not rebuild primitives.
	 *
	 * Drawing `TextInput` or `ActivityIndicator` directly in a screen makes that spot own its own
	 * surface and color, which is how color literals entered this app. The route is `BareInput` and
	 * `Spinner` in `@rowcat/ui-native`.
	 *
	 * `Text`, `View`, `Pressable`, `Image` and `FlatList` are not blocked. They are the materials for
	 * layout and virtualization, and wrapping them would take away a screen's control over list
	 * configuration.
	 */
	it("doesn't draw text fields or busy indicators directly", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bTextInput\b/);
			expect(file.text, file.path).not.toMatch(/\bActivityIndicator\b/);
		}
	});

	/**
	 * **Screens do not call icon libraries directly.**
	 *
	 * The route is `<Icon name="…" />` in `@rowcat/ui-native`, and it takes a **meaning** rather than
	 * a picture name (`favorite`, `back`, `send`). If a screen starts writing `import { Heart } from
	 * "lucide-react-native"`, the same meaning gets a different picture on each screen, and swapping
	 * the icon set becomes a whole-app search. That coupling does not show up as a compile error. It
	 * just works.
	 *
	 * `react-native-svg` is blocked too. That dependency is paid for by one icon (see the
	 * `packages/ui-native/src/icon.tsx` header). If screens start drawing SVG directly, the answer to
	 * "why do we need SVG" changes.
	 */
	it("doesn't import the icon library directly", () => {
		const forbidden = [
			/lucide-react/,
			/@expo\/vector-icons/,
			/react-native-svg/,
			/\bFeather\b/,
			/\bIonicons\b/,
			/\bMaterialIcons\b/,
		];
		for (const file of product)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	/**
	 * If a screen uses `Text` from `react-native` directly, it passes the size check above but draws
	 * in the platform default color (black): invisible text in dark theme. The name `Text` must come
	 * from `@rowcat/ui-native`.
	 */
	it("doesn't take react-native's Text directly", () => {
		for (const file of product) {
			const rn = /import\s*\{([^}]*)\}\s*from\s*["']react-native["']/.exec(
				file.text,
			);
			if (!rn) continue;
			expect(rn[1].split(","), file.path).not.toContain(" Text");
			expect(
				rn[1].split(",").map((n) => n.trim()),
				file.path,
			).not.toContain("Text");
		}
	});
});

describe("the grid's geometry comes from one place", () => {
	/**
	 * **Blocks a bug where the remaining card in an incomplete last row stretched to the full row
	 * width.**
	 *
	 * The cause was that the card set its width with `flex: 1`. That means "share the remaining space
	 * with siblings", so in a row with no siblings it becomes 100%. The state never shows in
	 * development data with an even count, and only appears for someone who published an odd number.
	 *
	 * The rule itself (the percentage is independent of count) is checked by value in
	 * `features/discover/grid.test.ts`. This test checks **wiring**: do the two files read the same
	 * derivation.
	 */
	const fileAt = (path: string) => product.find((file) => file.path === path);

	it("cell width comes from a derived value", () => {
		const card = fileAt("features/discover/story-card.tsx");
		expect(card).toBeDefined();
		expect(card?.text).toMatch(/width: DISCOVER_CELL_WIDTH/);
		expect(card?.text).toMatch(/paddingHorizontal: DISCOVER_CELL_GUTTER/);
	});

	/**
	 * If the list sets the column count separately, changing to three columns updates only the cell
	 * width and leaves cards outside the row. The symptom is not an error but cards pushed out of the
	 * row.
	 */
	it("the list doesn't rewrite the column count", () => {
		const screen = fileAt("features/discover/discover-screen.tsx");
		expect(screen).toBeDefined();
		expect(screen?.text).toMatch(/numColumns=\{DISCOVER_COLUMNS\}/);
		expect(screen?.text).not.toMatch(/numColumns=\{\s*\d/);
	});

	/**
	 * The gutter belongs to the cell. Putting `gap` back on the row adds that value on top of the
	 * cell's half-gutter, widening the space between columns. In cells that fell back to `flex`, the
	 * last row stretches again.
	 */
	it("rows have no horizontal gutter", () => {
		const screen = fileAt("features/discover/discover-screen.tsx");
		const row = /row: \{([^}]*)\}/.exec(screen?.text ?? "")?.[1];
		expect(row).toBeDefined();
		expect(row).not.toMatch(/\bgap:|\bcolumnGap:/);
		expect(row).toMatch(/paddingHorizontal: DISCOVER_ROW_INSET/);
	});
});

describe("the global navigation surface is the drawer alone", () => {
	/**
	 * **The direction of this group has flipped.**
	 *
	 * It used to say "no tab bar, drawer or sidebar". That reason was honest: the app had only four
	 * destinations, so mimicking the web shell's vocabulary (three sidebar items plus three header
	 * utilities) would have added items that did nothing when pressed. That premise is gone. There are
	 * now two destinations you can really reach (discover, and the chat list). While nothing joined
	 * them, the discover header carried a temporary icon linking to the chat list.
	 *
	 * So what is locked now is **the shape, not absence**. If the surface is deleted, this check
	 * passes silently and protects nothing, so it pins which file owns the surface.
	 */
	const fileAt = (path: string) => product.find((file) => file.path === path);
	const sidebar = fileAt("features/shell/app-sidebar.tsx");

	it("the drawer actually exists", () => {
		expect(sidebar, "app-sidebar.tsx").toBeDefined();
	});

	/**
	 * **Neither a tab bar nor a drawer navigator.**
	 *
	 * This slice did not rebuild the navigation stack. The drawer is a layer **on top of the route
	 * stack**, and navigation stays with expo-router. Moving to `createDrawerNavigator` would change
	 * screen lifetime, back navigation and deep linking all at once, an architecture swap this change
	 * did not ask for.
	 */
	it("doesn't change the navigator", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bTabs\b|\bcreateBottomTab/);
			expect(file.text, file.path).not.toMatch(/createDrawerNavigator/);
			expect(file.text, file.path).not.toMatch(/@react-navigation\/drawer/);
		}
	});

	/**
	 * **One place opens the drawer.**
	 *
	 * Mounting `<NavigationDrawer>` per screen creates four copies of the same content, and one copy
	 * then quietly gets an extra item or misses a recent conversation. Screens draw only the trigger
	 * (`AppSidebarTrigger`), and the trigger and the panel are the same component. Accessible focus
	 * restoration requires that coupling (see `navigation-drawer.tsx` in `@rowcat/ui-native`).
	 */
	it("one file draws the drawer", () => {
		/** The lab draws every bowl by design, so it is outside this question (`productSurface`). */
		const owners = productSurface
			.filter((file) => /<NavigationDrawer/.test(file.text))
			.map((file) => file.path);
		expect(owners).toEqual(["features/shell/app-sidebar.tsx"]);

		/** The excluded files really exist. Without them the filter above does nothing. */
		expect(product.some((file) => file.path.startsWith(VISUAL_LAB))).toBe(true);
	});

	/**
	 * **Three destinations, all real screens.**
	 *
	 * `Create` was absent for a while not because it differs from web, but because this app had no such
	 * screen. That premise is gone (`/create` exists and opens offline). The order is locked because
	 * the sidebar must match web's IA: the same spot in a different order reads as a different list to
	 * the user.
	 *
	 * Utilities still do not come here. Once a panel appears on the left, that panel becomes "leftover
	 * space", and settings, theme, notifications, account and sign-out pile into it. Identity stays
	 * with the header (`app-header.tsx`).
	 */
	it("the drawer has three destinations in the same order as the web", () => {
		const order = [
			...(sidebar?.text ?? "").matchAll(/section:\s*"(\w+)"/g),
		].map((match) => match[1]);
		expect(order).toEqual(["discover", "chat", "create"]);
		expect(sidebar?.text).toContain('to: "/create"');
	});

	it("doesn't draw utilities in the drawer", () => {
		for (const absent of [
			"Settings",
			"Account",
			"Notifications",
			"Sign out",
			"Sign in",
			'"Theme"',
			"Diagnostic",
			"sync",
			/** Recent drafts are an **intended asymmetry**. The web did not build that list either. */
			"recent drafts",
			"Drafts",
		])
			expect(sidebar?.text, absent).not.toContain(absent);
	});

	/**
	 * The copy table is `Record<MobileAppSection, string>`, so a new vocabulary value breaks
	 * compilation first. The value check is still worth it, because the type does not say that the
	 * table holds the **same set** as the list.
	 */
	it("the section copy is three words, the same as the web", () => {
		const copy = fileAt("features/shell/sidebar-copy.ts")?.text ?? "";
		expect(copy).toContain('discover: "Discover"');
		expect(copy).toContain('chat: "Conversations"');
		expect(copy).toContain('create: "Create"');
	});

	/**
	 * **Recent conversations are a switcher, not a list screen.**
	 *
	 * Each row draws only a title. Once a management menu attaches to a row, a 280pt panel has to hold
	 * a conversation list screen again, and that screen already exists separately (`All conversations` is the
	 * boundary line here). Previews are not drawn, for privacy before performance: what would be
	 * visible over someone's shoulder is the conversation, not its title.
	 */
	it("recent conversation rows have neither management nor previews", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/shell/")) continue;
			expect(file.text, file.path).not.toMatch(/\bRoomActionsMenu\b/);
			expect(file.text, file.path).not.toMatch(/\buseRoomManagement\b/);
			expect(file.text, file.path).not.toMatch(/\blistRecentMessages\b/);
			expect(file.text, file.path).not.toMatch(/\blistAllMessages\b/);
			expect(file.text, file.path).not.toMatch(/\blistMemories\b/);
		}
	});

	/**
	 * **The trimming rule is not the app's.**
	 *
	 * The limit (10) and the "the currently open room stays even when it falls outside the window"
	 * exception live in `recentSidebarRooms` in `@rowcat/chat`, and **web calls the same function.**
	 * Writing `slice(0, 10)` here would give the same rooms in different order and count on the two
	 * apps, and the difference shows up only when the two screens are compared side by side.
	 */
	it("the app doesn't re-cut the recent window", () => {
		const hook = fileAt("features/shell/use-recent-rooms.ts");
		expect(hook?.text).toMatch(/recentSidebarRooms/);
		for (const file of product) {
			if (!file.path.startsWith("features/shell/")) continue;
			expect(file.text, file.path).not.toMatch(/\.slice\(/);
			expect(file.text, file.path).not.toMatch(/SIDEBAR_RECENT_CHAT_LIMIT\s*=/);
		}
	});

	/**
	 * **The route is the source of truth for the active resource.**
	 *
	 * Shadow state such as `selectedSection` or `selectedRoomId` turns deep links, back navigation and
	 * stack restoration into features that each need patching. When two identities diverge there is no
	 * way to decide which to trust. The decision is one pure function
	 * (`features/shell/shell-route.ts`).
	 */
	it("doesn't hold the active section or room as state", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/shell/")) continue;
			expect(file.text, file.path).not.toMatch(
				/setSelectedSection|setActiveRoom/,
			);
			expect(file.text, file.path).not.toMatch(
				/useState[^\n]*(selectedSection|selectedRoom)/,
			);
		}
		expect(fileAt("features/shell/app-sidebar.tsx")?.text).toMatch(
			/mobileShellRouteFor\(pathname\)/,
		);
	});

	/**
	 * **The discover header draws no navigation now, and no trigger either.**
	 *
	 * For a while this line had a chat-list icon (a temporary wire-up while no global navigation
	 * surface existed). Once that was removed, the drawer trigger took its place. Now even that
	 * trigger is gone. This screen is the home of a primary destination, so the bottom row carries
	 * navigation here, and **only one global navigation surface shows at a time**
	 * (`features/shell/primary-nav.tsx`).
	 *
	 * So the check now runs the other way: this header has **no** destinations.
	 */
	it("the header doesn't draw global destinations", () => {
		const header = fileAt("features/shell/app-header.tsx");
		expect(header?.text).not.toContain("AppSidebarTrigger");
		expect(header?.text).not.toContain("PrimaryNav");
		expect(header?.text).not.toMatch(/["'`]\/chats["'`]/);
		expect(header?.text).not.toMatch(/icon="chats"/);
	});

	/**
	 * **The bottom row uses the same vocabulary and order as the drawer.**
	 *
	 * It reads both the label table (`SIDEBAR_SECTION_LABEL`) and the section vocabulary
	 * (`MobileAppSection`). The two surfaces therefore speak the same words, and the same order means
	 * users do not read the drawer and the bottom row as different lists. A second label table would
	 * make `Conversations` and `Chats` coexist in one app the moment it was created.
	 */
	it("the bottom row has three destinations in the same order as the drawer", () => {
		const nav = fileAt("features/shell/primary-nav.tsx");
		expect(nav, "primary-nav.tsx").toBeDefined();
		const order = [...(nav?.text ?? "").matchAll(/section:\s*"(\w+)"/g)].map(
			(match) => match[1],
		);
		expect(order).toEqual(["discover", "chat", "create"]);
		expect(nav?.text).toContain("SIDEBAR_SECTION_LABEL");
	});

	/**
	 * **The bottom row carries no utilities.** The drawer follows the same rule for the same reason: a
	 * row meant for three items that gets a fourth stops being a destination list and becomes
	 * "leftover space".
	 */
	it("doesn't draw utilities in the bottom row", () => {
		const nav = fileAt("features/shell/primary-nav.tsx")?.text ?? "";
		for (const absent of [
			"Settings",
			"Account",
			"Notifications",
			"Sign out",
			"Sign in",
			'"Theme"',
			"/settings",
			"/account",
			"/notifications",
		])
			expect(nav, absent).not.toContain(absent);
	});

	/**
	 * **Global navigation is `navigate`.** `push` stacks a new layer on every tap, and `replace`
	 * removes the place to go back to from story detail (the same rule as the drawer's list).
	 */
	it("the bottom row moves with navigate", () => {
		const nav = fileAt("features/shell/primary-nav.tsx")?.text ?? "";
		expect(nav).toContain("router.navigate(item.to)");
		expect(nav).not.toMatch(/router\.(push|replace)\(/);
	});
});

describe("local-first data doesn't go into the query cache", () => {
	it("files using the store don't also take TanStack Query", () => {
		/**
		 * Two sources of truth diverge the moment both exist, and if the screen draws the diverged one,
		 * the user reads their own saved text as lost. Rooms and drafts belong to SQLite.
		 */
		for (const file of product) {
			if (!/local-data\/|local-sync\//.test(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/@tanstack\/react-query/);
		}
	});
});

/**
 * Whether the chat screen **actually draws** the behavior. Having shared rules and primitives does
 * not mean the screen uses them.
 *
 * This check exists because it happened. In the slice that built `ComposerArea`, **the screen did
 * not render it**, and `Screen` still omitted `bottom`, so the input sat over the home indicator
 * while compile and tests passed. The same regression can happen with other actions: sharing
 * `messageActionsFor`, creating `useRoomManagement`, and writing every sheet still gives users **no
 * feature** if no row attaches a trigger.
 *
 * So this checks **wiring**, not rules. Copy and layout are not locked. Those break on every design
 * change, and what this check catches is a feature quietly vanishing.
 */
describe("the conversation screen actually draws its operations", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);

	const screen = fileAt("features/chat/chat-screen.tsx");
	const list = fileAt("features/chat/messages/list.tsx");
	const row = fileAt("features/chat/messages/row.tsx");
	/** The room action menu in the chat list rows. It sits in a **different spot** from the open room's header (below). */
	const menu = fileAt("features/chat/room/actions-menu.tsx");

	it("the files to check actually exist", () => {
		expect(screen, "chat-screen.tsx").toBeDefined();
		expect(list, "message-list.tsx").toBeDefined();
		expect(row, "message-row.tsx").toBeDefined();
		expect(menu, "room-actions-menu.tsx").toBeDefined();
	});

	/**
	 * The header carries **two** actions here, the same pair as web (`apps/web`'s
	 * `chat-header-context.tsx`).
	 *
	 * ```text
	 * web      title ......  [search 🔍]  [room settings ☰]
	 * here     ‹ title ....  [search 🔍]  [room settings ☰]
	 * ```
	 *
	 * For a while this spot had only an overflow `⋯`, and **every** room action went through that
	 * menu. Its list differed from web, and that was justified while there was only one container.
	 * When containers were aligned with web, the justification went away. This check blocks that
	 * reversion.
	 *
	 * **Search and settings are both visible because they differ in kind.** Settings is the door to
	 * changing this room's values, while search scans its content. Folding search into a row inside
	 * settings would remove the visible entry point to something otherwise reached only by a shortcut.
	 */
	it("the header has two: find and conversation settings", () => {
		expect(screen?.text).toMatch(/useRoomManagement\(/);
		expect(screen?.text).toMatch(/icon="search"/);
		expect(screen?.text).toMatch(/icon="room-settings"/);
		/**
		 * The trigger **names its target**. This spot used to be `management.openSettings`, and back then
		 * the management hook always targeted the currently open room, so no argument was needed. The
		 * chat list changed that. The same hook now opens for any row in the list, so this spot names
		 * which room the settings are for.
		 */
		expect(screen?.text).toMatch(
			/onPress=\{\(\) => management\.requestSettings\(room\)\}/,
		);
		/** The open surface really renders in the tree. */
		expect(screen?.text).toMatch(/\{management\.surfaces\}/);
	});

	/**
	 * **The room overflow `⋯` does not come back.**
	 *
	 * When someone asks for another room action, the fastest answer is to revive this menu. Then two
	 * doors for the same room, "management menu" and "settings", sit 20pt apart, and nobody remembers
	 * which holds what. New actions belong in a section within settings, and that structure is defined
	 * by `ROOM_SETTINGS_IA` in `@rowcat/chat`.
	 */
	it("the header has no room overflow menu", () => {
		expect(screen?.text).not.toMatch(/icon="more"/);
		expect(screen?.text).not.toMatch(/management\.menu/);
		/**
		 * **The chat list rows do have that menu, and the two are different problems.**
		 *
		 * The list has twenty rooms, each with its own actions. If those actions are not attached to each
		 * row, deleting one room means entering it and coming back out. That reasoning does not hold for
		 * this screen (the header of one open room): settings is already the door there.
		 *
		 * Both facts are pinned together, because this check must not read as "this app has no room
		 * overflow menu". A change that removes the list-row menu would otherwise pass this file green.
		 */
		expect(menu?.text).toMatch(/<DropdownMenu/);
		expect(menu?.text).toMatch(/roomActionsLabel\(room\.title\)/);
	});

	/**
	 * Saved-message row actions. The list receives nodes (`renderActions`), the screen builds those
	 * nodes, and the overflow opens the message actions owner.
	 */
	it("saved message rows have operations", () => {
		expect(screen?.text).toMatch(/renderActions=\{/);
		expect(screen?.text).toMatch(/<MessageActionBar/);
		expect(screen?.text).toMatch(/menu=\{messageActions\.renderMenu\(/);
		expect(screen?.text).toMatch(/\{messageActions\.surfaces\}/);
	});

	/**
	 * **Streaming rows have no actions.** They are not records yet: there is no source text to copy,
	 * no identity to report, and no tail to delete. The list makes that judgment.
	 */
	it("streaming rows get no operations", () => {
		expect(list?.text).toMatch(/streaming \? null : renderActions\?\.\(/);
	});

	/**
	 * The bottom edge's owner **wraps the composer.** The safe-area check above only verifies that two
	 * names are in the same file, so a sibling standing next to it would pass.
	 */
	it("the composer is inside ComposerArea", () => {
		expect(screen?.text).toMatch(
			/<ComposerArea>[\s\S]{0,400}<Composer[\s\S]{0,400}<\/ComposerArea>/,
		);
	});

	/**
	 * Route back to the latest. When a new response arrives while the user reads older messages, the
	 * screen does not get pulled down, but there **must** be a way back. Otherwise the user does not
	 * even know a new response arrived.
	 */
	it("there's an operation to go back to the latest", () => {
		expect(list?.text).toMatch(/scrollToOffset\(\{[\s\S]{0,80}offset: 0/);
		expect(list?.text).toMatch(/icon="jump-latest"/);
	});

	/**
	 * **The highlight for a line jumped to from search belongs to the list.**
	 *
	 * This used to be a request-owned value: the list called `onRevealed()` right after jumping, which
	 * cleared it, so the highlight was never seen. The two values must stay separate.
	 */
	it("the jumped-to row's marker expires on its own", () => {
		expect(list?.text).toMatch(/setHighlight\(/);
		expect(list?.text).toMatch(/setTimeout\([\s\S]{0,60}HIGHLIGHT_MS\)/);
		/** The highlight must not be tied to the request value. */
		expect(list?.text).not.toMatch(/highlighted=\{item\.id === revealId\}/);
	});
});

describe("each safe area edge has exactly one owner", () => {
	/**
	 * **This check blocks the defect this slice fixed from coming back.**
	 *
	 * The chat screen omits `bottom` from `Screen`'s `edges`. That means "another layer owns this
	 * edge", but for a while **that other layer did not exist**: the comment pointed at
	 * `KeyboardComposerArea`, which was not a component. The symptom is quiet. The input and send
	 * button sit over the home indicator and the gesture bar.
	 *
	 * So the check goes **in pairs**: a screen that omits the bottom must have that edge's owner in
	 * the same file.
	 */
	const chatScreen = product.find(
		(file) => file.path === "features/chat/chat-screen.tsx",
	);

	it("the files to check actually exist", () => {
		expect(chatScreen).toBeDefined();
	});

	it("screens dropping the bottom have that edge's owner with them", () => {
		for (const file of product) {
			const excludesBottom = /edges=\{\[(?![^\]]*"bottom")[^\]]*\]\}/.test(
				file.text,
			);
			if (!excludesBottom) continue;
			expect(file.text, `${file.path} — the bottom has no owner`).toMatch(
				/\bComposerArea\b/,
			);
		}
	});

	/**
	 * **Feature code does not know the device geometry.**
	 *
	 * Safe area and keyboard belong to the `@rowcat/ui-native` layer (`Screen`, `ComposerArea`,
	 * `Sheet`, `KeyboardLayout`). If a screen starts computing its own padding, two corrections that
	 * do not know about each other sit on the same edge, and their sum is always wrong. A 34pt empty
	 * band remains when the keyboard rises, or the input ends up under the keyboard.
	 */
	it("screens don't read safe areas and the keyboard directly", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(
				/react-native-safe-area-context/,
			);
			expect(file.text, file.path).not.toMatch(/\buseSafeAreaInsets\b/);
			expect(file.text, file.path).not.toMatch(/\bSafeAreaView\b/);
			expect(file.text, file.path).not.toMatch(/\bKeyboardAvoidingView\b/);
			expect(file.text, file.path).not.toMatch(/\bKeyboard\.addListener\b/);
		}
	});

	/**
	 * Do not write numbers like the 44 notch, 34 home indicator or 47 cutout by hand.
	 *
	 * Those numbers differ per device, and the fact that they are wrong is visible only to whoever
	 * owns that device. To avoid overlapping the spacing check, this only looks at **properties that
	 * set edges**. The 44 for control height is not caught here (it lives in `metrics.ts` in
	 * `@rowcat/ui-native`).
	 */
	const EDGE_PROPERTY =
		/\b(paddingTop|paddingBottom|marginTop|marginBottom|top|bottom):\s*(\d+)\b/g;
	const DEVICE_INSETS = new Set([20, 21, 30, 34, 44, 47, 50, 59]);

	it("device safe area numbers don't appear as literals", () => {
		for (const file of all)
			for (const [text, , value] of file.text.matchAll(EDGE_PROPERTY))
				expect(
					DEVICE_INSETS.has(Number(value)),
					`${file.path} — \`${text}\` is a device safe area number.`,
				).toBe(false);
	});
});

describe("search queries don't leave the device", () => {
	/**
	 * In-room search scans an array already held locally. There is no search endpoint, and none will
	 * be added. Message bodies are not decryptable by the server (sync is envelope-encrypted), and
	 * **the query itself is as private as the conversation.**
	 *
	 * Not storing recent queries follows the same axis. That would be the smallest form of an index
	 * built from conversation content, and storing it would leave part of a conversation somewhere
	 * other apps on the device can see.
	 */
	const searchFiles = product.filter(
		(file) =>
			file.path === "features/chat/chat-search.tsx" ||
			file.path === "features/chat/use-room-search.ts",
	);

	it("the files to check actually exist", () => {
		expect(searchFiles).toHaveLength(2);
	});

	it("search goes through neither the SDK nor the query cache", () => {
		for (const file of searchFiles) {
			expect(file.text, file.path).not.toMatch(/getRowCatClient/);
			expect(file.text, file.path).not.toMatch(/@tanstack\/react-query/);
			expect(file.text, file.path).not.toMatch(/@rowcat\/sdk/);
		}
	});

	it("doesn't store recent searches", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/recentSearch|searchHistory/i);
			expect(file.text, file.path).not.toMatch(/AsyncStorage/);
		}
	});
});

describe("screens don't re-decide operations per role", () => {
	/**
	 * What actions are available is answered by one function, `messageActionsFor` in `@rowcat/chat`.
	 * If a screen rewrites that table as `role === "user" ? ... : ...`, then one day an assistant
	 * response gets an `edit` action. The user edits model-written text by hand and then reads it as
	 * the model's own words.
	 *
	 * Changing the **shape** of bubbles is not caught here. That is presentation. This check looks
	 * only at where the action list is built.
	 */
	it("no code splits the operation list by role directly", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/chat/")) continue;
			expect(file.text, file.path).not.toMatch(
				/role === ["\u0027]user["\u0027][\s\S]{0,80}(?:copy|edit|delete-from|regenerate|report)/,
			);
		}
	});
});

/**
 * **Lines do not overflow the screen.** No control should be cut off on devices with enlarged text.
 *
 * The checks here are about **reachability**, not taste in geometry. A clipped label reads badly,
 * but a button pushed off-screen **does not exist.** The symptom shows up only for people who
 * enabled large accessibility text, so neither review nor the default simulator reveals it.
 */
describe("operations don't leave the screen at accessibility text sizes", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);

	/**
	 * React Native's default `flexShrink` is **0**, the opposite of web CSS. So in a horizontal row,
	 * `flexShrink: 0` is a rule rather than documentation. Applying it to an action group leaves the
	 * overflow with nowhere to go: the sibling (brand) hits 0 and the rest **overflows as is.**
	 *
	 * This actually happened. At large accessibility text the discover header lost its brand entirely,
	 * while `Sign out` was cut off on the right. Both were lost. Allowing shrinking pushes the overflow
	 * into the group, where the only child that can shrink (the nickname) takes it.
	 */
	it("the discover header's operation group can shrink", () => {
		const header = fileAt("features/shell/app-header.tsx");
		expect(header).toBeDefined();

		const actions = /\n\tactions: \{([^}]*)\}/.exec(header?.text ?? "")?.[1];
		expect(actions, "couldn't find the actions style block").toBeDefined();
		expect(actions).not.toMatch(/flexShrink: 0/);
		expect(actions).toMatch(/flexShrink: 1/);
		/** Even if the group shrinks, a group confined to its content width pushes the overflow back out. */
		expect(actions).toMatch(/minWidth: 0/);
	});

	/**
	 * The child that absorbs the overflow is the brand, and `flexShrink: 1` alone is not enough. A
	 * flex child's minimum size defaults to its **content**, so without `minWidth: 0` it cannot shrink
	 * below its own text width, and the overflow goes to the button. The `AppBar` title has the same
	 * value for the same reason.
	 *
	 * This list once also included `name` (the nickname text). It dropped out when that text was
	 * folded into an accessible name in the account menu (`features/account/account-shortcut.tsx`),
	 * leaving the brand as the only child that shrinks.
	 */
	/**
	 * ⚠️ **The child that shrinks has left this header.** For a while the brand (`brand`) stood
	 * between the trigger and the utilities, and this check verified that it could shrink to zero. It
	 * was the slot that must shrink on the narrowest device.
	 *
	 * The brand is now inside the drawer (same place as web). This row holds only the trigger and the
	 * utility group, with `justifyContent` spacing the two apart. **The fact that there is no
	 * shrinking slot** is now what the check verifies. Putting anything back between them breaks this
	 * row first.
	 */
	it("doesn't put a shrinking cell in the middle of the header", () => {
		const header = fileAt("features/shell/app-header.tsx")?.text ?? "";
		expect(header).not.toMatch(/\n\tbrand: \{/);
		const bar = /\n\tbar: \{([^}]*)\}/.exec(header)?.[1];
		expect(bar).toBeDefined();
		/**
		 * ⚠️ **`justifyContent` was removed from this bar.** When the drawer trigger moved to the bottom
		 * row, the children became a single action group. `space-between` only means something with two
		 * or more children, so leaving it would fix a row that does nothing.
		 *
		 * Right alignment is owned by the group's `marginLeft: "auto"` alone. Writing it in two places
		 * means one goes stale, and the stale one, once deleted, changes the layout.
		 */
		expect(bar).not.toMatch(/justifyContent/);
		const actions = /\n\tactions: \{([^}]*)\}/.exec(header)?.[1];
		expect(actions).toMatch(/marginLeft: "auto"/);
	});

	/**
	 * Buttons with labels **do not shrink.** If they did, `Sign o…` would appear. A cut-off label is
	 * better than a button pushed off-screen, but it is still a last resort. The two earlier steps
	 * give first.
	 */
	it("header buttons don't stand where things shrink", () => {
		const header = fileAt("features/shell/app-header.tsx");
		const actions = /\n\tactions: \{([^}]*)\}/.exec(header?.text ?? "")?.[1];
		/** The group itself spaces buttons with `gap`. Do not give buttons individual flex. */
		expect(actions).toMatch(/gap: space\.sm/);
	});
});

/**
 * **The filter rules are shared between the two apps.**
 *
 * ⚠️ This group once followed a different IA: one chip per axis, flowing horizontally in a row, and
 * the check verified that "a chip draws both axis and value". The defect in that row was that the
 * fifth chip (`Following`) was **off-screen at 402pt**, so a logged-in user could not learn the axis
 * existed without pressing something. The web has no such state. Its controls fold into a menu, and
 * **only active conditions** stay outside.
 *
 * This check enforces that IA, and that the source of the rules is `@rowcat/domain` alone. If the
 * app re-writes which axis counts as a condition, how it reads as a sentence, or what the × undoes,
 * the two screens diverge. That is visible only when they are compared side by side.
 */
describe("discover's lookup axes go through shared rules", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);
	const bar = () => fileAt("features/discover/filter-bar.tsx");

	it("a shared function builds the active-condition and sort copy", () => {
		const text = bar()?.text;
		expect(text, "couldn't find filter-bar.tsx").toBeDefined();
		expect(text).toContain(
			"appliedGalleryFilters(filters, followingAvailable)",
		);
		expect(text).toContain("sortTriggerLabel(filters)");
		expect(text).toContain("periodApplies(filters)");
	});

	/** Token text, name and undo all come from the function's result. The screen does not assemble them. */
	it("tokens draw the shared result as is", () => {
		const text = bar()?.text ?? "";
		expect(text).toMatch(/text=\{entry\.text\}/);
		expect(text).toMatch(/removeLabel=\{entry\.removeLabel\}/);
		expect(text).toMatch(/onChange\(entry\.patch\)/);
	});

	/**
	 * **This file does not build `axis: value` sentences.** If it starts, the wording diverges from
	 * the same token on web (`Rating` versus `Rating`), and the difference shows only when the two screens
	 * are compared side by side.
	 */
	it("doesn't write axis names by hand", () => {
		const text = bar()?.text ?? "";
		expect(text).toContain("GALLERY_FILTER_AXIS_LABEL");
		expect(text).not.toMatch(/`\$\{[a-zA-Z]+\}: \$\{[a-zA-Z]+\}`/);
	});

	/**
	 * Narrowing axes and sort are **different triggers**, the same call as web. Mixing them into one
	 * menu erases the difference between "what remains" and "in what order".
	 */
	it("there are two triggers and both have text", () => {
		const text = bar()?.text ?? "";
		expect([...text.matchAll(/<DropdownMenu\b/g)]).toHaveLength(2);
		expect(text).toContain('triggerLabel="Filter"');
		expect(text).toContain("triggerLabel={sortTriggerLabel(filters)}");
	});

	/** Not a horizontal flowing row. That structure is what pushed the fifth axis off-screen. */
	it("the toolbar doesn't use horizontal scrolling", () => {
		expect(bar()?.text).not.toMatch(/<ScrollView[^>]*horizontal/);
	});
});

/**
 * **The list below the header starts from the same place.**
 *
 * Two screens put a virtualized list directly below `AppBar` (story detail and chat list). If their
 * content padding differs, content jumps up and down when moving between them. Looking at one
 * screen alone makes the difference read as "the cover is bigger", so it escapes review.
 *
 * Story detail once had **no top padding at all**, so the cover sat on the header's divider. The
 * check does not count values. It only verifies that both use the **same name**. The numbers are a
 * matter of taste, but having one source is a rule.
 */
describe("the screen margin of lists below the header comes from one source", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);

	it("story details and the conversation list read the same screen margin", () => {
		for (const [path, style] of [
			["features/story/story-detail-screen.tsx", "content"],
			["features/chat-library/chat-library-screen.tsx", "content"],
		] as const) {
			const file = fileAt(path);
			expect(file, path).toBeDefined();
			const block = new RegExp(`\\n\\t${style}: \\{([\\s\\S]*?)\\},\\n`).exec(
				file?.text ?? "",
			)?.[1];
			expect(block, path).toBeDefined();
			expect(block, path).toMatch(/screenPadding/);
		}

		/** Story detail **has** top padding. Its absence is why this check exists. */
		const detail = fileAt("features/story/story-detail-screen.tsx");
		expect(detail?.text).toMatch(/paddingTop: screenPadding/);
	});
});

/**
 * **Empty-state actions carry the same weight as on web.**
 *
 * Counting every `Empty` call site on web gives two branches: a way out from a dead-end screen
 * (`default`), and a next step placed beside the state (`outline`). This app's default is the
 * first, since eight screens are reached from the tab without logging in. Only the second case opts
 * in **explicitly**.
 *
 * The list must match **in both directions**. If only one side is written, a change that removes
 * `actionVariant` and one that adds it anywhere both pass green.
 */
describe("the operation weight of empty states", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);

	/** Places that are `outline` on web. Only files listed here carry that value. */
	const OUTLINE = [
		"features/chat-library/chat-library-screen.tsx",
		"features/create/draft-editor-screen.tsx",
		"features/create/draft-list-panel.tsx",
		"features/discover/discover-screen.tsx",
		"features/playtest/playtest-screen.tsx",
	];

	it("the opted-in places are exactly that list", () => {
		const optedIn = product
			.filter((file) => file.text.includes('actionVariant="outline"'))
			.map((file) => file.path)
			.sort();
		expect(optedIn).toEqual([...OUTLINE].sort());
	});

	/**
	 * The guest branch uses the default (`primary`). Web's equivalent is `default` filled in
	 * (`chat-library-page.tsx` and `persona-library-content.tsx`, the `Sign in` action).
	 */
	it("the guest notice doesn't rewrite the weight", () => {
		for (const path of [
			"features/account/account-screen.tsx",
			"features/settings/settings-shell.tsx",
			"features/notifications/general-notifications.tsx",
			"features/persona/persona-library-section.tsx",
		])
			expect(fileAt(path)?.text, path).not.toContain("actionVariant");
	});

	/** Easy to revert. If the primitive hardcodes `secondary`, twenty-two places change together. */
	it("no place revives the old default", () => {
		for (const file of product)
			expect(file.text, file.path).not.toContain('actionVariant="secondary"');
	});
});

/**
 * **A chat list row is a line in a list, not a card.**
 *
 * The same list on web is `ul.divide-y.border-y`, and rows have no border, radius or surface
 * (`chat-library-page.tsx`). Side by side, the difference reads not as density but as
 * **character**: a continuous roster versus a pile of floating cards
 * (`docs/design/VISUAL-PARITY.md`).
 *
 * ⚠️ This check runs in reverse from before. The row used to be a rounded card, which **required**
 * `overflow: "hidden"` (to stop a square pressed background escaping the curve). Now there is no
 * curve, so that requirement does not hold. Rather than delete the value, **the absence is
 * locked.** If the card shape returns with one line, the returning line looks like an ordinary
 * style addition in review.
 */
describe("conversation list rows aren't cards", () => {
	const fileAt = (path: string) => product.find((file) => file.path === path);

	it("rows have neither radius nor border", () => {
		const row = fileAt("features/chat-library/room-row.tsx");
		const root = /\n\troot: \{([\s\S]*?)\},\n/.exec(row?.text ?? "")?.[1];
		expect(root, "couldn't find the root style block").toBeDefined();
		expect(root).not.toMatch(/borderRadius/);
		expect(root).not.toMatch(/borderWidth/);
		/** Without a curve there is nothing to clip. If this value remains, the premise has shifted. */
		expect(root).not.toMatch(/overflow: "hidden"/);
	});

	it("a solid line separates rows", () => {
		const screen = fileAt("features/chat-library/chat-library-screen.tsx");
		expect(screen?.text).toMatch(/ItemSeparatorComponent=\{RoomSeparator\}/);
		/** A line and a gap together leave the line floating in the air instead of attached to the row. */
		const content = /\n\tcontent: \{([\s\S]*?)\},\n/.exec(
			screen?.text ?? "",
		)?.[1];
		expect(content, "couldn't find the content style block").toBeDefined();
		expect(content).not.toMatch(/gap:/);
	});
});
