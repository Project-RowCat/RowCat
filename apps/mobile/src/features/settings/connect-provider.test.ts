import type { ByoProvider } from "@rowcat/chat";
import { beforeEach, describe, expect, it } from "vitest";
import type { CredentialCheck } from "../../lib/generation/byo.ts";
import { ProviderError } from "../../lib/generation/errors.ts";
import { createProviderConnectionStore } from "../../lib/local-provider/store.ts";
import { createMemorySecureStorage } from "../../test/sqlite-node.ts";
import { connectProvider } from "./connect-provider.ts";

/**
 * Connect coordinator: ordering and ownership.
 *
 * All five rules below compile even when broken, and two of them cannot be undone:
 *
 * ```text
 * save only after probe            a key rejected with 401 stays "connected"
 * eligibility before probe         a request reaches the provider with an unusable key (billed to the user)
 * two same-tick submits            a race lets a key other than the one just entered win
 * failure keeps the old connection a failed replacement loses a working connection
 * re-check ownership before write  ← **P0.** Alice's key becomes Bob's Keychain entry
 * ```
 *
 * The store is not mocked. The product's real store is plugged in
 * (`createProviderConnectionStore`), so questions like "does the old value survive a failed save"
 * are answered by actual storage behaviour.
 */

const ALICE = "alice";
const BOB = "bob";
const PROVIDER: ByoProvider = "anthropic-byo";

let secure: ReturnType<typeof createMemorySecureStorage>;
let store: ReturnType<typeof createProviderConnectionStore>;

beforeEach(() => {
	secure = createMemorySecureStorage();
	store = createProviderConnectionStore(secure, ALICE);
});

const ok = (): CredentialCheck => ({ ok: true });
const rejected = (): CredentialCheck => ({
	ok: false,
	error: new ProviderError("invalid_credential"),
});
const failed =
	(code: "network" | "rate_limited" | "quota_exceeded") =>
	(): CredentialCheck => ({ ok: false, error: new ProviderError(code) });

interface RunOptions {
	secret?: string;
	byoAllowed?: boolean;
	check?: () => CredentialCheck | Promise<CredentialCheck>;
	ownsStore?: (candidate: unknown) => boolean;
	guard?: { current: boolean };
	onProbe?: () => void;
}

/** One operation; returns the probe calls and the outcome together. */
async function run(options: RunOptions = {}) {
	const probes: string[] = [];
	const outcome = await connectProvider({
		provider: PROVIDER,
		byoAllowed: options.byoAllowed ?? true,
		secret: options.secret ?? "sk-valid",
		store,
		ownsStore: options.ownsStore ?? (() => true),
		probe: async (_provider, secret) => {
			probes.push(secret);
			options.onProbe?.();
			return (options.check ?? ok)();
		},
		guard: options.guard ?? { current: false },
	});
	return { outcome, probes };
}

describe("validation comes before saving", () => {
	it("saves when it passes", async () => {
		const { outcome, probes } = await run();

		expect(outcome).toEqual({ status: "connected" });
		expect(probes).toEqual(["sk-valid"]);
		expect(await store.has(PROVIDER)).toBe(true);
	});

	/** **A key rejected with 401 never becomes "connected", not even briefly.** */
	it("doesn't save when refused", async () => {
		const { outcome } = await run({ check: rejected });

		expect(outcome.status).toBe("rejected");
		expect(await store.has(PROVIDER)).toBe(false);
	});

	/**
	 * Transient failures are the same: a key that probably works is not stored. They are kept apart
	 * from `rejected` because the user does something different in each case (fix the value versus
	 * press again).
	 */
	it.each([
		["network" as const],
		["rate_limited" as const],
		["quota_exceeded" as const],
	])("doesn't save on a %s failure either", async (code) => {
		const { outcome } = await run({ check: failed(code) });

		expect(outcome.status).toBe("failed");
		expect(await store.has(PROVIDER)).toBe(false);
	});

	/** A failed save is reported as failed; the storage error text does not reach the message. */
	it("a failed save is failed", async () => {
		const outcome = await connectProvider({
			provider: PROVIDER,
			byoAllowed: true,
			secret: "sk",
			store: {
				...store,
				connect: async () => {
					throw new Error("Raw Keychain error");
				},
			},
			ownsStore: () => true,
			probe: async () => ok(),
			guard: { current: false },
		});

		expect(outcome.status).toBe("failed");
		expect(outcome.status === "failed" && outcome.message).not.toContain(
			"Keychain",
		);
	});
});

describe("eligibility comes before validation", () => {
	/**
	 * **P0.** If this check ran after the probe, a request with an unusable key would still reach the
	 * provider. That is billed to the user and recorded on the account.
	 */
	it("an account blocked from BYO neither validates nor saves", async () => {
		const { outcome, probes } = await run({ byoAllowed: false });

		expect(outcome.status).toBe("not_permitted");
		expect(probes).toEqual([]);
		expect(await store.has(PROVIDER)).toBe(false);
	});

	/** The guidance also says what still works; otherwise chatting would read as blocked. */
	it("the notice says managed is still open", async () => {
		const { outcome } = await run({ byoAllowed: false });
		expect(outcome.status === "not_permitted" && outcome.message).toContain(
			"RowCat-provided models",
		);
	});
});

describe("doesn't ask the provider about an empty value", () => {
	/**
	 * Probing an empty key returns 401, which is drawn as "the key is wrong". That guidance is worse
	 * than the fact that nothing was entered.
	 */
	it.each([
		[""],
		["   "],
		["\n\t"],
	])("%j ends without validation", async (secret) => {
		const { outcome, probes } = await run({ secret });

		expect(outcome.status).toBe("empty");
		expect(probes).toEqual([]);
		expect(await store.has(PROVIDER)).toBe(false);
	});
});

describe("a second submit in the same tick", () => {
	/**
	 * A `pending` state is not enough: `setState` takes effect only on the next render, so rapid
	 * repeats both pass. Two probes would go out and the two writes would race; whichever finishes
	 * last wins.
	 */
	it("validation and saving each happen once", async () => {
		const guard = { current: false };
		const probes: string[] = [];
		const attempt = (secret: string) =>
			connectProvider({
				provider: PROVIDER,
				byoAllowed: true,
				secret,
				store,
				ownsStore: () => true,
				probe: async (_provider, value) => {
					probes.push(value);
					await Promise.resolve();
					return ok();
				},
				guard,
			});

		const [first, second] = await Promise.all([
			attempt("sk-first"),
			attempt("sk-second"),
		]);

		expect(probes).toEqual(["sk-first"]);
		expect(first.status).toBe("connected");
		expect(second.status).toBe("busy");
	});

	/** Released when done; a second attempt must not be blocked forever. */
	it("it can start again after finishing", async () => {
		const guard = { current: false };
		await run({ guard });
		expect(guard.current).toBe(false);
		const { outcome } = await run({ guard });
		expect(outcome.status).toBe("connected");
	});

	/** Released on failure too. */
	it("it can start again after failing", async () => {
		const guard = { current: false };
		await run({ guard, check: rejected });
		expect(guard.current).toBe(false);
	});
});

describe("asks about ownership again right before the irreversible write", () => {
	/**
	 * P0. The probe waits on the network, and the account can change in the meantime. Alice presses
	 * connect (scope A). While the probe runs, Alice signs out and Bob signs in (scope B). If the
	 * probe then succeeds, saving here would make Alice's key Bob's. This test pins that nothing is
	 * saved in that case.
	 */
	it("doesn't save if the account switches during validation", async () => {
		let owned = true;
		const { outcome, probes } = await run({
			ownsStore: () => owned,
			onProbe: () => {
				owned = false;
			},
		});

		expect(probes).toEqual(["sk-valid"]);
		expect(outcome.status).toBe("foreign");
		expect(await store.has(PROVIDER)).toBe(false);
	});

	/** The sheet was open for a long time; there is no reason to send a request at all. */
	it("if it's already someone else's at the start, it doesn't even validate", async () => {
		const { outcome, probes } = await run({ ownsStore: () => false });

		expect(probes).toEqual([]);
		expect(outcome.status).toBe("foreign");
		expect(await store.has(PROVIDER)).toBe(false);
	});

	/**
	 * **`Alice → sign out → Alice` is also someone else's.** Judging by member id would let this
	 * sequence pass, and the write would then come from an operation started in an earlier session
	 * into the new session's Keychain.
	 *
	 * Comparing the store instance expresses that: the two scopes are the same member but different
	 * instances (`local-provider/persistence.test.ts` pins this by value).
	 */
	it("even for the same member, a different instance doesn't save", async () => {
		const first = createProviderConnectionStore(secure, ALICE);
		const second = createProviderConnectionStore(secure, ALICE);

		const outcome = await connectProvider({
			provider: PROVIDER,
			byoAllowed: true,
			secret: "sk",
			/** The store at the moment the operation started. */
			store: first,
			/** The active one now is the second instance. */
			ownsStore: (candidate) => candidate === second,
			probe: async () => ok(),
			guard: { current: false },
		});

		expect(outcome.status).toBe("foreign");
		expect(await second.has(PROVIDER)).toBe(false);
	});

	/** **Do not swap in "whichever store is open now"**; that only renames the problem. */
	it("in someone else's session nothing is written to any store", async () => {
		const bobStore = createProviderConnectionStore(secure, BOB);
		await connectProvider({
			provider: PROVIDER,
			byoAllowed: true,
			secret: "sk-alice",
			store,
			ownsStore: () => false,
			probe: async () => ok(),
			guard: { current: false },
		});

		expect(await store.has(PROVIDER)).toBe(false);
		expect(await bobStore.has(PROVIDER)).toBe(false);
	});
});

describe("replacement doesn't delete a working connection", () => {
	beforeEach(async () => {
		await store.connect(PROVIDER, "sk-working");
	});

	/** **P0.** A failed replacement must not lose the connection. */
	it.each([
		["rejection", rejected],
		["network", failed("network")],
		["quota", failed("quota_exceeded")],
	])("with %s the old key stays", async (_name, check) => {
		const { outcome } = await run({ secret: "sk-bad", check });

		expect(outcome.status === "connected").toBe(false);
		expect(await store.has(PROVIDER)).toBe(true);
		expect(
			secure.entries().get([...secure.entries().keys()][0] ?? ""),
		).toContain("sk-working");
	});

	it("the old key stays even when the account switches", async () => {
		await run({ secret: "sk-new", ownsStore: () => false });
		expect(await store.has(PROVIDER)).toBe(true);
	});

	it("passing replaces it with the new key", async () => {
		const { outcome } = await run({ secret: "sk-new" });
		expect(outcome.status).toBe("connected");
		expect(
			secure.entries().get([...secure.entries().keys()][0] ?? ""),
		).toContain("sk-new");
	});
});
