import type { SyncSnapshot } from "@rowcat/sync";
import { describe, expect, it } from "vitest";
import type { AutoSyncSnapshot } from "../../lib/local-sync/auto-sync.ts";
import {
	autoSyncTextFor,
	syncControlsFor,
	syncStatusTextFor,
} from "./sync-state.ts";

/**
 * Screen decisions for the sync section: state vocabulary → action groups and sentences.
 *
 * If these decisions lived inside the component, the only way to check them would be to try the
 * screen by hand, and a mistake would show no symptom (a setup button on a locked device, or trust
 * actions on an account that never enabled sync).
 */

const snapshot = (patch: Partial<SyncSnapshot>): SyncSnapshot => ({
	state: "idle",
	trusted: false,
	initialSyncDone: false,
	lastSyncedAt: null,
	lastError: null,
	...patch,
});

const auto = (patch: Partial<AutoSyncSnapshot>): AutoSyncSnapshot => ({
	phase: "idle",
	lastSuccessAt: null,
	errorCategory: null,
	reason: null,
	enabled: true,
	...patch,
});

describe("operation groups", () => {
	it("unset → set up, locked → two ways to unlock, trusted → management operations", () => {
		expect(syncControlsFor(snapshot({ state: "disabled" }))).toBe("setup");
		expect(syncControlsFor(snapshot({ state: "locked" }))).toBe("unlock");
		expect(syncControlsFor(snapshot({ state: "ready", trusted: true }))).toBe(
			"trusted",
		);
	});

	/**
	 * Alternating `ready ↔ syncing` must not change the group; if it did, the buttons would vanish and
	 * reappear on every sync run.
	 */
	it("the trusted group stays even while syncing", () => {
		expect(syncControlsFor(snapshot({ state: "syncing", trusted: true }))).toBe(
			"trusted",
		);
		expect(syncControlsFor(snapshot({ state: "error", trusted: true }))).toBe(
			"trusted",
		);
	});

	/** While checking (trust not yet known), no actions appear. */
	it("no operations while checking", () => {
		expect(syncControlsFor(snapshot({ state: "checking" }))).toBe("none");
	});
});

describe("status sentences", () => {
	it("the six states have different sentences", () => {
		const headlines = new Set(
			(
				[
					{ state: "checking" },
					{ state: "disabled" },
					{ state: "locked" },
					{ state: "syncing" },
					{ state: "error" },
					{ state: "ready", lastSyncedAt: "2026-08-28T00:00:00.000Z" },
				] as const
			).map((patch) => syncStatusTextFor(snapshot(patch)).headline),
		);
		expect(headlines.size).toBe(6);
	});

	/** The failure sentence also states that local data is safe; a sync failure is not a save failure. */
	it("failures get a sentence saying local data is safe", () => {
		const text = syncStatusTextFor(snapshot({ state: "error" }));
		expect(text.note).toContain("intact");
	});

	/** The locked guidance names both routes (pairing and recovery code). */
	it("locked doesn't read as a dead end", () => {
		const text = syncStatusTextFor(snapshot({ state: "locked" }));
		expect(text.note).toContain("another device");
		expect(text.note).toContain("recovery code");
	});

	/**
	 * A restricted account's failure does not say sync is dead as a whole. Only uploading is blocked;
	 * downloading continues.
	 */
	it("the restricted account sentence doesn't say receiving is dead", () => {
		const text = syncStatusTextFor(
			snapshot({ state: "error", lastError: "account_restricted" }),
		);
		expect(text.headline).toContain("can't upload");
		expect(text.headline).toContain("keep coming in");
	});
});

describe("automatic sync sentences", () => {
	it("off, offline, retrying, blocked and normal have different sentences", () => {
		const texts = new Set([
			autoSyncTextFor(auto({ enabled: false })),
			autoSyncTextFor(auto({ phase: "offline" })),
			autoSyncTextFor(auto({ phase: "backoff" })),
			autoSyncTextFor(auto({ phase: "blocked", errorCategory: "crypto" })),
			autoSyncTextFor(auto({})),
		]);
		expect(texts.size).toBe(5);
	});

	/** "Off" takes precedence over every other phase; someone who turned it off never sees a retry sentence. */
	it("off outranks the phase", () => {
		expect(autoSyncTextFor(auto({ enabled: false, phase: "backoff" }))).toBe(
			autoSyncTextFor(auto({ enabled: false })),
		);
	});
});
