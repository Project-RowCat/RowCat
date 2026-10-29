import type { ByoProvider } from "@rowcat/chat";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "#/lib/generation/errors.ts";
import type { CredentialCheck } from "#/lib/generation/transport.ts";
import {
	connectProvider,
	credentialFailureMessage,
} from "./connect-provider.ts";

/**
 * The order of saving a key, and what its failures mean.
 *
 * The file pins one thing: a key that has not passed verification is never saved. If that reversed,
 * a screen saying connected would disagree with the 401 on the next conversation, and the user
 * would have no way to learn what went wrong.
 *
 * The other three rules also protect what the user stands to lose. A transient failure does not
 * save, so a wrong key does not stay connected. A double submit does not write twice, since
 * whichever finishes last wins and that may not be the key just entered. A failure is not collapsed
 * into one sentence, since that would send users to re-issue a working key.
 */

const guard = () => ({ current: false });

const ok = (): CredentialCheck => ({ ok: true });
const rejected = (): CredentialCheck => ({
	ok: false,
	error: new ProviderError("invalid_credential"),
});
const temporary = (): CredentialCheck => ({
	ok: false,
	error: new ProviderError("network"),
});

const KEY = "sk-ant-test-0123456789";

describe("accounts under 14: blocked before verification", () => {
	/**
	 * Blocks before the verification request goes out. If placed later, a request reaches the provider
	 * with a key that cannot work, which costs the user and stays on their account.
	 */
	it("neither verifies nor saves", async () => {
		const probe = vi.fn(async () => ok());
		const save = vi.fn(async () => {});
		const outcome = await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			byoAllowed: false,
			probe,
			save,
			guard: guard(),
		});

		expect(outcome.status).toBe("not_permitted");
		expect(probe).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	});

	/**
	 * This state must differ from `rejected` and `failed`. Those two can be fixed by editing the value
	 * or pressing again. This one cannot be fixed that way, and collapsing it into them would send the
	 * user to re-issue a working key.
	 */
	it("does not say the key is wrong", async () => {
		const outcome = await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			byoAllowed: false,
			probe: async () => ok(),
			save: async () => {},
			guard: guard(),
		});
		expect(outcome.status).not.toBe("rejected");
		if (outcome.status === "not_permitted") {
			expect(outcome.message).toContain("under 14");
			expect(outcome.message).not.toContain("check the key");
		}
	});

	/** Nothing started, so the gate also stays open. */
	it("does not close the progress gate", async () => {
		const shared = guard();
		await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			byoAllowed: false,
			probe: async () => ok(),
			save: async () => {},
			guard: shared,
		});
		expect(shared.current).toBe(false);
	});
});

describe("saves only keys that passed verification", () => {
	it("saves when it passes", async () => {
		const save = vi.fn(async () => {});
		const outcome = await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			probe: async () => ok(),
			save,
			byoAllowed: true,
			guard: guard(),
		});

		expect(outcome).toEqual({ status: "connected" });
		expect(save).toHaveBeenCalledExactlyOnceWith("anthropic-byo", KEY);
	});

	it("does not save when rejected", async () => {
		const save = vi.fn(async () => {});
		const outcome = await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			probe: async () => rejected(),
			save,
			byoAllowed: true,
			guard: guard(),
		});

		expect(outcome.status).toBe("rejected");
		expect(save).not.toHaveBeenCalled();
	});

	it("does not save on a transient failure either", async () => {
		const save = vi.fn(async () => {});
		const outcome = await connectProvider({
			provider: "gemini-byo",
			secret: KEY,
			probe: async () => temporary(),
			save,
			byoAllowed: true,
			guard: guard(),
		});

		/** A key that is probably valid is not saved. It has never been confirmed. */
		expect(outcome.status).toBe("failed");
		expect(save).not.toHaveBeenCalled();
	});

	it("saving never happens before verification", async () => {
		const order: string[] = [];
		await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			probe: async () => {
				order.push("probe");
				return ok();
			},
			save: async () => {
				order.push("save");
			},
			byoAllowed: true,
			guard: guard(),
		});

		expect(order).toEqual(["probe", "save"]);
	});

	it("a failed save ends as not connected", async () => {
		const outcome = await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			probe: async () => ok(),
			save: async () => {
				throw new Error("dexie died");
			},
			byoAllowed: true,
			guard: guard(),
		});

		expect(outcome.status).toBe("failed");
		/** The raw message (`dexie died`) must not reach the user. */
		if (outcome.status === "failed")
			expect(outcome.message).not.toContain("dexie");
	});
});

describe("two submits in the same tick", () => {
	it("verifies and saves only once", async () => {
		const probe = vi.fn(async () => ok());
		const save = vi.fn(async () => {});
		const shared = guard();
		const input = {
			provider: "anthropic-byo" as ByoProvider,
			secret: KEY,
			probe,
			save,
			byoAllowed: true,
			guard: shared,
		};

		const [first, second] = await Promise.all([
			connectProvider(input),
			connectProvider(input),
		]);

		expect(probe).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledTimes(1);
		expect([first.status, second.status].sort()).toEqual(["busy", "connected"]);
	});

	it("the gate reopens when done", async () => {
		const shared = guard();
		const input = {
			provider: "anthropic-byo" as ByoProvider,
			secret: KEY,
			probe: async () => ok(),
			save: async () => {},
			byoAllowed: true,
			guard: shared,
		};

		await connectProvider(input);
		expect(shared.current).toBe(false);
		expect((await connectProvider(input)).status).toBe("connected");
	});

	it("the gate does not stay closed after a failure", async () => {
		const shared = guard();
		await connectProvider({
			provider: "anthropic-byo",
			secret: KEY,
			probe: async () => {
				throw new Error("network");
			},
			save: async () => {},
			byoAllowed: true,
			guard: shared,
		});
		expect(shared.current).toBe(false);
	});
});

describe("failures mean different things", () => {
	it("rejection and transient failure are different states", async () => {
		const of = async (check: CredentialCheck) =>
			(
				await connectProvider({
					provider: "anthropic-byo",
					secret: KEY,
					probe: async () => check,
					save: async () => {},
					byoAllowed: true,
					guard: guard(),
				})
			).status;

		expect(await of(rejected())).toBe("rejected");
		expect(await of(temporary())).toBe("failed");
	});

	it("network, blocking and provider outages fold into one sentence", () => {
		const messages = new Set(
			(["network", "browser_blocked", "provider_error"] as const).map((code) =>
				credentialFailureMessage(new ProviderError(code)),
			),
		);
		expect(messages.size).toBe(1);
	});

	it("a model error is not described as a model problem on the key screen", () => {
		/**
		 * This screen has no model to choose. Passing a 404 through would send the user to options that
		 * do not exist, so it collapses into the same sentence as transient failures.
		 */
		const message = credentialFailureMessage(
			new ProviderError("model_unavailable"),
		);
		expect(message).not.toContain("model");
		expect(message).toBe(
			credentialFailureMessage(new ProviderError("network")),
		);
	});

	it("rejection, rate limit and credits are different sentences", () => {
		const messages = (
			["invalid_credential", "rate_limited", "quota_exceeded"] as const
		).map((code) => credentialFailureMessage(new ProviderError(code)));
		expect(new Set(messages).size).toBe(3);
	});

	it("no copy carries the key", () => {
		for (const code of [
			"invalid_credential",
			"rate_limited",
			"quota_exceeded",
			"network",
		] as const)
			expect(credentialFailureMessage(new ProviderError(code))).not.toContain(
				KEY,
			);
	});
});
