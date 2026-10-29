import type { KeyringDto } from "@rowcat/contracts";
import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import type { PairingRunnerTransport } from "@rowcat/sync";
import {
	buildKeyring,
	bytesToB64,
	deriveAuthKey,
	generateDek,
	nobleAead,
	normalizePairingCode,
	pairingCodeHash,
	sealPairingDek,
	verifyKeyringProof,
} from "@rowcat/sync";
import { describe, expect, test } from "vitest";
import { pairDevice } from "./pairing.ts";

/**
 * The six endings of the pairing procedure, with real crypto and no network.
 *
 * Sealing uses the real `sealPairingDek` and the check uses the real MAC, so "a wrong key is not
 * stored" is proven by value; a double that always answers `true` could not show that sentence is
 * true, and it is this slice's most expensive promise.
 *
 * Clock and sleep are arguments: really waiting out expiry, cancellation and retries of a 5-minute
 * procedure would make this file unrunnable.
 */

const OWNER = "0123456789abcdef0123456789abcdef";
const OTHER = "ffffffffffffffffffffffffffffffff";

/** Relay and keyring: imitates only the real server's decisions (a double, not a spec). */
class FakeRelay implements PairingRunnerTransport {
	keyring: string | null = null;
	authKey: Uint8Array | null = null;
	now = () => Date.now();
	readonly rows = new Map<
		string,
		{ newPub: string; payload: string | null; expiresAt: number }
	>();
	/** Read count, to tell whether polling stopped. */
	reads = 0;
	/** Fails this many more reads. */
	failReads = 0;

	private live(codeHash: string) {
		const row = this.rows.get(codeHash);
		if (!row) return null;
		return row.expiresAt <= this.now() ? null : row;
	}

	async getKeyring(): Promise<KeyringDto> {
		return { keyring: this.keyring };
	}

	async verifyKeyring(input: { keyring: string; proof: string }) {
		return (
			this.authKey !== null &&
			verifyKeyringProof(this.authKey, input.keyring, input.proof)
		);
	}

	async startPairing(input: { codeHash: string; newPublicKey: string }) {
		const row = {
			newPub: input.newPublicKey,
			payload: null as string | null,
			expiresAt: this.now() + SYNC_LIMITS.pairingTtlMinutes * 60_000,
		};
		this.rows.set(input.codeHash, row);
		return this.dto(row);
	}

	async readPairing(input: { codeHash: string }) {
		this.reads += 1;
		if (this.failReads > 0) {
			this.failReads -= 1;
			throw Object.assign(new Error("network"), { status: 0 });
		}
		const row = this.live(input.codeHash);
		if (!row)
			throw Object.assign(new Error("missing"), {
				status: 404,
				code: SYNC_ERROR_CODE.pairingNotFound,
			});
		return this.dto(row);
	}

	async approvePairing(input: { codeHash: string; payload: string }) {
		const row = this.live(input.codeHash);
		if (!row) throw new Error("missing");
		if (row.payload !== null)
			throw Object.assign(new Error("already approved"), {
				status: 409,
				code: SYNC_ERROR_CODE.pairingAlreadyApproved,
			});
		row.payload = input.payload;
	}

	async cancelPairing(input: { codeHash: string }) {
		this.rows.delete(input.codeHash);
	}

	private dto(row: {
		newPub: string;
		payload: string | null;
		expiresAt: number;
	}) {
		return {
			newPublicKey: row.newPub,
			payload: row.payload,
			expiresAt: new Date(row.expiresAt).toISOString(),
		};
	}
}

async function enableSync(relay: FakeRelay, owner: string) {
	const dek = generateDek();
	relay.keyring = (await buildKeyring(owner, dek, nobleAead)).keyring;
	relay.authKey = deriveAuthKey(dek, owner);
	return dek;
}

/** A trusted device's approval: copies the code shown on screen and seals the current DEK. */
async function approve(
	relay: FakeRelay,
	owner: string,
	code: string,
	dek: Uint8Array,
): Promise<void> {
	const normalizedCode = normalizePairingCode(code);
	const codeHash = pairingCodeHash(owner, normalizedCode);
	const session = await relay.readPairing({ codeHash });
	const { payload } = await sealPairingDek({
		owner,
		normalizedCode,
		newPublicKey: session.newPublicKey,
		dek,
		aead: nobleAead,
	});
	await relay.approvePairing({ codeHash, payload });
}

interface Harness {
	readonly lines: string[];
	/** The pairing code shown on screen, which the approving side copies. */
	code(): string;
	/** Fake wait; this hook runs every round. */
	onTick?: () => void | Promise<void>;
}

function run(
	relay: FakeRelay,
	overrides: Partial<Parameters<typeof pairDevice>[0]> = {},
): { promise: ReturnType<typeof pairDevice>; harness: Harness } {
	const lines: string[] = [];
	const harness: Harness = {
		lines,
		code: () => {
			const line = lines.find((row) => /^ {2}[0-9A-Z]{4}-/.test(row));
			if (line === undefined) throw new Error("the code is not on screen");
			return line.trim();
		},
	};
	const promise = pairDevice({
		owner: OWNER,
		transport: relay,
		out: (line) => lines.push(line),
		now: () => relay.now(),
		sleep: async () => {
			await harness.onTick?.();
		},
		stillOwned: async () => true,
		...overrides,
	});
	return { promise, harness };
}

describe("normal path", () => {
	test("the key crosses over without ever asking for the recovery code", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};

		const outcome = await promise;
		expect(outcome.status).toBe("paired");
		if (outcome.status !== "paired") throw new Error("unreachable");
		expect(bytesToB64(outcome.dek)).toBe(bytesToB64(dek));
		/** The screen holds only the code and instructions, no key or hash. */
		expect(harness.lines.join("\n")).toContain(
			"Account → Data → Connect a new device",
		);
		expect(harness.lines.join("\n")).not.toContain(bytesToB64(dek));
	});

	test("closes the relay after consuming it", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};
		await promise;
		expect(relay.rows.size).toBe(0);
	});
});

describe("cases that save nothing", () => {
	test("refuses a key that cannot open this account's keyring", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), generateDek()).catch(
					() => undefined,
				);
		};

		const outcome = await promise;
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.message).toContain("Nothing was saved");
		/** The recovery code is the way forward here (that account has a keyring). */
		expect(outcome.reason).toBe("pairing");
	});

	test("discards the key when the account changes after approval", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		let owned = true;
		const { promise, harness } = run(relay, {
			stillOwned: async () => owned,
		});
		harness.onTick = async () => {
			if (relay.rows.size > 0) {
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
				owned = false;
			}
		};

		const outcome = await promise;
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.message).toContain("are different accounts");
		expect(outcome.message).toContain("Nothing was saved");
	});

	test("a failed account check is treated the same as a change", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const { promise, harness } = run(relay, {
			stillOwned: async () => {
				throw new Error("network");
			},
		});
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};
		expect((await promise).status).toBe("failed");
	});

	test("an account without a keyring does not even make a code", async () => {
		const relay = new FakeRelay();
		const { promise, harness } = run(relay);
		const outcome = await promise;
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.message).toContain("Turn on sync");
		/** The one failure where a recovery code is not the answer; the branch is stated by value. */
		expect(outcome.reason).toBe("sync_disabled");
		expect(relay.rows.size).toBe(0);
		expect(harness.lines.join("\n")).not.toContain("Pairing code");
	});
});

describe("other reasons the procedure ends", () => {
	test("on expiry it stops waiting and closes the relay", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		const base = Date.now();
		relay.now = () => base;
		const { promise, harness } = run(relay);
		harness.onTick = () => {
			relay.now = () => base + SYNC_LIMITS.pairingTtlMinutes * 60_000 + 1;
		};
		expect((await promise).status).toBe("expired");
		/** Telling the user how to restart is the CLI's job; this function only returns the branch. */
		expect(relay.rows.size).toBe(0);
	});

	test("cancelling closes the relay and leaves", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		let cancelled = false;
		const { promise, harness } = run(relay, { cancelled: () => cancelled });
		harness.onTick = () => {
			cancelled = true;
		};
		expect((await promise).status).toBe("cancelled");
		expect(relay.rows.size).toBe(0);
	});

	test("stops and says so when consecutive failures hit the cap", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		relay.failReads = 99;
		const outcome = await run(relay).promise;
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.message).toContain("check the network");
		/** Does not keep hammering forever. */
		expect(relay.reads).toBeLessThanOrEqual(5);
	});

	test("transient failures do not kill the procedure", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		relay.failReads = 2;
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};
		expect((await promise).status).toBe("paired");
	});
});

describe("polling", () => {
	test("asks no more once approval arrives", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};
		await promise;
		const settled = relay.reads;
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(relay.reads).toBe(settled);
	});

	test("the interval comes in as an argument: it does not wait real time", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const waits: number[] = [];
		const { promise, harness } = run(relay, {
			pollIntervalMs: 2_000,
			sleep: async (ms) => {
				waits.push(ms);
				await harness.onTick?.();
			},
		});
		harness.onTick = async () => {
			if (relay.rows.size > 0)
				await approve(relay, OWNER, harness.code(), dek).catch(() => undefined);
		};
		await promise;
		expect(waits).toEqual([2_000]);
	});
});

describe("another account's envelope", () => {
	test("an envelope sealed with a different owner does not open", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		const { promise, harness } = run(relay);
		harness.onTick = async () => {
			if (relay.rows.size === 0) return;
			const code = harness.code();
			/** A manipulation the server could make: places an envelope derived for another owner here. */
			const normalizedCode = normalizePairingCode(code);
			const hash = pairingCodeHash(OWNER, normalizedCode);
			const row = relay.rows.get(hash);
			if (row === undefined || row.payload !== null) return;
			const { payload } = await sealPairingDek({
				owner: OTHER,
				normalizedCode,
				newPublicKey: row.newPub,
				dek: generateDek(),
				aead: nobleAead,
			});
			row.payload = payload;
		};
		const outcome = await promise;
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.message).toContain("rowcat-mcp pair");
	});
});
