import { describe, expect, it } from "vitest";
import type { ProviderConnectionSummary } from "../../lib/local-provider/record.ts";
import { resolveProviderConnectionsState } from "./provider-connections-state.ts";
import { PROVIDER_BYO_LOCKED } from "./provider-copy.ts";

/**
 * State of the provider connections section: **there are always two rows, and only the upper half
 * locks.**
 *
 * When this goes wrong, every symptom is silent:
 *
 * ```text
 * drawing loading as "not connected"   a person with a connection sees it vanish, then come back
 * locking disconnect too               a member confirmed under 14 can never delete a stored key
 * rows vanishing with the state        someone who came to fix a connection cannot find what to fix
 * ```
 */

const connection = (
	provider: ProviderConnectionSummary["provider"],
	updatedAt = "2026-08-01T00:00:00.000Z",
): ProviderConnectionSummary => ({ provider, connected: true, updatedAt });

const resolve = (
	overrides: Partial<
		Parameters<typeof resolveProviderConnectionsState>[0]
	> = {},
) =>
	resolveProviderConnectionsState({
		connections: [],
		loading: false,
		byoAllowed: true,
		capabilityLoading: false,
		lockedMessage: PROVIDER_BYO_LOCKED,
		...overrides,
	});

describe("waits for both", () => {
	/** Drawing after only one has arrived makes the row flicker through a different state for one frame. */
	it("loading while the connection list is pending", () => {
		expect(resolve({ loading: true }).kind).toBe("loading");
	});

	it("loading while eligibility hasn't been read yet", () => {
		expect(resolve({ capabilityLoading: true }).kind).toBe("loading");
	});

	/** **Different from "no connection"** — only say so once the value has actually arrived. */
	it("once both arrive it draws the rows even without connections", () => {
		const state = resolve();
		expect(state.kind).toBe("ready");
		expect(
			state.kind === "ready" && state.rows.map((row) => row.connected),
		).toEqual([false, false]);
	});
});

describe("the row list is fixed", () => {
	/**
	 * Rows do not disappear with the connection state. People come here mostly because a connection is
	 * wrong, and without the rows there is nothing to fix.
	 */
	it("two even with no connections", () => {
		const state = resolve();
		expect(
			state.kind === "ready" && state.rows.map((row) => row.provider),
		).toEqual(["anthropic-byo", "gemini-byo"]);
	});

	it("two even with only one connected", () => {
		const state = resolve({ connections: [connection("gemini-byo")] });
		expect(
			state.kind === "ready" && state.rows.map((row) => row.provider),
		).toEqual(["anthropic-byo", "gemini-byo"]);
		expect(
			state.kind === "ready" && state.rows.map((row) => row.connected),
		).toEqual([false, true]);
	});

	/** The order is fixed too: sorting by connection order would put the same row in a different place on each screen. */
	it("connection order doesn't change the row order", () => {
		const state = resolve({
			connections: [connection("gemini-byo"), connection("anthropic-byo")],
		});
		expect(
			state.kind === "ready" && state.rows.map((row) => row.provider),
		).toEqual(["anthropic-byo", "gemini-byo"]);
	});

	it("carries the connection time as is", () => {
		const state = resolve({
			connections: [connection("anthropic-byo", "2026-08-28T10:00:00.000Z")],
		});
		expect(state.kind === "ready" && state.rows[0]?.updatedAt).toBe(
			"2026-08-28T10:00:00.000Z",
		);
		/** No connection means no time either — do not invent one. */
		expect(state.kind === "ready" && state.rows[1]?.updatedAt).toBeNull();
	});
});

describe("without eligibility", () => {
	const locked = () => resolve({ byoAllowed: false });

	/** The rows stay and the reason is attached **once.** */
	it("rows don't disappear and one reason is attached", () => {
		const state = locked();
		expect(state.kind === "ready" && state.rows).toHaveLength(2);
		expect(state.kind === "ready" && state.lockedReason).toBe(
			PROVIDER_BYO_LOCKED,
		);
	});

	it("with eligibility there's no reason", () => {
		expect(resolve().kind === "ready" && resolve().kind).toBe("ready");
		const state = resolve();
		expect(state.kind === "ready" && state.lockedReason).toBeNull();
	});

	it("connecting and replacing lock", () => {
		const state = locked();
		expect(
			state.kind === "ready" && state.rows.every((row) => !row.canConnect),
		).toBe(true);
	});

	/**
	 * **P0.** If disconnect is locked symmetrically with saving, that person can never delete an API
	 * key still on their device, including on rows already connected.
	 */
	it("unlinking doesn't lock", () => {
		const state = resolveProviderConnectionsState({
			connections: [connection("anthropic-byo")],
			loading: false,
			byoAllowed: false,
			capabilityLoading: false,
			lockedMessage: PROVIDER_BYO_LOCKED,
		});
		expect(
			state.kind === "ready" && state.rows.every((row) => row.canDisconnect),
		).toBe(true);
	});

	/** The message also states **what still works**. */
	it("the notice says managed is still open", () => {
		const state = locked();
		expect(state.kind === "ready" && state.lockedReason).toContain(
			"RowCat-provided models",
		);
	});
});
