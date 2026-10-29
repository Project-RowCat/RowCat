import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECENT_LOGIN_REQUIRED } from "../account/security-error.ts";
import { SYNC_RESET_KEPT, SYNC_RESET_OTHER_DEVICES } from "./sync-copy.ts";
import { resetFailureMessage, SYNC_RESET_FAILED } from "./sync-failure.ts";

/**
 * Locks the **wiring** of the sync feature: what the type system cannot catch.
 *
 * The rules themselves are checked elsewhere: state decisions in `sync-state.test.ts`, the protocol
 * in `@rowcat/sync`, signal mapping in `lib/local-sync/auto-sync.test.ts`, runtime ownership in
 * `lib/local-sync/runtime.test.ts`. This file checks that screens only **read** the runtime, and
 * that they do not invent what the server cannot answer (device lists).
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

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("sync-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const feature = product.filter((file) =>
	file.path.startsWith("features/sync/"),
);

describe("the files to check actually exist", () => {
	it("the sync feature files are all in place", () => {
		for (const path of [
			"features/sync/sync-section.tsx",
			"features/sync/sync-state.ts",
			"features/sync/sync-copy.ts",
			"features/sync/sync-failure.ts",
			"features/sync/pair-device-dialog.tsx",
			"features/sync/approve-pairing-dialog.tsx",
			"features/sync/unlock-dialog.tsx",
			"features/sync/recovery-code-dialog.tsx",
			"features/sync/reset-sync-dialog.tsx",
			"lib/local-sync/transport.ts",
			"lib/local-sync/auto-sync.ts",
			"lib/local-sync/expo-signals.ts",
			"lib/local-sync/runtime.ts",
			"lib/local-sync/provider.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(true);
		expect(feature.length).toBeGreaterThan(5);
	});
});

describe("screens only read the runtime", () => {
	/**
	 * The root runtime owns the controller and coordinator. If a screen created them, every visit to
	 * the account screen would start one more initial sync, and which instance wins would depend on
	 * mount order.
	 */
	it("feature code doesn't create controllers or coordinators", () => {
		for (const file of feature) {
			expect(file.text, file.path).not.toContain("createSyncController");
			expect(file.text, file.path).not.toContain("createAutoSyncCoordinator");
			expect(file.text, file.path).not.toContain("createMobileSyncRuntime");
			expect(file.text, file.path).not.toContain("createMobileAutoSync");
		}
	});

	/** Each is created in exactly one lib file; a second assembly point would split the execution path. */
	it("the controller and coordinator each have one assembly point", () => {
		const controllerOwners = product
			.filter((file) => file.text.includes("createSyncController"))
			.map((file) => file.path);
		expect(controllerOwners).toEqual(["lib/local-sync/runtime.ts"]);

		const coordinatorOwners = product
			.filter((file) => file.text.includes("createAutoSyncCoordinator"))
			.map((file) => file.path);
		expect(coordinatorOwners).toEqual(["lib/local-sync/auto-sync.ts"]);
	});

	/**
	 * The transport adapter is the only app code that knows the SDK's sync surface. If a screen called
	 * `client.sync.…` directly, a second path would open that skips single-run, backoff and ownership
	 * checks.
	 */
	it("only the adapter knows the SDK sync surface", () => {
		const callers = product
			.filter((file) =>
				/client\.sync\.|\.sync\.pull\(|\.sync\.push\(/.test(file.text),
			)
			.map((file) => file.path);
		expect(callers).toEqual(["lib/local-sync/transport.ts"]);
		for (const file of feature)
			expect(file.text, file.path).not.toMatch(/\bfetch\s*\(/);
	});

	/**
	 * Feature code does not reimplement crypto. Codecs, keyrings and pairing envelopes all belong to
	 * `@rowcat/sync`, and this app's codec assembly is the single `registry.ts` (the same array as
	 * web).
	 */
	it("feature code has no crypto implementation", () => {
		for (const file of feature)
			for (const forbidden of [
				/@noble\//,
				/\bnobleAead\b/,
				/AES|HKDF|x25519/i,
				/unlockWithRecovery|buildKeyring|sealPairingDek|openPairingDek/,
				/normalizePairingCode|pairingCodeHash/,
				/crypto\.subtle/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/** No mobile-only codec copy; drift would show up as a field going empty on another device. */
	it("the codec assembly point is registry alone", () => {
		const owners = product
			.filter((file) => file.text.includes("createCodecRegistry"))
			.map((file) => file.path);
		expect(owners).toEqual(["lib/local-sync/registry.ts"]);
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/chat-mobile|authoring-mobile/);
	});
});

describe("doesn't invent a device list", () => {
	/**
	 * The server chose not to know device identities (pairing rows vanish on consume, cancel or
	 * expiry). Drawing a list makes `Remote revoke` stand beside it, and that is a lie today:
	 * undoing a device's knowledge of a key it already holds is impossible without key rotation plus
	 * full re-encryption. The authentication session list (the security section) is a different system
	 * and does not belong here.
	 */
	it("no device list, remote revoke or device name vocabulary", () => {
		for (const file of feature)
			for (const forbidden of [
				/device list|deviceList|trustedDevices/i,
				/remote revoke|remoteRevoke|revokeDevice/i,
				/userAgent|user-agent/i,
				/\bipAddress\b|IP address/i,
				/iPhone|MacBook|Galaxy|Windows/,
				/accountSessionsQueryOptions|revokeSessionMutationOptions/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
	});
});

describe("doesn't rebuild the schedule", () => {
	/**
	 * No periodic polling: a quiet app makes no requests. The one exception is the explicit
	 * five-minute poll in the pairing dialog, which the user watches while waiting, and its timer goes
	 * away when the dialog closes.
	 */
	it("there's no setInterval outside the pairing dialog", () => {
		for (const file of [
			...feature,
			...product.filter((f) => f.path.startsWith("lib/local-sync/")),
		])
			if (file.path !== "features/sync/pair-device-dialog.tsx")
				expect(file.text, file.path).not.toMatch(/setInterval/);
	});

	/** No remote wake-up imitation; SSE, push and background fetch arrive in their own slices. */
	it("no background infrastructure", () => {
		for (const file of product) {
			if (
				!file.path.startsWith("features/sync/") &&
				!file.path.startsWith("lib/local-sync/")
			)
				continue;
			for (const forbidden of [
				/wakeStream|EventSource|SSE/,
				/expo-background-fetch|expo-task-manager|expo-notifications/,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
		}
	});
});

describe("copy doesn't go beyond the promise", () => {
	/** "Real-time" and "reflected immediately" are false under this transport model; "backup" promises recovery. */
	it("no real-time or backup vocabulary", () => {
		for (const file of [
			...feature,
			product.find((f) => f.path === "features/account/data-section.tsx"),
		]) {
			if (!file) continue;
			for (const forbidden of [
				/real[- ]time/i,
				/instantly (on every device|reflected)/i,
				/backup/i,
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toMatch(forbidden);
		}
	});

	/** Cryptographic implementation vocabulary does not appear in screen copy; only words users can judge are used. */
	it("no crypto implementation vocabulary on screen", () => {
		const copy = fileAt("features/sync/sync-copy.ts");
		for (const forbidden of [
			/AES|GCM|HKDF|DEK|x25519|HLC/,
			/cursor|epoch|serverVersion|ciphertext/i,
		])
			expect(copy, `${forbidden}`).not.toMatch(forbidden);
	});
});

/**
 * **Does a locked device have an exit?**
 *
 * This app lacked that action for a while, and the absence produced no visible symptom: pairing and
 * the recovery code stood side by side, so the screen looked fine. Only the people who got stuck
 * were affected, and for them the only way out was the web.
 */
describe("Start over", () => {
	const section = () => fileAt("features/sync/sync-section.tsx");
	const dialog = () => fileAt("features/sync/reset-sync-dialog.tsx");

	/**
	 * **Only the locked branch gets this button.** A trusted device has no value to gain from it that
	 * risks the same cost: such a person has `Stop trusting this device` (forget this device), which does not erase
	 * the server's ciphertext.
	 */
	it("it's the third button of the locked branch", () => {
		const source = section();
		const unlock = source.indexOf('controls === "unlock"');
		expect(unlock).toBeGreaterThan(-1);
		/** The trusted branch that comes **after** the locked one is this button's right boundary. */
		const trusted = source.indexOf('controls === "trusted"', unlock);
		expect(trusted).toBeGreaterThan(unlock);
		/** Finds the **rendered position**, not the import line. */
		const button = source.indexOf("label={SYNC_RESET_LABEL}");
		expect(button).toBeGreaterThan(unlock);
		expect(button).toBeLessThan(trusted);
	});

	/**
	 * **An irreversible confirmation is an `AlertDialog`** (the slot for that in the presentation
	 * table). With `Dialog`, a backdrop tap closes it and the confirm button receives default focus.
	 * Web uses `Dialog` because its primitive handles those two separately; this app's container
	 * choice follows the nature of the interaction.
	 */
	it("the confirmation is an AlertDialog", () => {
		expect(dialog()).toContain("<AlertDialog");
		expect(dialog()).toContain("destructive");
		expect(dialog()).not.toContain("<Dialog");
		expect(dialog()).not.toContain("Alert.alert");
	});

	/**
	 * **The confirmation carries a sentence about what remains.** If only what disappears is stated,
	 * users read it as this device's drafts disappearing too, and that misreading blocks the people
	 * who most need this action.
	 */
	it("says what remains", () => {
		expect(dialog()).toContain("SYNC_RESET_KEPT");
		expect(dialog()).toContain("SYNC_RESET_OTHER_DEVICES");
		expect(SYNC_RESET_KEPT).toContain("stay as they are");
		expect(SYNC_RESET_OTHER_DEVICES).toContain("other devices");
	});

	/**
	 * **Only the recent-login failure has different copy**, because the user's next step is not "press
	 * again." The decision is not restated in this slice; the account-security `needsRecentLogin`
	 * alone holds it.
	 */
	it("tells recent sign-in failures apart", () => {
		const api = (code: string) =>
			Object.assign(new Error(code), {
				name: "RowCatApiError",
				code,
				status: 403,
			});
		expect(resetFailureMessage(api("recent_login_required"))).toBe(
			RECENT_LOGIN_REQUIRED,
		);
		expect(resetFailureMessage(new Error("boom"))).toBe(SYNC_RESET_FAILED);
		expect(resetFailureMessage(api("sync_quota_exceeded"))).toBe(
			SYNC_RESET_FAILED,
		);
	});

	/**
	 * **This dialog neither creates nor calls the controller.** It calls one function the section
	 * passes in, so the "screens only read the runtime" block above also holds for this dialog.
	 */
	it("the dialog doesn't grab the controller directly", () => {
		expect(dialog()).not.toContain("useMobileSyncRuntime");
		expect(dialog()).not.toContain("resetKeyring");
	});
});
