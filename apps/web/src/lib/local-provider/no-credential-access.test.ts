import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans for where code that can open plaintext keys lives. The types already enforce
 * half the rule: the port the screens receive (ProviderConnectionStore) has no method that reads a
 * secret. The half the types cannot enforce is imports. If any component imports the decryption
 * hook or the sealing module directly, plaintext enters the render tree. From there it lands in
 * React state, devtools snapshots and error reports. This mistake happens naturally. 'Let's check
 * whether the key is still valid on the settings screen' is a reasonable request, and the shortest
 * implementation calls the credential scope. Such code passes type checks and renders, and the
 * failure is silent, so review does not catch it. The rule is one thing: only the generation
 * execution path may open plaintext. The test checks that policy, not rendered output, because the
 * web tests here have no React rendering. What it catches is whether a file imports that path,
 * which the source answers directly.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

/**
 * Names that can reach plaintext. If any of them appears in screen code, the boundary has been
 * crossed.
 */
const CREDENTIAL_DOORS = [
	"useProviderCredentialScope",
	"createProviderCredentialAccess",
	"withCredential",
	"openCredential",
	"sealCredential",
];

/**
 * Places allowed to pass through that path: only the points where generation starts, and the
 * transport layer that actually uses it. If this list starts to grow, the boundary is eroding.
 * Before adding a file, write down why that screen needs to open the key.
 */
const ALLOWED = new Set([
	/**
	 * This is one place regardless of conversation kind. Local room and story tests pass through the
	 * same generation hook (features/conversation/session.ts), so the place that opens plaintext is
	 * still single. That the list does not grow when tests are added is itself evidence that the
	 * boundary holds.
	 */
	join(WEB_SRC, "features", "conversation", "use-conversation-generation.ts"),
	/**
	 * The path for all auxiliary requests that are not conversations. This is the second generation
	 * start point. The key must open here for the boundary's own sake. If a BYO user's conversation
	 * passed through the RowCat server, the person would be sending text they chose not to send to the
	 * server, and the billing target would change silently. The only way to prevent that is for this
	 * request to go out through the same adapter with the same credential. This is one file because
	 * the list must not grow. Memory maintenance used to be here. When answer suggestions were about
	 * to be added, the same wiring would have existed twice and the list would have grown, making one
	 * more line routine for each future feature. The wiring was folded into utility-generation.ts,
	 * which both maintenance and answer suggestions call. Neither knows the credential port. Plaintext
	 * is still not visible here. The port is passed through as is (credentials), and decryption
	 * happens only when the router calls the adapter. This file contains neither withCredential nor
	 * secret.
	 */
	join(WEB_SRC, "features", "chat", "utility-generation.ts"),
	/**
	 * The runtime preview's generation adapter, the third and last generation start point. When
	 * creator code calls useGeneration(), the request leaves the worker and becomes an ordinary RowCat
	 * generation here. The key must open here for the same reasons as above. Otherwise a BYO creator's
	 * preview text would reach the server and the billing target would change silently. Plaintext is
	 * not visible here either: the port is passed through, and decryption happens only when the router
	 * calls the adapter. This file also lies outside the worker where creator code runs.
	 */
	join(WEB_SRC, "features", "runtime-preview", "runtime-preview-generation.ts"),
]);

const SCANNED = [
	join(WEB_SRC, "features"),
	join(WEB_SRC, "components"),
	join(WEB_SRC, "routes"),
];

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

describe("plaintext credentials never reach screen code", () => {
	it.each(CREDENTIAL_DOORS)("%s appears only where allowed", (door) => {
		const offenders = SCANNED.flatMap((root) => [...sources(root)])
			.filter((path) => !ALLOWED.has(path))
			.filter((path) => readFileSync(path, "utf8").includes(door))
			.map((path) => path.slice(WEB_SRC.length + 1));

		expect(offenders).toEqual([]);
	});

	it("the settings screen does not import the sealing module", () => {
		const settings = [...sources(join(WEB_SRC, "features", "settings"))];
		expect(settings.length).toBeGreaterThan(0);
		/**
		 * Only imports are checked. A file name mentioned in a comment is not crossing the boundary. It
		 * is a recorded rationale, since the connection dialog points its threat model there. Banning
		 * mentions would leave the spot with a rule and no reason.
		 */
		for (const path of settings)
			expect(readFileSync(path, "utf8")).not.toMatch(
				/from\s+"[^"]*local-provider\/crypto/,
			);
	});

	it("the port the screen sees has no method that reads secrets", () => {
		const source = readFileSync(join(HERE, "store.ts"), "utf8");
		const port = source.slice(
			source.indexOf("export interface ProviderConnectionStore"),
			source.indexOf("export interface ProviderCredentialAccess"),
		);
		/**
		 * Connecting (connect) belongs to this port: it takes the value the user just typed and seals it.
		 * The port has no read operation. The read path is named withCredential, and the test asserts
		 * that it does not appear here.
		 */
		expect(port).toContain("connect(");
		expect(port).not.toContain("withCredential");
	});
});
