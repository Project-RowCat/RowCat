import {
	DEFAULT_MANAGED_MODEL,
	ROWCAT_MANAGED_MODELS,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { resolveGenerationExecution } from "./generation-availability.ts";
import {
	type GenerationTarget,
	PRODUCT_GENERATION_TARGET,
} from "./generation-preference.ts";

/**
 * Availability tests: the guarantee that there is no silent fallback to another target.
 *
 * A regression here is invisible on screen. Falling back to RowCat when a provider is not connected
 * would keep the chat running while the user believes their chosen model is running, though
 * billing, the server the prompt passes through, and the model itself all differ.
 */

const ANTHROPIC: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};
const GEMINI: GenerationTarget = {
	provider: "gemini-byo",
	model: "gemini-3.7-flash",
};

describe("managed requires no connection", () => {
	it("runnable with no connection at all", () => {
		expect(
			resolveGenerationExecution({
				target: PRODUCT_GENERATION_TARGET,
				connectedProviders: [],
				byoAllowed: true,
			}),
		).toEqual({ status: "executable", target: PRODUCT_GENERATION_TARGET });
	});

	/**
	 * Applies to every managed model, not just the default. If one required a connection, users
	 * without a BYO key could never use it, and the managed tier has no connection flow to unblock
	 * them.
	 */
	it.each([
		...ROWCAT_MANAGED_MODELS,
	])("%s도 연결 없이 실행 가능하다", (model) => {
		expect(
			resolveGenerationExecution({
				target: { provider: "rowcat", model },
				connectedProviders: [],
				byoAllowed: true,
			}).status,
		).toBe("executable");
	});

	/**
	 * Child accounts can still use managed models. The BYO restriction covers requests that do not
	 * pass through the RowCat server; managed models are the opposite case.
	 */
	it.each([
		...ROWCAT_MANAGED_MODELS,
	])("%s는 BYO가 막힌 계정에서도 실행 가능하다", (model) => {
		expect(
			resolveGenerationExecution({
				target: { provider: "rowcat", model },
				connectedProviders: [],
				byoAllowed: false,
			}).status,
		).toBe("executable");
	});
});

describe("BYO requires this device's connection", () => {
	it("runnable with a connection", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
			}),
		).toEqual({ status: "executable", target: ANTHROPIC });
	});

	it("blocked without a connection", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: [],
				byoAllowed: true,
			}),
		).toEqual({
			status: "blocked",
			target: ANTHROPIC,
			reason: "provider_not_connected",
		});
	});

	/**
	 * A connection to another provider must not help. Without this assertion, an implementation that
	 * passes when any connection exists would go unnoticed.
	 */
	it("another provider's connection does not pass", () => {
		const execution = resolveGenerationExecution({
			target: ANTHROPIC,
			connectedProviders: ["gemini-byo"],
			byoAllowed: true,
		});
		expect(execution.status).toBe("blocked");
	});

	it("Gemini follows the same rule", () => {
		expect(
			resolveGenerationExecution({
				target: GEMINI,
				connectedProviders: ["gemini-byo"],
				byoAllowed: true,
			}).status,
		).toBe("executable");
		expect(
			resolveGenerationExecution({
				target: GEMINI,
				connectedProviders: [],
				byoAllowed: true,
			}).status,
		).toBe("blocked");
	});
});

describe("account entitlement comes before the connection", () => {
	/**
	 * Blocked even when a connection exists. On a device that already has a key connected, an account
	 * can later be confirmed as under 14. If the check fell through to 'connected, so it works', the
	 * restriction would block nothing.
	 */
	it("BYO is blocked even with a connection", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: ["anthropic-byo"],
				byoAllowed: false,
			}),
		).toEqual({
			status: "blocked",
			target: ANTHROPIC,
			reason: "byo_not_permitted",
		});
	});

	/**
	 * The reason must not be `provider_not_connected`. That reason means 'connect in settings', a dead
	 * end for an under-14 account, which cannot connect even with a key.
	 */
	it("when both fail, account entitlement is stated first", () => {
		const execution = resolveGenerationExecution({
			target: ANTHROPIC,
			connectedProviders: [],
			byoAllowed: false,
		});
		expect(execution).toEqual({
			status: "blocked",
			target: ANTHROPIC,
			reason: "byo_not_permitted",
		});
	});

	/**
	 * Managed models are exempt from this axis: a child's conversation must not be blocked entirely.
	 */
	it("managed stays runnable", () => {
		expect(
			resolveGenerationExecution({
				target: PRODUCT_GENERATION_TARGET,
				connectedProviders: [],
				byoAllowed: false,
			}).status,
		).toBe("executable");
	});
});

describe("does not substitute", () => {
	/**
	 * The most important block in this file. A blocked result must never carry a different target,
	 * enforced by both the type and the value. The `target` is always the one the user chose, so the
	 * screen can say exactly which provider is not connected to this device.
	 */
	it("a blocked result does not point at RowCat", () => {
		const execution = resolveGenerationExecution({
			target: ANTHROPIC,
			connectedProviders: [],
			byoAllowed: true,
		});
		expect(execution.target).toEqual(ANTHROPIC);
		expect(execution.target.provider).not.toBe("rowcat");
	});

	it("a blocked result does not change the stored preference", () => {
		const target: GenerationTarget = { ...ANTHROPIC };
		resolveGenerationExecution({
			target,
			connectedProviders: [],
			byoAllowed: true,
		});
		expect(target).toEqual(ANTHROPIC);
	});
});

describe("models gone from the catalogue", () => {
	const catalog = [
		{ provider: "rowcat", model: DEFAULT_MANAGED_MODEL },
		{ provider: "rowcat", model: "claude-sonnet-5" },
		{ provider: "anthropic-byo", model: "claude-sonnet-5" },
	] as const;

	it("passes when in the catalogue", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
				catalog,
			}).status,
		).toBe("executable");
	});

	it("blocked when connected but the model is gone", () => {
		expect(
			resolveGenerationExecution({
				target: { provider: "anthropic-byo", model: "claude-retired-3" },
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
				catalog,
			}),
		).toEqual({
			status: "blocked",
			target: { provider: "anthropic-byo", model: "claude-retired-3" },
			reason: "model_unavailable",
		});
	});

	/**
	 * When both the connection and the model are missing, report the missing connection first.
	 * Switching models does not help while there is no connection.
	 */
	it("states the missing connection when both connection and model are missing", () => {
		const execution = resolveGenerationExecution({
			target: { provider: "anthropic-byo", model: "claude-retired-3" },
			connectedProviders: [],
			byoAllowed: true,
			catalog,
		});
		expect(execution).toMatchObject({ reason: "provider_not_connected" });
	});

	/**
	 * At generation time the catalog is not passed. If the server state could not be read, blocking
	 * the conversation would be a fault rather than a setting. A model that is really gone is rejected
	 * by the provider.
	 */
	it("does not judge model existence when the catalogue is unknown", () => {
		expect(
			resolveGenerationExecution({
				target: { provider: "anthropic-byo", model: "claude-retired-3" },
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
			}).status,
		).toBe("executable");
	});

	/**
	 * An empty catalog means 'nothing is available', unlike an unreadable one, so managed models are
	 * blocked too.
	 */
	it("an empty catalogue differs from an unknown one", () => {
		expect(
			resolveGenerationExecution({
				target: PRODUCT_GENERATION_TARGET,
				connectedProviders: [],
				byoAllowed: true,
				catalog: [],
			}).status,
		).toBe("blocked");
		expect(
			resolveGenerationExecution({
				target: PRODUCT_GENERATION_TARGET,
				connectedProviders: [],
				byoAllowed: true,
			}).status,
		).toBe("executable");
	});
});

/**
 * Protected-manuscript room: runs only on RowCat-managed models. The server assembles the
 * manuscript; a BYO request is sent by the browser straight to the provider and has no way to carry
 * it.
 */
describe("resolveGenerationExecution: protected stories", () => {
	it("BYO is blocked even with a connection", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
				managedOnly: true,
			}),
		).toEqual({ status: "blocked", target: ANTHROPIC, reason: "managed_only" });
	});

	it("managed stays runnable", () => {
		expect(
			resolveGenerationExecution({
				target: PRODUCT_GENERATION_TARGET,
				connectedProviders: [],
				byoAllowed: true,
				managedOnly: true,
			}).status,
		).toBe("executable");
	});

	it("outside protected stories this axis changes nothing", () => {
		expect(
			resolveGenerationExecution({
				target: ANTHROPIC,
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
			}).status,
		).toBe("executable");
	});
});
