import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Boundaries of the BYO slice: the rules the type system cannot express.
 *
 * `settings-boundaries.test.ts` guards the settings screens and `lib/boundaries.test.ts` scans the
 * whole app. This file guards one axis vertically: which screens read the connection, whether the
 * value really comes from storage, and how far the secret travels.
 *
 * Every rule below compiles even when broken and fails only on a device. The quietest is the first:
 * a target the screen offers as selectable is blocked when the message is sent.
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

/** Checks run on source with comments removed, because this repository's comments spell out the banned words verbatim. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("provider-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	it("the connection slice's files are in place", () => {
		for (const path of [
			"lib/local-provider/record.ts",
			"lib/local-provider/store.ts",
			"lib/local-data/use-provider-connections.ts",
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
			"lib/generation/byo.ts",
			"lib/generation/errors.ts",
			"lib/generation/sse.ts",
			"lib/generation/native-fetch.ts",
			"lib/generation/transport.ts",
			"features/settings/connect-provider.ts",
			"features/settings/provider-connections-section.tsx",
			"features/settings/provider-connection-dialog.tsx",
			"features/settings/provider-connections-state.ts",
			"features/settings/provider-copy.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
	});
});

describe("availability comes from one store", () => {
	/**
	 * **P0, and this slice's quietest failure.** A target the model picker shows as selectable is
	 * blocked, or a provider just connected stays greyed out. When the two values come from different
	 * sources, the mismatch raises no error.
	 *
	 * So no place may hand-write a connection list.
	 */
	it("product code has no empty connection list placeholder", () => {
		for (const file of product) {
			expect(file.text, `${file.path} — connected: []`).not.toMatch(
				/connected:\s*\[\s*\]/,
			);
			expect(file.text, `${file.path} — connectedProviders: []`).not.toMatch(
				/connectedProviders:\s*\[\s*\]/,
			);
		}
	});

	/**
	 * Every screen that calls the availability decision goes through **the same subscription hook**.
	 * If each opened the store itself, loading branches and signals would multiply per screen, and one
	 * of them would miss updates.
	 */
	it("screens using availability go through one subscription hook", () => {
		const users = product
			.filter((file) =>
				/\bbuildModelOptions\(|\broomGenerationSummary\(|playtestConfigurationSummary\(/.test(
					file.text,
				),
			)
			/**
			 * Only `.tsx` files are counted. The pure wrappers that fill in copy (`model-options.ts`,
			 * `room-generation-summary.ts`, `playtest-configuration-summary.ts`) receive the connection list
			 * and pass it on without reading it themselves. Counting them would make this check claim that
			 * pure modules must know the scope.
			 */
			.filter((file) => file.path.endsWith(".tsx"))
			.map((file) => file.path)
			.sort();

		/**
		 * Six surfaces read the same hook. Keeping the list as a value makes a new entry visible when one
		 * is added.
		 *
		 * The sixth is the runtime playback's generation settings. It is the first non-conversation
		 * screen on this list, for the same reason: creator code's generation also runs on this device's
		 * connections, and a dialog that opened its own store would offer an item that `useGeneration()`
		 * then blocks.
		 */
		expect(users).toEqual([
			"features/chat/room-settings/generation.tsx",
			"features/chat/room-settings/home.tsx",
			"features/playtest/playtest-screen.tsx",
			"features/playtest/playtest-settings-dialog.tsx",
			"features/runtime-player/runtime-generation-settings-dialog.tsx",
			"features/settings/generation-defaults-section.tsx",
		]);

		for (const path of users) {
			const text = fileAt(path);
			/** Each must either read the hook directly or receive the list from its parent (dialog). */
			const reads = text.includes("useProviderConnections");
			const receives =
				/connected[=:]\s*(connected|connections\.providers)/.test(text);
			expect(reads || receives, path).toBe(true);
		}
	});

	/**
	 * The store is pulled out of the scope in exactly **one** place. If screens reached into the
	 * scope's internals, the narrow window (`useProviderScope`) would have no reason to exist.
	 */
	it("one place takes the connection store out of the scope", () => {
		const readers = product
			.filter((file) => /stores\.providers\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(readers).toEqual(["lib/local-data/scope.tsx"]);
	});

	/** The credential port follows the same rule, and its access should be narrower still. */
	it("one place takes the credential port out of the scope", () => {
		const readers = product
			.filter((file) => /stores\.providerCredentials\b/.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(readers).toEqual(["lib/local-data/scope.tsx"]);
	});

	/**
	 * **The generation runtime does not use the subscription.** Going through render state leaves a
	 * window where a just-removed connection has not arrived yet, and a request started in that window
	 * expects a credential that is already gone.
	 */
	it("the generation wiring doesn't use the subscription hook", () => {
		for (const path of [
			"features/chat/generation/use-generation.ts",
			"features/chat/utility-generation.ts",
		]) {
			const text = fileAt(path);
			expect(text, path).not.toContain("useProviderConnections");
			expect(text, path).toContain("useProviderScope");
		}
	});
});

describe("auxiliary requests take the same path as conversations", () => {
	/**
	 * **Privacy P0.** If the two paths diverge, a room like this appears:
	 *
	 * ```text
	 * response generation   Anthropic direct    ← what the user chose
	 * maintenance           RowCat managed      ← what nobody chose
	 * ```
	 *
	 * Then **the entire conversation history** goes to the server (the span being summarized is the
	 * request itself), and the billing target changes too. Nothing looks different to the user.
	 */
	it("connections, credentials and transport are the same wiring as conversation turns", () => {
		const utility = fileAt("features/chat/utility-generation.ts");
		const chat = fileAt("features/chat/generation/use-generation.ts");

		for (const shared of [
			"useProviderScope",
			"useProviderCredentialScope",
			"nativeStreamingFetch",
		]) {
			expect(utility, `utility — ${shared}`).toContain(shared);
			expect(chat, `chat — ${shared}`).toContain(shared);
		}
		/**
		 * Transport is the same router. A conversation turn passes through the door that accepts an
		 * assembled plan (`streamChatGenerationPlan`), and a device-assembled plan goes on to
		 * `createGenerationTransport` from there. Only the server-assembled path for protected stories
		 * branches off at that door.
		 */
		expect(utility).toContain("createGenerationTransport");
		expect(chat).toContain("streamChatGenerationPlan");

		/** Target resolution also goes through the same shared functions; no second rule is written. */
		expect(utility).toContain("resolveUtilityTarget");
		expect(utility).toContain("resolveGenerationExecution");
	});

	/**
	 * **There is one wiring for utility requests.** This is where the check was strengthened.
	 *
	 * For a while the file this check looked at was `use-maintenance.ts` alone. When reply suggestions
	 * arrived, the same wiring was about to be duplicated, and the check would have had to chase a
	 * growing file list. A growing list also makes adding one more utility request feel routine. The
	 * wiring is now folded into `utility-generation.ts`, so what this test verifies is only that the
	 * consumers did not build their own paths.
	 */
	it("auxiliary request consumers don't each build a transport", () => {
		const consumers = [
			"features/chat/memory/use-maintenance.ts",
			"features/chat/suggestion/use-reply-suggestion.ts",
		];
		expect(consumers.length).toBeGreaterThan(1);

		for (const path of consumers) {
			const text = fileAt(path);
			expect(text, `${path} — the shared passage`).toContain(
				"useUtilityGeneration",
			);
			/** Consumers do not set up their own transport, credentials, or target resolution. */
			for (const forbidden of [
				"createGenerationTransport",
				"useProviderCredentialScope",
				"resolveUtilityTarget",
			])
				expect(text, `${path} — ${forbidden}`).not.toContain(forbidden);
		}
	});

	/** Reads the connection list from the real store; the empty-array check above already blocks the placeholder. */
	it("reads the connection list from the store", () => {
		expect(fileAt("features/chat/utility-generation.ts")).toContain(
			"providers?.list()",
		);
	});

	/**
	 * **Utility requests know nothing about billing.** Since managed generation stopped metering,
	 * generation has no balance to move. If that invalidation came back, every conversation turn would
	 * add a useless billing round trip. Provider strings are still not compared again.
	 */
	it("auxiliary requests don't touch the billing cache", () => {
		const text = fileAt("features/chat/utility-generation.ts");
		for (const forbidden of ["usesManagedBilling", "invalidateBilling"])
			expect(text, forbidden).not.toContain(forbidden);
		expect(text).not.toMatch(/provider\s*[=!]==\s*["']rowcat["']/);
	});
});

describe("secrets don't leak", () => {
	/**
	 * **P0.** The app's product path has no `console` calls at all (`lib/boundaries.test.ts`), and
	 * that rule applies here too. This test adds one more layer: the common shape of throwing an error
	 * that carries a variable holding a secret.
	 */
	it("secrets don't ride on errors or logs", () => {
		const holders = product.filter(
			(file) =>
				file.path.startsWith("lib/local-provider/") ||
				file.path.startsWith("lib/generation/") ||
				file.path === "features/settings/connect-provider.ts",
		);
		expect(holders.length).toBeGreaterThan(5);

		for (const file of holders) {
			expect(file.text, file.path).not.toMatch(/console\.\w+\(/);
			/** Shapes like `new Error(secret)` or `Error(${secret})`. */
			expect(file.text, file.path).not.toMatch(/Error\([^)]*\bsecret\b[^)]*\)/);
			/** Do not serialize an object that holds a secret as a whole. */
			expect(file.text, file.path).not.toMatch(
				/JSON\.stringify\([^)]*\bsecret\b/,
			);
		}
	});

	/**
	 * Serialization that stores a secret happens in **exactly one place**: the `JSON.stringify` inside
	 * the store. If the same shape shows up anywhere else, a secret is being copied somewhere else.
	 */
	it("one store is the only place that serializes secrets", () => {
		const writers = product
			.filter((file) =>
				/JSON\.stringify\(\s*\{[\s\S]{0,200}secret/.test(file.text),
			)
			.map((file) => file.path);
		expect(writers).toEqual(["lib/local-provider/store.ts"]);
	});

	/** The summary type has no secret field; the shape of the value screens receive is the boundary. */
	it("the summary type has no secret slot", () => {
		const record = fileAt("lib/local-provider/record.ts");
		const summary =
			/export interface ProviderConnectionSummary \{[\s\S]*?\}/.exec(
				record,
			)?.[0] ?? "";
		expect(summary).toBeTruthy();
		expect(summary).not.toContain("secret");
		expect(summary).not.toContain("apiKey");
		/** No fingerprint or last-four digits either; those alone can be used for offline matching. */
		expect(summary).not.toMatch(/fingerprint|hint|suffix|last4/i);
	});
});

describe("the server and protocol stay as they are", () => {
	/**
	 * **This is the definition of BYO.** Neither the secret nor the direct request passes through our
	 * server, so a new surface that goes to the server is a different feature.
	 */
	it("there's no path sending provider credentials to the server", () => {
		for (const file of product)
			for (const forbidden of [
				"/me/providers",
				"/me/api-keys",
				"/v2/chat/byo",
				"providerCredentialMutationOptions",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/** Adapters do not know the SDK; their requests do not pass through our client. */
	it("adapters don't know the RowCat client", () => {
		for (const path of [
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
			"lib/generation/sse.ts",
			"lib/generation/errors.ts",
			"lib/generation/byo.ts",
		]) {
			const text = fileAt(path);
			expect(text, path).not.toContain("@rowcat/sdk");
			expect(text, path).not.toContain("getRowCatClient");
			expect(text, path).not.toContain("@rowcat/query");
			expect(text, path).not.toContain("react");
		}
	});

	/** Only one file knows the native transport, so the rest can load under Node. */
	it("one place knows expo/fetch", () => {
		const knowers = product
			.filter((file) => /expo\/fetch/.test(file.text))
			.map((file) => file.path);
		expect(knowers).toEqual(["lib/generation/native-fetch.ts"]);
	});

	/** Do not attach this device's cookies to third-party requests. */
	it("direct calls carry no cookies", () => {
		expect(fileAt("lib/generation/native-fetch.ts")).toContain(
			'credentials: "omit"',
		);
	});
});

describe("no out-of-scope vocabulary", () => {
	/**
	 * Things this slice does not open. Drawing them as placeholders makes users read them as features
	 * about to launch, and a vocabulary value makes the screen draw them even as disabled items.
	 */
	it("no other providers, proxies or arbitrary endpoints", () => {
		const slice = product.filter(
			(file) =>
				file.path.startsWith("lib/local-provider/") ||
				file.path.startsWith("lib/generation/") ||
				file.path.startsWith("features/settings/"),
		);
		for (const file of slice)
			for (const absent of [
				"openai",
				"openrouter",
				"azure",
				"customEndpoint",
				"baseUrl",
				"proxyMode",
				"revokeApiKey",
			])
				expect(
					file.text.toLowerCase(),
					`${file.path} — ${absent}`,
				).not.toContain(absent.toLowerCase());
	});
});

describe("the credential's lifetime doesn't outlast the callback", () => {
	/**
	 * **P0.** If the adapter's start is **lazy**, the plaintext key outlives the credential callback.
	 *
	 * For a while the contract was `stream(input): AsyncIterable`, and both adapters implemented it as
	 * an `async function*`. Calling that ran no body and only created a generator object, so the
	 * provider request went out **after** the callback had closed, while the input holding `secret`
	 * stayed alive in that closure.
	 *
	 * The timing is pinned by behavior tests: the "the lifetime of secrets" (secret lifetime) case in
	 * `lib/generation/router.test.ts` and the "two stages" case in `adapters.test.ts`. What
	 * this test locks is **the shape that could make that timing lazy again**. Such a regression would
	 * still compile and show no symptom on screen.
	 */
	it("adapters export start and not stream", () => {
		expect(fileAt("lib/generation/byo.ts")).toMatch(
			/start\(input: ByoTransportInput\): Promise<AsyncIterable<ChatStreamEvent>>/,
		);
		expect(fileAt("lib/generation/byo.ts")).not.toMatch(
			/\bstream\(input: ByoTransportInput\)/,
		);

		for (const path of [
			"lib/generation/anthropic.ts",
			"lib/generation/gemini.ts",
		]) {
			const text = fileAt(path);
			/** Start is a **plain async function**; as a generator, the body would be deferred. */
			expect(text, path).toMatch(
				/async function start\(\s*input: ByoTransportInput,?\s*\): Promise<AsyncIterable<ChatStreamEvent>>/,
			);
			expect(text, path).not.toMatch(/async function\* start\(/);
			/** The table also carries that name. */
			expect(text, path).toMatch(/ByoAdapter = \{ start, probe \}/);
		}
	});

	/**
	 * **The response parser cannot receive adapter input.**
	 *
	 * The structural guarantee comes first: the parser's argument type has no `secret` slot and has a
	 * `body`, so code passing `ByoTransportInput` is blocked at compile time. This test checks by
	 * value that the type really has that shape. If someone changes it back to `input:
	 * ByoTransportInput`, the compile-time guarantee disappears entirely, and that diff is a single
	 * line.
	 */
	it("the response parser doesn't receive inputs holding secrets", () => {
		const parsers: [string, string, string][] = [
			[
				"lib/generation/anthropic.ts",
				"AnthropicResponseStream",
				"readAnthropicStream",
			],
			["lib/generation/gemini.ts", "GeminiResponseStream", "readGeminiStream"],
		];

		for (const [path, type, reader] of parsers) {
			const text = fileAt(path);

			/** The type the parser accepts has no secret slot. */
			const shape =
				new RegExp(`interface ${type} \\{[\\s\\S]*?\\n\\}`).exec(text)?.[0] ??
				"";
			expect(shape, `${path} — ${type}`).toBeTruthy();
			expect(shape).toContain("body: ReadableStream<Uint8Array>");
			for (const forbidden of ["secret", "apiKey", "headers", "fetch"])
				expect(shape, `${type} — ${forbidden}`).not.toContain(forbidden);

			/** And the parser accepts only that type. */
			expect(text, `${path} — ${reader}`).toMatch(
				new RegExp(`async function\\* ${reader}\\(\\s*source: ${type},`),
			);
			expect(text, `${path} — ${reader}`).not.toMatch(
				new RegExp(`${reader}\\(\\s*input`),
			);
		}
	});

	/**
	 * **The auth header is built in one place: request assembly.** If the parser could call it, the
	 * type boundary above would lose its meaning.
	 */
	it("there's no auth header on the parser side", () => {
		for (const [path, reader] of [
			["lib/generation/anthropic.ts", "readAnthropicStream"],
			["lib/generation/gemini.ts", "readGeminiStream"],
		] as const) {
			const text = fileAt(path);
			const body = text.slice(
				text.indexOf(`async function* ${reader}(`),
				text.indexOf("async function start("),
			);
			expect(body, `${path} — ${reader}`).toBeTruthy();
			for (const forbidden of ["headersFor", "secret", "input."])
				expect(body, `${reader} — ${forbidden}`).not.toContain(forbidden);
		}
	});

	/**
	 * The transport calls the start **inside the callback**. Moving it outside `withCredential` is a
	 * one-line diff, and that one line is the whole security boundary of this slice.
	 */
	it("the router calls start inside the credential callback", () => {
		const text = fileAt("lib/generation/transport.ts");
		expect(text).toMatch(
			/withCredential\(\s*input\.provider,\s*async \(secret\) =>\s*adapter\.start\(/,
		);
		/** Do not create a second place that starts an adapter outside the callback. */
		expect(text.match(/adapter\.start\(/g) ?? []).toHaveLength(1);
	});
});
