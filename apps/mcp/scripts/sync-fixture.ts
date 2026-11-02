import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { SYNC_ENVELOPE_VERSION } from "@rowcat/contracts/sync";
import { createRowCatClient } from "@rowcat/sdk";
import {
	createKeyring,
	decryptRecord,
	deriveAuthKey,
	encryptRecord,
	generatePairingCode,
	generatePairingKeyPair,
	nobleAead,
	normalizePairingCode,
	openPairingDek,
	pairingCodeHash,
	proveKeyring,
	sealPairingDek,
	unlockWithRecovery,
} from "@rowcat/sync";

/**
 * Plays a member's devices against a live API so an operator procedure can be checked end to end:
 * `seed` sets up a sync keyring and uploads a few encrypted records, and `verify` (run later, after
 * a backup was restored or an image upgraded) proves the same account can still use them.
 *
 *   tsx apps/mcp/scripts/sync-fixture.ts seed   <api base, e.g. http://localhost:3001/v2> <cookie file> <state file>
 *   tsx apps/mcp/scripts/sync-fixture.ts verify <api base> <cookie file> <state file>
 *
 * What `verify` means by "still works" is what a person would notice:
 *   - the keyring on the server still opens with the recovery code shown at setup, and yields the
 *     same key (the server holds nothing that could check this; only the key can);
 *   - the server still accepts proof of possession of that key;
 *   - every record pulls back with its ciphertext intact and decrypts to what was uploaded;
 *   - a new device can pair through the relay and receive that key.
 *
 * It lives here because this package is the repository's headless device: it already depends on
 * `@rowcat/sync` and `@rowcat/sdk`, and the API may import only `@rowcat/sync/server`. The session
 * cookie comes from a file and the state is written owner-only, so neither a cookie nor the key
 * ever lands on a command line or in a log. Progress goes to stderr; stdout stays empty.
 */

const [mode, base, cookieFile, stateFile] = process.argv.slice(2);
const RECORD_TYPE = "fixture.note";

interface FixtureState {
	owner: string;
	dek: string;
	recoveryCode: string;
	records: { id: string; text: string }[];
}

const say = (line: string): void => {
	process.stderr.write(`${line}\n`);
};
const failures: string[] = [];
const check = (ok: boolean, label: string): void => {
	say(`  ${ok ? "✓" : "✗"} ${label}`);
	if (!ok) failures.push(label);
};
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, i) => byte === b[i]);

function client(cookie: string) {
	return createRowCatClient({ baseUrl: base, headers: { Cookie: cookie } });
}

async function ownerOf(cookie: string): Promise<string> {
	const me = await fetch(`${base}/me`, { headers: { Cookie: cookie } });
	const viewer = (await me.json()) as { id?: string };
	if (typeof viewer.id !== "string") throw new Error("/me returned no member");
	return viewer.id;
}

async function seed(cookie: string): Promise<void> {
	const owner = await ownerOf(cookie);
	const api = client(cookie);
	const dek = new Uint8Array(randomBytes(32));
	const created = await createKeyring(owner, dek, nobleAead);
	await api.sync.setupKeyring({
		keyring: created.keyring,
		authKey: created.authKey,
	});
	const records = Array.from({ length: 3 }, (_, i) => ({
		id: `fixture-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
		text: `fixture note ${i + 1}`,
	}));
	const items = await Promise.all(
		records.map(async (record) => ({
			id: record.id,
			type: RECORD_TYPE,
			baseVersion: 0,
			ciphertext: await encryptRecord(
				dek,
				{ owner, recordId: record.id, type: RECORD_TYPE },
				{ text: record.text },
				nobleAead,
			),
			envelope: SYNC_ENVELOPE_VERSION,
			deleted: false,
		})),
	);
	const pushed = await api.sync.push({
		items,
		idempotencyKey: `fixture-${randomUUID()}`,
	});
	check(pushed.ok === true, `uploaded ${records.length} encrypted records`);
	const state: FixtureState = {
		owner,
		dek: Buffer.from(dek).toString("base64"),
		recoveryCode: created.recoveryCode,
		records,
	};
	writeFileSync(stateFile as string, JSON.stringify(state), { mode: 0o600 });
}

async function verify(cookie: string): Promise<void> {
	const state = JSON.parse(
		readFileSync(stateFile as string, "utf8"),
	) as FixtureState;
	const api = client(cookie);
	const dek = new Uint8Array(Buffer.from(state.dek, "base64"));

	check((await ownerOf(cookie)) === state.owner, "the session is the same member");

	const { keyring } = await api.sync.getKeyring();
	check(keyring !== null, "the keyring is on the server");
	if (keyring === null) return;
	let unlocked: Uint8Array | null = null;
	try {
		unlocked = await unlockWithRecovery(
			state.owner,
			keyring,
			state.recoveryCode,
			nobleAead,
		);
	} catch {
		unlocked = null;
	}
	check(
		unlocked !== null && sameBytes(unlocked, dek),
		"the recovery code still opens the keyring to the same key",
	);
	check(
		await api.sync.verifyKeyring({
			keyring,
			proof: proveKeyring(deriveAuthKey(dek, state.owner), keyring),
		}),
		"the server accepts proof of possession of that key",
	);

	const page = await api.sync.pull({ since: 0 });
	const byId = new Map(page.records.map((record) => [record.id, record]));
	let intact = 0;
	for (const record of state.records) {
		const pulled = byId.get(record.id);
		if (pulled?.ciphertext == null) continue;
		try {
			const plain = (await decryptRecord(
				dek,
				{ owner: state.owner, recordId: record.id, type: RECORD_TYPE },
				pulled.ciphertext,
				nobleAead,
			)) as { text?: string };
			if (plain.text === record.text) intact += 1;
		} catch {
			/* counted as not intact */
		}
	}
	check(
		intact === state.records.length,
		`all ${state.records.length} records pull back and decrypt (${intact})`,
	);

	/** A new device pairs through the relay, the way the web and the MCP device do it. */
	const code = generatePairingCode();
	const normalizedCode = normalizePairingCode(code);
	const codeHash = pairingCodeHash(state.owner, normalizedCode);
	const pair = generatePairingKeyPair();
	await api.sync.startPairing({ codeHash, newPublicKey: pair.publicKey });
	const session = await api.sync.readPairing({ codeHash });
	const { payload } = await sealPairingDek({
		owner: state.owner,
		normalizedCode,
		newPublicKey: session.newPublicKey,
		dek,
		aead: nobleAead,
	});
	await api.sync.approvePairing({ codeHash, payload });
	const approved = await api.sync.readPairing({ codeHash });
	let received: Uint8Array | null = null;
	if (approved.payload !== null) {
		received = await openPairingDek({
			owner: state.owner,
			normalizedCode,
			privateKey: pair.privateKey,
			payload: approved.payload,
			aead: nobleAead,
		});
	}
	await api.sync.cancelPairing({ codeHash });
	check(
		received !== null && sameBytes(received, dek),
		"a new device pairs and receives the same key",
	);
}

async function main(): Promise<void> {
	if (
		(mode !== "seed" && mode !== "verify") ||
		base === undefined ||
		cookieFile === undefined ||
		stateFile === undefined
	) {
		say("usage: sync-fixture.ts <seed|verify> <api base> <cookie file> <state file>");
		process.exit(2);
	}
	const cookie = readFileSync(cookieFile, "utf8").trim();
	say(`sync fixture: ${mode}`);
	await (mode === "seed" ? seed(cookie) : verify(cookie));
	if (failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
	say(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
