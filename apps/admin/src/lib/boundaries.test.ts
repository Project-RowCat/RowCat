import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Static scan of the operations console's boundaries. Every rule here is an absence, which comments
 * and review do not hold: the violating code is always the shortest at that spot, breaks nothing,
 * and surfaces long after data has leaked.
 *
 * 1. No local data layer. Conversations and drafts belong to the device, and an operator's
 *    browser has no key to open them.
 * 2. One door to the API. A `fetch` outside `getRowCatClient()` scatters path rules outside the
 *    contract.
 * 3. No `window.confirm`; destructive operations go through `ConfirmDialog`.
 * 4. One enforcement path. No screen code attempts hide/suspend through `/v2/admin/...`.
 * 5. Motion comes only from `motion/react-m`; importing the full API defeats `LazyMotion`'s
 *    bundle decision.
 * 6. Failure placement is fixed: destructive operations go through `ConfirmDialog`, which draws
 *    the failure itself; toasts are only for operations whose pressed control leaves the screen
 *    (currently sign-out alone).
 * 7. One animation system: no legacy `tw-animate-css` utilities, and this app really has a
 *    `MotionProvider` (dialogs drawn outside it would appear motionless).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function collect(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) collect(full, out);
		else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts"))
			out.push(full);
	}
	return out;
}

const files = collect(SRC).sort();
const read = (path: string) => readFileSync(path, "utf8");

/**
 * Source with comments stripped, so only code is scanned. Comments here name rules by their own
 * names (`window.confirm()`), and scanning them raw made the sentences report themselves as
 * violations; rewording comments to dodge that would fit the docs to the check.
 */
const code = (path: string): string =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
const relative = (path: string) => path.slice(SRC.length);

describe("operations console boundaries", () => {
	/** An empty list would make this file guard nothing. */
	test("there are files to scan", () => {
		expect(files.length).toBeGreaterThan(15);
	});

	/**
	 * No local-first layer in this app. Conversations and drafts belong to the device and the server
	 * holds only ciphertext; with no such import, the question "can an admin read conversations"
	 * cannot arise.
	 */
	const FORBIDDEN_IMPORTS = [
		{ specifier: "dexie", why: "local storage" },
		{ specifier: "dexie-react-hooks", why: "local storage subscriptions" },
		{ specifier: "@rowcat/sync", why: "sync protocol (decryption material)" },
		{ specifier: "@rowcat/chat", why: "conversation product rules" },
		{ specifier: "@rowcat/authoring", why: "draft authoring rules" },
	];

	test.each(files.map(relative))("%s: no forbidden imports", (name) => {
		const source = code(join(SRC, name));
		const imports = [
			...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)"/gm),
		].map((m) => m[1] ?? "");
		const violations = imports.filter((specifier) =>
			FORBIDDEN_IMPORTS.some(
				(f) =>
					specifier === f.specifier || specifier.startsWith(`${f.specifier}/`),
			),
		);
		expect({ name, violations }).toEqual({ name, violations: [] });
	});

	/**
	 * One door to the API: `lib/api.ts` builds it and the Better Auth client (`lib/auth.ts`) takes its
	 * own origin. A `fetch(` anywhere else adds a path outside the contract.
	 */
	test("does not call fetch outside getRowCatClient", () => {
		const EXEMPT = new Set(["lib/api.ts", "lib/auth.ts"]);
		const offenders = files
			.map(relative)
			.filter((name) => !EXEMPT.has(name))
			.filter((name) => /\bfetch\s*\(/.test(code(join(SRC, name))));
		expect(offenders).toEqual([]);
	});

	/**
	 * No `window.confirm`: it cannot take a reason, show the target or display a failure, and it
	 * freezes the screen while waiting (after a 30-second request the operator assumes the browser
	 * died and closes the tab).
	 */
	test.each([
		"confirm(",
		"alert(",
		"prompt(",
	])("does not use window.%s", (call) => {
		const pattern = new RegExp(`(?:window\\.)?${call.replace("(", "")}\\s*\\(`);
		const offenders = files
			.map(relative)
			// `ConfirmDialog` uses names like `onConfirm`, so only calls are checked.
			.filter((name) => {
				const source = code(join(SRC, name));
				return source
					.split("\n")
					.some(
						(line) =>
							pattern.test(line) &&
							/\bwindow\.(confirm|alert|prompt)\s*\(/.test(line),
					);
			});
		expect(offenders).toEqual([]);
	});

	/**
	 * One enforcement path: no screen attempts hide/suspend through `/admin/...`. Enforcement all goes
	 * through `moderation.act()`; breaking that creates actions that are in neither the audit ledger
	 * nor appealable (§26, §62).
	 */
	test("does not attempt enforcement through admin paths", () => {
		const BAD = [
			/admin\/[a-z/$-]*stories[a-z/$-]*\/hide/i,
			/admin\/[a-z/$-]*members[a-z/$-]*\/(suspend|ban|restrict)/i,
		];
		const offenders = files
			.map(relative)
			.filter((name) => BAD.some((re) => re.test(code(join(SRC, name)))));
		expect(offenders).toEqual([]);
	});
	/**
	 * Screens do not import the full `motion/react` API. `LazyMotion features={domMax} strict` catches
	 * it at runtime, but only when that component actually renders, which may be an operator opening
	 * the screen mid-incident. Two exceptions: `provider.tsx` imports `LazyMotion` / `MotionConfig`,
	 * and `transitions.ts` imports only the `Transition` type.
	 */
	test("screens use only motion/react-m", () => {
		const EXEMPT = new Set(["lib/motion/provider.tsx"]);
		const offenders = files
			.map(relative)
			.filter((name) => !EXEMPT.has(name))
			.filter((name) => {
				const source = code(join(SRC, name));
				return [
					...source.matchAll(/^import\s+([\s\S]*?)from\s+"motion\/react"/gm),
				].some(([, clause]) => !(clause ?? "").includes("type"));
			});
		expect(offenders).toEqual([]);
	});

	/**
	 * `layoutId` sites state their namespace: this app draws the same navigation list twice and both
	 * are in the DOM, so a fixed name makes the indicator fly between them.
	 */
	/**
	 * Legacy animation utilities do not return. `tw-animate-css` is gone, so its classes now do
	 * nothing, and a dead class looks the same as no animation. Pasting shadcn output is the easiest
	 * way they come back.
	 */
	test("no tw-animate-css utilities remain", () => {
		const BAD =
			/\b(?:animate-(?:in|out)|(?:fade|zoom|spin)-(?:in|out)-|slide-(?:in-from|out-to)-)/;
		const offenders = files
			.map(relative)
			.filter((name) => BAD.test(code(join(SRC, name))));
		expect(offenders).toEqual([]);
	});

	/**
	 * This app has a motion runtime too. Its dialogs, dropdowns and selects open through Motion, and
	 * it is easy to assume only `apps/web` uses the primitives.
	 */
	test("the root wraps the app in MotionProvider", () => {
		expect(code(join(SRC, "main.tsx"))).toMatch(/<MotionProvider>/);
	});

	/**
	 * Failure-display boundary, the same axis as the web's `lib/toast-boundaries.test.ts`. A silent
	 * failure is costly in a console: an operator reads a closed dialog or a restored button as the
	 * action having applied, and decides next on that.
	 */
	describe("failure display", () => {
		/** One adapter raises toasts; lifetime and priority are that file's promise. */
		test("feature code does not add toasts directly", () => {
			const offenders = files
				.map(relative)
				.filter(
					(name) =>
						name !== "lib/toast.ts" &&
						/\btoast\.add\s*\(/.test(code(join(SRC, name))),
				);
			expect(offenders).toEqual([]);
		});

		/**
		 * Only the adapter and the root import the primitive; a screen holding the manager would
		 * re-decide `timeout: 0` on the spot.
		 */
		test("only the adapter and the root bring in the toast primitive", () => {
			const offenders = files
				.map(relative)
				.filter(
					(name) =>
						name !== "lib/toast.ts" &&
						name !== "main.tsx" &&
						/components\/toast/.test(code(join(SRC, name))),
				);
			expect(offenders).toEqual([]);
		});

		/**
		 * Without it `showErrorToast` silently draws nothing. The web's root having one does not help:
		 * the two apps run in separate documents with separate manager instances.
		 */
		test("the root mounts the Toaster", () => {
			expect(code(join(SRC, "main.tsx"))).toMatch(/<Toaster\s*\/>/);
		});

		/**
		 * Caught exceptions are not put on a toast as-is. The feature module owns the copy and unknown
		 * failures fold into its default sentence.
		 */
		test("caught exceptions do not ride into toasts as is", () => {
			const RAW = /showErrorToast\(\s*(?:String\(|`|.*\.message\b)/;
			const offenders = files
				.map(relative)
				.filter((name) => RAW.test(code(join(SRC, name))));
			expect(offenders).toEqual([]);
		});

		/**
		 * No global error handler: that layer cannot know whether `ConfirmDialog` already draws the
		 * failure, so here it would always duplicate.
		 */
		test("there is no global mutation error handler", () => {
			const offenders = files
				.map(relative)
				.filter((name) => /new MutationCache\s*\(/.test(code(join(SRC, name))));
			expect(offenders).toEqual([]);
		});

		/**
		 * A destructive operation's failure stays inside the dialog. `ConfirmDialog` taking `error` is
		 * that contract; without it the operator loses the reason just typed and does not know what
		 * happened.
		 */
		test("ConfirmDialog draws failures inside itself", () => {
			const source = code(join(SRC, "components/confirm-dialog.tsx"));
			expect(source).toMatch(/error: unknown/);
			expect(source).toMatch(/<ErrorBlock error={error}/);
		});

		/**
		 * The fact that it cannot close while pending is also drawn. The dialog blocks every dismissal
		 * with `if (pending) return`, but the top-right X once stood active: pressing it sent a close
		 * reason that the guard swallowed, so nothing happened. State was safe, yet the screen drew a
		 * control that says it can and then refuses, a symptom that is neither error nor warning and
		 * invisible in review.
		 *
		 * `showCloseButton={false}` is not used: removing a target when the operation starts shifts the
		 * layout. The guard above still does the locking; the disabled X is a signal, not enforcement, so
		 * both are needed (the web's same rule is scanned by
		 * `apps/web/src/lib/dialog/pending-affordance.test.ts`).
		 */
		test("the close button can't be pressed while in progress either", () => {
			const source = code(join(SRC, "components/confirm-dialog.tsx"));
			expect(source).toMatch(/closeButtonDisabled=\{pending\}/);
			expect(source).toMatch(/if\s*\(pending\)\s*return;/);
		});

		/**
		 * Every site that opens that dialog passes it. A dialog opened without `error` says nothing on
		 * failure, and that silence reads as "applied".
		 */
		test("every place opening a confirmation passes failures", () => {
			const offenders = files.map(relative).filter((name) => {
				const source = code(join(SRC, name));
				const uses = [...source.matchAll(/<ConfirmDialog\b/g)].length;
				if (uses === 0) return false;
				return [...source.matchAll(/\berror=\{/g)].length < uses;
			});
			expect(offenders).toEqual([]);
		});

		/** Only sign-out gets a toast; that operation leaves no place to draw inline. */
		test("sign-out failures are not silent", () => {
			expect(code(join(SRC, "components/admin-shell.tsx"))).toMatch(
				/showErrorToast\(SIGN_OUT_FAILED\)/,
			);
		});
	});

	describe("queries", () => {
		/**
		 * Screens do not call `useQuery` directly. A query built that way has no guarantee that `Try again`
		 * really retries: discarding a paused retryer needs the query's key, which the result object
		 * lacks, and `useAdminQuery` takes it from the options. Missing it still type-checks and renders;
		 * it shows once an offline operator presses the button a few times, usually mid-incident.
		 */
		test("does not call useQuery directly", () => {
			const EXEMPT = new Set([
				"lib/query/use-admin-query.ts",
				"lib/query/use-admin-infinite-query.ts",
			]);
			const offenders = files
				.map(relative)
				.filter((name) => !EXEMPT.has(name))
				.filter((name) => /\buseQuery\s*\(/.test(code(join(SRC, name))));
			expect(offenders).toEqual([]);
		});

		/**
		 * Appended lists go through the door too (`useAdminInfiniteQuery`). A screen holding a
		 * `useInfiniteQuery` result would read a next-page failure as the whole query's `isError`,
		 * raising a "refresh failed" banner whose `Try again` refetches from page one (`next-page.ts`).
		 */
		test("does not call useInfiniteQuery directly", () => {
			const EXEMPT = new Set(["lib/query/use-admin-infinite-query.ts"]);
			const offenders = files
				.map(relative)
				.filter((name) => !EXEMPT.has(name))
				.filter((name) =>
					/\buseInfiniteQuery\s*\(/.test(code(join(SRC, name))),
				);
			expect(offenders).toEqual([]);
		});

		/**
		 * Screens hold no cursor. A cursor lives only in the cache cell of the filters that produced it;
		 * a screen holding one must remember to clear it on filter change, and one that forgets reads
		 * from the middle of a different list (not a 400, just a wrong list).
		 */
		test("screens do not handle cursors", () => {
			const offenders = files
				.map(relative)
				.filter((name) => name.startsWith("features/"))
				.filter((name) =>
					/\b(nextCursor|pageParam|cursor)\b/.test(code(join(SRC, name))),
				);
			expect(offenders).toEqual([]);
		});

		/**
		 * The ordering of states belongs to a pure function. `AdminQuery` exposes only five axes, with no
		 * `isFetching` / `isRefetching`, so a screen has no material for its own freshness rule; pulling
		 * those axes back out trips this check first.
		 */
		test("screens do not read the query's progress axes directly", () => {
			const EXEMPT = new Set([
				"lib/query/use-admin-query.ts",
				"lib/query/use-admin-infinite-query.ts",
			]);
			const offenders = files
				.map(relative)
				.filter((name) => !EXEMPT.has(name))
				.filter((name) =>
					/\.(isFetching|isRefetching)\b/.test(code(join(SRC, name))),
				);
			expect(offenders).toEqual([]);
		});
	});

	/**
	 * Mobile OTA: this console only requests intent and never produces code. Signing-key, signing,
	 * bundle or manifest-upload vocabulary here would make the console a remote code uploader
	 * (`docs/ota/ARCHITECTURE.md`, control plane). And a publish request carrying the runtime
	 * generation or API origin would let the browser pick the binary's native contract and backend; CI
	 * decides both from the repository and the channel.
	 */
	describe("mobile OTA", () => {
		const SIGNING =
			/ROWCAT_OTA_SIGNING_KEY|private[-_ ]?key|BEGIN [A-Z ]*PRIVATE KEY|createPrivateKey|\bcrypto\.subtle\.sign\b|signForKeyId|loadSigningKey/i;

		test("there is no vocabulary for a means to sign", () => {
			const offenders = files
				.map(relative)
				.filter((name) => SIGNING.test(read(join(SRC, name))));
			expect(offenders).toEqual([]);
		});

		test("there is no path uploading bundles, manifests or assets", () => {
			const offenders = files
				.map(relative)
				.filter((name) =>
					/MobileUpdateReleaseBundle|MobileUpdateManifest|type="file"|FormData|assetBaseUrl|launchAsset/.test(
						code(join(SRC, name)),
					),
				);
			expect(offenders).toEqual([]);
		});

		test("publish requests do not decide the runtime generation or API origin", () => {
			const source = code(
				join(SRC, "features/mobile-updates/mobile-update-view.ts"),
			);
			const request = source.slice(
				source.indexOf("export function publishRequestOf"),
			);
			expect(request).not.toMatch(
				/runtimeVersion|apiOrigin|manifest|signature/,
			);
		});
	});

	test("the active indicator takes a group", () => {
		const source = code(join(SRC, "components/admin-shell.tsx"));
		const uses = [...source.matchAll(/<MotionActiveIndicator/g)].length;
		const groups = [...source.matchAll(/group="([^"]+)"/g)].map((m) => m[1]);
		expect(uses).toBeGreaterThan(0);
		expect(groups).toHaveLength(uses);
		// The two surfaces must use different names.
		expect(new Set(groups).size).toBe(groups.length);
	});
});
