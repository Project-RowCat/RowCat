import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { b64ToBytes, bytesToB64 } from "@rowcat/sync";
import { fetchViewer, RowCatAuthError, signIn, type Viewer } from "./auth.ts";
import {
	configPath,
	type DekOwnership,
	dekForViewer,
	forgetStoredDek,
	isSignedIn,
	isUnlocked,
	loginTransition,
	type McpConfig,
	normalizeApiBaseUrl,
	readConfig,
	storedOnly,
	writeConfig,
} from "./config.ts";
import {
	openDevice,
	rowcatClient,
	syncTransport,
	unlockDek,
	verifyStoredDek,
} from "./device/device.ts";
import { pairDevice } from "./pairing.ts";
import { readSecret } from "./secret-input.ts";
import { runSelfCheck } from "./selfcheck.ts";
import { createRuntimeMcpServer } from "./server.ts";
import { planSetup } from "./setup.ts";

/**
 * `rowcat-mcp`: the MCP server for the RowCat creator runtime.
 *
 * ```text
 * rowcat-mcp setup     first run: log in, get approved from an existing device, connect
 * rowcat-mcp login     get a session again (the password is not stored)
 * rowcat-mcp pair      receive the sync key from an already-connected RowCat device
 * rowcat-mcp unlock    when no trusted device exists: open with the recovery code
 * rowcat-mcp doctor    what works and what does not right now
 * rowcat-mcp serve     stdio MCP server, which agents launch
 * ```
 *
 * - Why it runs locally: RowCat drafts belong to the device and the server holds only ciphertext,
 *   so this tool must become one of the account's devices, which needs the envelope key, which a
 *   person opens. A plaintext authoring API on the server would remove the need for this
 *   executable, but what would disappear is the product's zero-knowledge claim.
 * - Pairing is the normal path, `unlock` the fallback for when no trusted device exists. The
 *   recovery code is not removed, but it is a procedure that needs a piece of paper, and making it
 *   the first screen was what made the tool hard to use. A key received by pairing is the same
 *   value as one opened with the recovery code, so nothing after it knows which route it came by.
 * - stdout belongs to the protocol: any `console.log` during `serve` mixes into the JSON-RPC
 *   stream and drops the connection, so all human-facing output goes to stderr. `setup` and `pair`
 *   follow the same rule; one exception there would invite the same exception in `serve`.
 */

/**
 * Published version; must equal `package.json`'s `version`. Reading `package.json` from the bundle
 * would be automatic, but that line is where the bundler rewrites paths and a failure would show up
 * only in the installed package. `version.test.ts` guards the pairing instead.
 */
const VERSION = "0.1.0-alpha.3";

/**
 * All human-facing output goes to stderr; stdout belongs to JSON-RPC.
 *
 * An open erasable line (`status`) is cleared first, otherwise the next sentence is printed over
 * the remaining-time display and the residue stays in the middle of a failure message.
 */
let statusOpen = false;

const out = (line: string): void => {
	if (statusOpen) {
		process.stderr.write("\r\u001b[2K");
		statusOpen = false;
	}
	process.stderr.write(`${line}\n`);
};

/**
 * An updating single line, to avoid printing a new line per poll.
 *
 * Does nothing when not a TTY: in pipes and CI logs cursor-control characters are not erased but
 * accumulate.
 */
const status = (line: string): void => {
	if (process.stderr.isTTY !== true) return;
	process.stderr.write(`\r\u001b[2K${line}`);
	statusOpen = true;
};

const ask = async (question: string): Promise<string> => {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		return (await rl.question(question)).trim();
	} finally {
		rl.close();
	}
};

/**
 * Password input that leaves no characters on screen.
 *
 * Turning echo off is all it does; terminal history and the process list are out of this process's
 * reach, which is why the password is not taken as an argument (`--password` would land in shell
 * history).
 */
async function askSecret(question: string): Promise<string> {
	process.stderr.write(question);
	const outcome = await readSecret(process.stdin);
	process.stderr.write("\n");
	if (outcome.kind === "interrupted") process.exit(130);
	return outcome.value;
}

/**
 * Whether the API address is set; if not, says what to do and returns `null`.
 *
 * The tool has no default API address (`apiBaseUrl` in `config.ts`). `setup` and `login`, which
 * talk to a person, ask on the spot; the other commands do not, because `serve`'s stdio belongs to
 * the MCP client and a prompt there makes the connection look like an unresponsive server.
 */
const API_MISSING =
	"No RowCat API address: set it in rowcat-mcp setup or provide ROWCAT_API_BASE_URL (through …/v2).";

function apiBaseUrlOf(config: McpConfig): string | null {
	if (config.apiBaseUrl !== undefined) return config.apiBaseUrl;
	out(API_MISSING);
	return null;
}

/** Asks the person for the API address; an unacceptable value returns `null` without asking again. */
async function askApiBaseUrl(): Promise<string | null> {
	const answer = await ask(
		"RowCat API address (through …/v2, e.g. https://api.example.com/v2): ",
	);
	const normalized = normalizeApiBaseUrl(answer);
	if (normalized === null) out("Enter an http(s) address.");
	return normalized;
}

/**
 * One login; returns the confirmed viewer on success.
 *
 * `login` and `setup` go through the same function. Split, one of them would miss the
 * account-switch handling, and that omission shows up not as an error but as someone else's drafts
 * opening.
 */
async function signInInteractive(): Promise<Viewer | null> {
	const current = readConfig();
	const apiBaseUrl = current.apiBaseUrl ?? (await askApiBaseUrl());
	if (apiBaseUrl === null) return null;
	/** The address just asked for is also kept when login succeeds (`loginTransition` carries it over). */
	const config: McpConfig = { ...current, apiBaseUrl };
	out(`RowCat API: ${apiBaseUrl}`);
	const email = await ask("Email: ");
	const password = await askSecret("Password: ");
	try {
		const { cookie } = await signIn(apiBaseUrl, email, password);
		const viewer = await fetchViewer(apiBaseUrl, cookie);
		if (viewer === null) {
			out("Signed in, but couldn't read the member information.");
			return null;
		}
		/**
		 * Logging in swaps the account. On entering a different account the previous account's envelope
		 * key is dropped here: while it stays in the file, the next `serve` could open someone else's
		 * drafts with the new account's cookie.
		 */
		const transition = loginTransition(config, cookie, viewer.id);
		writeConfig(transition.config);
		out(`✓ Signed in as ${viewer.nickname || viewer.id}.`);
		if (transition.discardedDek)
			out("  Removed the sync key of the other account opened earlier.");
		return viewer;
	} catch (error) {
		out(
			error instanceof RowCatAuthError
				? error.message
				: "The sign-in request failed. Check the API address and the connection.",
		);
		return null;
	}
}

async function login(): Promise<number> {
	const viewer = await signInInteractive();
	if (viewer === null) return 1;
	out(`Config file: ${configPath()}`);
	/** The guidance follows the written value, so a key just discarded is not reported as present. */
	out(
		dekForViewer(readConfig(), viewer.id).ok
			? "The sync key is there too: start with rowcat-mcp serve."
			: "Next: rowcat-mcp pair (approve it from an already connected RowCat device)",
	);
	return 0;
}

/** Who the cookie is now; `null` if not logged in or the session is dead. */
async function currentViewer(): Promise<Viewer | null> {
	const config = readConfig();
	if (!isSignedIn(config) || config.cookie === undefined) return null;
	/** Without an address, folds to "not logged in" instead of asking; `setup` asks in its next step. */
	if (config.apiBaseUrl === undefined) return null;
	return fetchViewer(config.apiBaseUrl, config.cookie);
}

/**
 * Requires a confirmed session; if absent, says the next step and ends.
 *
 * `unlock`, `pair` and `setup` go through the same door. If each wrote its own, one would trust the
 * config file's `memberId` as the owner without asking `/me`, and that value is not an identity the
 * server confirmed.
 */
async function requireSession(): Promise<{
	readonly apiBaseUrl: string;
	readonly cookie: string;
	readonly viewer: Viewer;
} | null> {
	const config = readConfig();
	if (!isSignedIn(config) || config.cookie === undefined) {
		out("Run rowcat-mcp setup first.");
		return null;
	}
	const apiBaseUrl = apiBaseUrlOf(config);
	if (apiBaseUrl === null) return null;
	const viewer = await fetchViewer(apiBaseUrl, config.cookie);
	if (viewer === null) {
		out("The session expired. Run rowcat-mcp login again.");
		return null;
	}
	return { apiBaseUrl, cookie: config.cookie, viewer };
}

/**
 * Saves the opened key to the file; pairing and the recovery code go through the same place.
 *
 * Filtering through `storedOnly` is the point: spreading `config` would copy a cookie supplied by
 * environment variable onto disk, and the reason to supply it that way is to not leave it.
 *
 * The config is re-read right before writing: another terminal may have run `login` while the
 * procedure ran, and then the file already belongs to another account, so this key is discarded.
 */
function rememberDek(owner: string, dek: Uint8Array): boolean {
	const current = readConfig();
	if (current.memberId !== undefined && current.memberId !== owner)
		return false;
	writeConfig({
		...storedOnly(current),
		dek: bytesToB64(dek),
		memberId: owner,
	});
	return true;
}

/**
 * Asks the server whether the key in use still opens this account's sync (`verifyStoredDek`), and
 * returns the sentence to show when it does not (`null` when it does, or when the question could
 * not be answered — a failed question keeps the key and the next step reports the connection).
 *
 * Only a key that came from the file is dropped, and only if the file still holds that same key for
 * the same member when it is re-read: another terminal may have run `pair` while the question was
 * in flight, which is what this sentence tells people to do, and that new key must survive. A key
 * from `ROWCAT_SYNC_KEY` is never the file's to drop — the environment wins on the next start
 * anyway, so the person has to replace it there.
 */
async function staleKeyMessage(
	config: McpConfig,
	apiBaseUrl: string,
	cookie: string,
	owner: string,
	dek: string,
): Promise<string | null> {
	const verdict = await verifyStoredDek(
		syncTransport(rowcatClient(apiBaseUrl, cookie)),
		owner,
		dek,
	);
	if (verdict !== "invalid") return null;
	if (config.fromEnvironment?.dek === true) return STALE_ENVIRONMENT_KEY;
	/**
	 * `false` means the file no longer holds the key that was judged — another terminal paired a new
	 * one meanwhile — so the next start reads that one; telling the person to pair would only answer
	 * "already here".
	 */
	return forgetStoredDek(owner, dek) ? STALE_KEY : KEY_CHANGED_MEANWHILE;
}

const STALE_KEY =
	"The saved sync key no longer opens this account's sync (it was reset). Run rowcat-mcp pair.";
const STALE_ENVIRONMENT_KEY =
	"The key in ROWCAT_SYNC_KEY no longer opens this account's sync (it was reset). Replace the value of ROWCAT_SYNC_KEY.";
const KEY_CHANGED_MEANWHILE =
	"The saved sync key changed while it was being checked. Run the command again.";

const UNLOCK_NOTICE =
	"⚠ Anyone who can read this file can open this account's drafts. Don't use it on a shared machine.";

async function unlock(): Promise<number> {
	const session = await requireSession();
	if (session === null) return 1;
	const { apiBaseUrl, cookie, viewer } = session;
	out("Opens the sync key with the recovery code.");
	out(
		"If you already have a connected RowCat device, rowcat-mcp pair is shorter: no need to find the recovery code.",
	);
	const code = await askSecret("Recovery code: ");
	try {
		const dek = await unlockDek(
			rowcatClient(apiBaseUrl, cookie),
			viewer.id,
			code,
		);
		if (!rememberDek(viewer.id, dek)) {
			out(
				"Another account signed in during the operation. Nothing was saved on this device.",
			);
			return 1;
		}
		out(`✓ Opened the sync key. (${configPath()}, 0600)`);
		out(UNLOCK_NOTICE);
		out("");
		out("Next: rowcat-mcp serve");
		return 0;
	} catch {
		/** Does not say which way it failed: with no means to compare, a wrong code and a different account look the same. */
		out("Couldn't open the key with the recovery code. Check the code again.");
		return 1;
	}
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One pairing: receive the sync key from an already-connected device.
 *
 * Ctrl+C is intercepted. Left at the default (immediate exit), the relay keeps an open session and
 * that account's next pairing can be blocked by `pairingTooMany`. This process's private key is
 * gone anyway so nobody can open the leftover envelope, but what it created it closes.
 */
async function pair(): Promise<number> {
	const session = await requireSession();
	if (session === null) return 1;
	const { apiBaseUrl, cookie, viewer } = session;

	if (dekForViewer(readConfig(), viewer.id).ok) {
		out("✓ This account's sync key is already here.");
		out("");
		out("Next: rowcat-mcp serve");
		return 0;
	}

	let interrupts = 0;
	const onInterrupt = (): void => {
		interrupts += 1;
		/** The second one does not wait: the person's intent comes before cleanup. */
		if (interrupts >= 2) process.exit(130);
		out("");
		out("Cancelling the connection…");
	};
	process.on("SIGINT", onInterrupt);

	try {
		const outcome = await pairDevice({
			owner: viewer.id,
			transport: syncTransport(rowcatClient(apiBaseUrl, cookie)),
			out,
			status,
			now: () => Date.now(),
			sleep,
			/** Re-asks the server-confirmed identity; the config file's note is not grounds. */
			stillOwned: async () =>
				(await fetchViewer(apiBaseUrl, cookie))?.id === viewer.id,
			cancelled: () => interrupts > 0,
		});

		if (outcome.status === "cancelled") {
			out("Cancelled the connection.");
			return 1;
		}
		if (outcome.status === "expired") {
			out("");
			out("The pairing code expired.");
			out("");
			out("To start again: rowcat-mcp pair");
			return 1;
		}
		if (outcome.status === "failed") {
			out("");
			out(outcome.message);
			/** Does not suggest the recovery code to an account with no key at all; that procedure does not exist either. */
			if (outcome.reason !== "sync_disabled") {
				out("");
				out(NO_TRUSTED_DEVICE_HINT);
			}
			return 1;
		}
		if (!rememberDek(viewer.id, outcome.dek)) {
			out("");
			out(
				"Another account signed in during the operation. Nothing was saved on this device.",
			);
			return 1;
		}
		out("");
		out("✓ The device was approved");
		out("✓ Received and verified the sync key");
		out(`✓ RowCat MCP is ready to use. (${configPath()}, 0600)`);
		out("");
		out(UNLOCK_NOTICE);
		out("");
		out("Next: rowcat-mcp serve");
		return 0;
	} finally {
		process.off("SIGINT", onInterrupt);
	}
}

/** The exit for people with no trusted device; without this sentence they are stuck. */
const NO_TRUSTED_DEVICE_HINT =
	"No RowCat device to approve from? There is a way to open it with the recovery code: rowcat-mcp unlock";

/**
 * First run, from login to connection.
 *
 * Only the order lives here; the decision belongs to `planSetup`. Planning again after login is the
 * point: when re-entering the same account the key is still there and no pairing is needed.
 */
async function setup(): Promise<number> {
	out("RowCat MCP setup");
	out("");

	let viewer = await currentViewer();
	if (planSetup(readConfig(), viewer) === "login") {
		viewer = await signInInteractive();
		if (viewer === null) return 1;
	} else if (viewer !== null) {
		out(`✓ Signed in as ${viewer.nickname || viewer.id}.`);
	}
	out("");

	/**
	 * Plan again from the written value. On re-entering the same account the previously opened key is
	 * still there, and showing a code and waiting would be re-receiving what already exists.
	 */
	if (planSetup(readConfig(), viewer) === "ready") {
		out("✓ RowCat MCP is ready to use.");
		out("");
		out("Next: rowcat-mcp serve");
		return 0;
	}
	return pair();
}

/** Each reason for being locked has a different next step; folding the three into one sentence is not guidance. */
const lockedGuidance = (
	ownership: Extract<DekOwnership, { ok: false }>,
): string =>
	ownership.reason === "owner_mismatch"
		? "This config's sync key was opened by another account: get the current account's key with rowcat-mcp pair."
		: ownership.reason === "owner_unknown"
			? "Can't confirm the sync key's owner: run rowcat-mcp pair."
			: "No sync key: run rowcat-mcp pair first.";

/**
 * Whether this installation can run the runtime; asked before login.
 *
 * The order is the decision: with the account axis first, someone with a broken install sees "log
 * in" as the first line and goes off to fix an account problem that is not there. This line reports
 * an install problem, and the answer is to reinstall.
 */
async function runtimeLine(): Promise<boolean> {
	const outcome = await runSelfCheck();
	if (outcome.ok) {
		out("Runtime     ✓ compile · QuickJS preview");
		return true;
	}
	out(
		`Runtime     ✗ couldn't stand up the ${outcome.stage === "compile" ? "compiler" : "QuickJS"}: ${outcome.detail}`,
	);
	out("            The install is incomplete. Please reinstall the package.");
	return false;
}

async function doctor(): Promise<number> {
	const config = readConfig();
	const runtimeOk = await runtimeLine();
	out(`Config file ${configPath()}`);
	const apiBaseUrl = config.apiBaseUrl;
	out(
		apiBaseUrl === undefined
			? "API         ✗ no address: rowcat-mcp setup or ROWCAT_API_BASE_URL"
			: `API         ${apiBaseUrl}`,
	);
	if (apiBaseUrl === undefined) return 1;
	if (!isSignedIn(config) || config.cookie === undefined) {
		out("Sign-in     ✗ rowcat-mcp setup");
		return 1;
	}
	const viewer = await fetchViewer(apiBaseUrl, config.cookie);
	out(
		viewer === null
			? "Sign-in     ✗ the session expired: rowcat-mcp login"
			: `Sign-in     ✓ ${viewer.nickname || viewer.id}`,
	);
	if (viewer === null) {
		out(
			isUnlocked(config)
				? "Sync key    ? no session, so the owner can't be confirmed"
				: "Sync key    ✗ rowcat-mcp pair",
		);
		return 1;
	}
	const owned = dekForViewer(config, viewer.id);
	if (!owned.ok) {
		out(`Sync key    ✗ ${lockedGuidance(owned)}`);
		out(`            ${NO_TRUSTED_DEVICE_HINT}`);
		return 1;
	}
	// One line for the row, after the server has answered whether the key still opens anything.
	const stale = await staleKeyMessage(
		config,
		apiBaseUrl,
		config.cookie,
		viewer.id,
		owned.dek,
	);
	out(stale === null ? "Sync key    ✓" : `Sync key    ✗ ${stale}`);
	if (stale !== null) return 1;
	try {
		const device = await openDevice({
			baseUrl: apiBaseUrl,
			cookie: config.cookie,
			owner: viewer.id,
			dek: b64ToBytes(owned.dek),
		});
		await device.sync();
		const drafts = await device.authoring.listDrafts();
		let runtime = 0;
		for (const draft of drafts)
			if (
				(await device.authoring.getRuntimeProject(draft.id))?.enabled === true
			)
				runtime += 1;
		out(`Drafts      ✓ ${drafts.length} (runtime ${runtime})`);
		/** Even if the account is fine, the tool is unusable when the runtime does not stand. */
		return runtimeOk ? 0 : 1;
	} catch {
		out("Sync        ✗ couldn't download the records.");
		return 1;
	}
}

async function serve(): Promise<number> {
	const config = readConfig();
	if (!isSignedIn(config) || config.cookie === undefined) {
		/**
		 * `serve` does not talk to a person. Asking for an email or pairing code here would put the
		 * prompt in the middle of the MCP client's stdio and the connection would look like an
		 * unresponsive server. It says what to do and exits.
		 */
		out("RowCat MCP is not connected yet.");
		out("");
		out("Run:");
		out("  rowcat-mcp setup");
		return 1;
	}
	const apiBaseUrl = apiBaseUrlOf(config);
	if (apiBaseUrl === null) return 1;
	const viewer = await fetchViewer(apiBaseUrl, config.cookie);
	if (viewer === null) {
		out("The session expired: run rowcat-mcp login again.");
		return 1;
	}
	/**
	 * Ask who owns the envelope key only after the viewer is confirmed. A key being in the file is not
	 * enough to proceed; this order closes the path where a config whose account changed opens someone
	 * else's drafts.
	 */
	const owned = dekForViewer(config, viewer.id);
	if (!owned.ok) {
		out(lockedGuidance(owned));
		return 1;
	}
	const stale = await staleKeyMessage(
		config,
		apiBaseUrl,
		config.cookie,
		viewer.id,
		owned.dek,
	);
	if (stale !== null) {
		out(stale);
		return 1;
	}
	const device = await openDevice({
		baseUrl: apiBaseUrl,
		cookie: config.cookie,
		owner: viewer.id,
		dek: b64ToBytes(owned.dek),
	});
	/**
	 * Download once at startup: this process's records are in memory, so there are no drafts before
	 * that. If it fails, do not start: showing an empty list would make the agent believe there are no
	 * drafts.
	 */
	await device.sync();

	const { server, dispose } = createRuntimeMcpServer({
		authoring: device.authoring,
		version: VERSION,
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
	out(
		`rowcat-mcp ${VERSION}: connected to ${viewer.nickname || viewer.id}'s drafts`,
	);

	const shutdown = (): void => {
		void dispose().finally(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	/** stdio closing means the client left; do not hold the VM. */
	transport.onclose = shutdown;
	return 0;
}

/**
 * Command table; the first line a newcomer sees is `setup`.
 *
 * `login`, `pair` and `unlock` remain because each is a door for a different situation (session
 * only, key only, no trusted device). No aliases: with two names for one job, docs cannot answer
 * which to write.
 */
const COMMANDS: Readonly<Record<string, () => Promise<number>>> = {
	serve,
	setup,
	login,
	pair,
	unlock,
	doctor,
};

const USAGE: readonly string[] = [
	`rowcat-mcp ${VERSION}`,
	"",
	"The MCP server for the RowCat creator runtime: coding agents author runtime stories.",
	"",
	"Usage: rowcat-mcp <command>",
	"",
	"  setup    once at first: sign in and get approved from an existing RowCat device",
	"  serve    the stdio MCP server (default). Agents launch this",
	"",
	"  login    get a new session only",
	"  pair     get the sync key from an already connected RowCat device",
	"  unlock   when there is no device to approve: open with the recovery code",
	"  doctor   check what works and what doesn't right now",
	"",
	"First time: rowcat-mcp setup",
];

/**
 * `--help` and `--version` are flags, not commands.
 *
 * They stay out of `COMMANDS` because that table decides `serve`'s default, and putting them there
 * would create a second name `rowcat-mcp help` that docs could not choose between. They exist here
 * because they are the first door an installer knocks on, and that door used to answer with `unknown
 * command: --help` and exit 1.
 */
const FLAGS: Readonly<Record<string, () => number>> = {
	"--help": () => {
		for (const line of USAGE) out(line);
		return 0;
	},
	"-h": () => FLAGS["--help"]?.() ?? 0,
	"--version": () => {
		out(VERSION);
		return 0;
	},
	"-v": () => FLAGS["--version"]?.() ?? 0,
};

async function main(): Promise<void> {
	const name = process.argv[2] ?? "serve";
	const flag = FLAGS[name];
	if (flag !== undefined) process.exit(flag());
	const command = COMMANDS[name];
	if (command === undefined) {
		out(`Unknown command: ${name}`);
		out("");
		for (const line of USAGE) out(line);
		process.exit(1);
	}
	const code = await command();
	/**
	 * A successful `serve` must keep holding the process; calling `exit` here would kill it as soon as
	 * the transport is up. The other three exit when done.
	 */
	if (name === "serve" && code === 0) return;
	process.exit(code);
}

void main();
