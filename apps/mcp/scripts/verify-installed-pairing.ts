import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRowCatClient } from "@rowcat/sdk";
import {
	createKeyring,
	nobleAead,
	normalizePairingCode,
	pairingCodeHash,
	sealPairingDek,
} from "@rowcat/sync";

/**
 * Pairs the installed executable with an account on a live RowCat API, the way a person does it:
 * `rowcat-mcp pair` prints a short code and an already-connected device approves it.
 *
 * `verify-installed-loop.ts` hands the key in through `ROWCAT_SYNC_KEY`, so it says nothing about
 * the path a fork's users actually take on their own instance: start a relay, show a code, receive
 * the sealed key, open it, check it against the keyring, remember it. This script plays the trusted
 * device (account, keyring, approval through the same `sealPairingDek` the web uses) and leaves the
 * new-device half to the installed copy. What it then checks is what the installed copy wrote: the
 * key file holds the very key this side sealed, under this account, and `doctor` agrees.
 *
 * `HOME` points at a fresh temp directory, so the run never reads or writes the person's own
 * `~/.rowcat`. Like the loop script it is not run automatically — it creates an account on the API
 * it is pointed at. Point it at a clean instance with no sign-up verification:
 *
 * ```bash
 * ROWCAT_API_BASE_URL=http://localhost:3061/v2 \
 *   tsx apps/mcp/scripts/verify-installed-pairing.ts [executable path]
 * ```
 */

const BASE = process.env.ROWCAT_API_BASE_URL ?? "http://localhost:3001/v2";
const BIN = process.argv[2] ?? "rowcat-mcp";
/** The relay lives five minutes; the code appears within seconds, so this only bounds a hang. */
const CODE_DEADLINE_MS = 30_000;
const EXIT_DEADLINE_MS = 60_000;

const say = (line: string): void => {
	process.stderr.write(`${line}\n`);
};

const failures: string[] = [];
const check = (ok: boolean, label: string, detail?: string): void => {
	say(
		`  ${ok ? "✓" : "✗"} ${label}${detail === undefined ? "" : ` — ${detail}`}`,
	);
	if (!ok) failures.push(label);
};

const cookieOf = (response: Response): string =>
	(response.headers.getSetCookie?.() ?? [])
		.map((line) => line.split(";")[0] ?? "")
		.filter((pair) => pair.includes("="))
		.join("; ");

async function createAccount(): Promise<{ cookie: string; id: string }> {
	const email = `mcp-pairing-${Date.now()}@rowcat.test`;
	const password = `pairing-${randomUUID().slice(0, 12)}`;
	const origin = new URL(BASE).origin;
	const signUp = await fetch(`${BASE}/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ email, password, name: "MCP Pairing" }),
	});
	if (!signUp.ok) throw new Error(`sign-up failed HTTP ${signUp.status}`);
	const cookie = cookieOf(signUp);
	if (cookie === "")
		throw new Error(
			"No session was created: the deployment may require email verification.",
		);
	const me = await fetch(`${BASE}/me`, { headers: { Cookie: cookie } });
	const viewer = (await me.json()) as { id?: string };
	if (typeof viewer.id !== "string") throw new Error("/me returned no member");
	return { cookie, id: viewer.id };
}

/** Runs one CLI command to its exit; `onLine` sees each stderr line as it arrives. */
function run(
	args: string[],
	env: NodeJS.ProcessEnv,
	onLine: (line: string) => void = () => {},
): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		let pending = "";
		const take = (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output += text;
			pending += text;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) onLine(line);
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_DEADLINE_MS);
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, output });
		});
	});
}

async function main(): Promise<void> {
	const home = mkdtempSync(join(tmpdir(), "rowcat-mcp-pairing-"));
	try {
		say("");
		say(`Pairing the installed RowCat MCP with ${BASE}`);
		say("");
		say("① The trusted device: account and keyring");
		const account = await createAccount();
		const client = createRowCatClient({
			baseUrl: BASE,
			headers: { Cookie: account.cookie },
		});
		const dek = new Uint8Array(randomBytes(32));
		const created = await createKeyring(account.id, dek, nobleAead);
		await client.sync.setupKeyring({
			keyring: created.keyring,
			authKey: created.authKey,
		});
		check(true, "created an account and set up the sync keyring", account.id);

		const env: NodeJS.ProcessEnv = {
			...process.env,
			HOME: home,
			ROWCAT_API_BASE_URL: BASE,
			ROWCAT_SESSION_COOKIE: account.cookie,
		};
		Reflect.deleteProperty(env, "ROWCAT_SYNC_KEY");

		say("");
		say(`② The new device: ${BIN} pair`);
		let code: string | null = null;
		let approved: Promise<void> | null = null;
		let seen = false;
		const codeTimer = setTimeout(() => {
			if (code === null) check(false, "a pairing code appeared in time");
		}, CODE_DEADLINE_MS);
		const paired = await run(["pair"], env, (line) => {
			if (seen && code === null && line.trim() !== "") {
				code = line.trim();
				/** Approve exactly as the web's controller does: read the session, seal, hand over. */
				approved = (async () => {
					const owner = account.id;
					const normalizedCode = normalizePairingCode(code as string);
					const codeHash = pairingCodeHash(owner, normalizedCode);
					const session = await client.sync.readPairing({ codeHash });
					const { payload } = await sealPairingDek({
						owner,
						normalizedCode,
						newPublicKey: session.newPublicKey,
						dek,
						aead: nobleAead,
					});
					await client.sync.approvePairing({ codeHash, payload });
				})();
			}
			if (line.trim() === "Pairing code:") seen = true;
		});
		clearTimeout(codeTimer);
		check(code !== null, "the installed copy printed a pairing code", code ?? undefined);
		if (approved !== null) {
			try {
				await approved;
				check(true, "the trusted device approved the code");
			} catch (error) {
				check(false, "the trusted device approved the code", String(error));
			}
		}
		check(
			paired.code === 0,
			"pair exits 0 after approval",
			paired.code === 0 ? undefined : paired.output.trim().split("\n").at(-1),
		);

		say("");
		say("③ What the installed copy remembered");
		let stored: { dek?: string; memberId?: string } = {};
		try {
			stored = JSON.parse(
				readFileSync(join(home, ".rowcat", "mcp.json"), "utf8"),
			) as typeof stored;
		} catch {
			check(false, "the config file exists under the temp HOME");
		}
		check(
			stored.dek === Buffer.from(dek).toString("base64"),
			"the stored key is the key the trusted device sealed",
		);
		check(
			stored.memberId === account.id,
			"the stored key is recorded under this account",
		);

		const doctor = await run(["doctor"], env);
		const keyLine = doctor.output
			.split("\n")
			.find((line) => line.trimStart().startsWith("Sync key"));
		check(
			keyLine !== undefined && keyLine.includes("✓"),
			"doctor reports the sync key as ready",
			keyLine?.trim(),
		);

		const again = await run(["pair"], env);
		check(
			again.code === 0 && /already here/.test(again.output),
			"a second pair recognises the key and does not start a new relay",
		);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}

	say("");
	if (failures.length > 0) {
		say(`✗ ${failures.length} failed: ${failures.join(", ")}`);
		process.exit(1);
	}
	say("✓ The installed copy pairs with this instance.");
}

main().catch((error: unknown) => {
	say(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
