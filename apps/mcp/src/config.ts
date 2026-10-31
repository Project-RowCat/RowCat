import { randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * This device's config; two secrets live here: `~/.rowcat/mcp.json` (0600) holds the session cookie
 * and the envelope key (DEK).
 *
 * It is a file because the process restarts for every agent connection (stdio MCP server lifetime);
 * memory-only would make the person re-enter both each time and the tool would go unused. Same
 * judgement and same weight as a browser remembering a trusted device's key in IndexedDB.
 *
 * What this does not promise: anyone who can read the file can open this account's authoring data.
 * 0600 only stops other users on the same machine. An OS keychain would add a layer but means a
 * native dependency, which this slice does not take; saying so in docs and here is the honest
 * option.
 *
 * Environment variables win: CI and containers should inject secrets that way. They must not be
 * written into the MCP client's json config, which usually gets committed.
 */

const DIR = join(homedir(), ".rowcat");
const FILE = join(DIR, "mcp.json");

export interface McpConfig {
	/**
	 * Includes the `/v2` prefix (e.g. `https://api.example.com/v2`); the SDK does not add it.
	 *
	 * There is no default. When empty, `setup` and `login` ask and other commands say what to do and
	 * exit (`ROWCAT_API_BASE_URL` also supplies it). A local API was the default for a while, but
	 * `localhost:3001` is almost always wrong for an npm install, and defaulting to a production
	 * server would send credentials to that one operator, the same reasoning as `@rowcat/sdk` having
	 * no default origin.
	 */
	readonly apiBaseUrl?: string;
	/** Better Auth session cookie as one `name=value` line; absent means signed out. */
	readonly cookie?: string;
	/** Envelope key (base64); absent means locked and drafts cannot be opened. */
	readonly dek?: string;
	/**
	 * The account that opened this `dek`: the secret's owner, not a diagnostic note.
	 *
	 * This field used to mean "last seen member id", so login swapped the cookie and member but left
	 * `dek`, and after unlock-as-A then login-as-B B's cookie and A's envelope key sat in one file. A
	 * DEK belongs to the account that opened its keyring; logging in as someone else must not make it
	 * look like the new account's.
	 */
	readonly memberId?: string;
	/**
	 * Whether these values came from the environment. Never persisted (`writeConfig` picks fields).
	 *
	 * Needed for owner decisions: the file's `memberId` describes the file's `dek`, so reading it as
	 * the owner of an environment-supplied key would be an unfounded assertion. Only when the
	 * environment supplied cookie and key together are they treated as one account's pair, which is
	 * what the operator actually declared.
	 */
	readonly fromEnvironment?: {
		readonly cookie: boolean;
		readonly dek: boolean;
	};
}

const fromEnvironment = (): Partial<McpConfig> => ({
	...(process.env.ROWCAT_API_BASE_URL === undefined
		? {}
		: { apiBaseUrl: process.env.ROWCAT_API_BASE_URL }),
	...(process.env.ROWCAT_SESSION_COOKIE === undefined
		? {}
		: { cookie: process.env.ROWCAT_SESSION_COOKIE }),
	...(process.env.ROWCAT_SYNC_KEY === undefined
		? {}
		: { dek: process.env.ROWCAT_SYNC_KEY }),
});

export const configPath = (): string => FILE;

/** The file alone, before the environment is laid over it. */
function readStoredFile(): Partial<McpConfig> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(FILE, "utf8"));
		if (typeof parsed === "object" && parsed !== null)
			return parsed as Partial<McpConfig>;
	} catch {
		// Missing or unreadable means empty config, the normal first-run path.
	}
	return {};
}

export function readConfig(): McpConfig {
	const stored = readStoredFile();
	const environment = fromEnvironment();
	const merged = { ...stored, ...environment };
	return {
		...(merged.apiBaseUrl === undefined || merged.apiBaseUrl.trim() === ""
			? {}
			: { apiBaseUrl: merged.apiBaseUrl.trim() }),
		...(merged.cookie === undefined ? {} : { cookie: merged.cookie }),
		...(merged.dek === undefined ? {} : { dek: merged.dek }),
		...(merged.memberId === undefined ? {} : { memberId: merged.memberId }),
		fromEnvironment: {
			cookie: environment.cookie !== undefined,
			dek: environment.dek !== undefined,
		},
	};
}

/**
 * Config with environment-supplied values removed, leaving only what may be written to the file.
 * Without it, the natural `writeConfig({ ...readConfig(), … })` copies environment-supplied cookie
 * and envelope key to disk, silently breaking the CI and container expectation of not persisting.
 */
export const storedOnly = (config: McpConfig): McpConfig => ({
	...(config.apiBaseUrl === undefined ? {} : { apiBaseUrl: config.apiBaseUrl }),
	...(config.cookie === undefined || config.fromEnvironment?.cookie === true
		? {}
		: { cookie: config.cookie }),
	...(config.dek === undefined || config.fromEnvironment?.dek === true
		? {}
		: { dek: config.dek }),
	...(config.memberId === undefined ? {} : { memberId: config.memberId }),
});

/**
 * Writes a fresh 0600 file beside the config and renames it over the old one. Persisted fields are
 * enumerated because serializing the object whole would leave the derived `fromEnvironment` in the
 * file for the next run to read as fact.
 *
 * Writing in place was not enough: `mode` applies only when the file is created, so a config that
 * already existed as 0644 (copied, restored from a backup, made under another umask) took the
 * cookie and the sync key before the `chmod` after it ran. A new file made with `wx` is the one
 * write whose mode holds from its first byte, and the rename also means a crash never leaves half
 * a config. The directory is tightened too, since `mkdir` leaves an existing one as it was.
 */
export function writeConfig(config: McpConfig): void {
	mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
	chmodSync(dirname(FILE), 0o700);
	const stored = {
		...(config.apiBaseUrl === undefined
			? {}
			: { apiBaseUrl: config.apiBaseUrl }),
		...(config.cookie === undefined ? {} : { cookie: config.cookie }),
		...(config.dek === undefined ? {} : { dek: config.dek }),
		...(config.memberId === undefined ? {} : { memberId: config.memberId }),
	};
	/**
	 * A random name, not the pid: a container restarts with the same pid, and a temp file a crash
	 * left behind would make `wx` refuse every write until someone deleted it.
	 */
	const next = `${FILE}.${randomUUID()}.tmp`;
	try {
		writeFileSync(next, `${JSON.stringify(stored, null, "\t")}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(next, FILE);
	} catch (error) {
		rmSync(next, { force: true });
		throw error;
	}
}

/**
 * Drops `dek` from the file, but only if the file still holds exactly that key for `owner` when it
 * is read again; returns whether it did. Between the question that found the key stale and this
 * write, another terminal may have run `pair` — the very step the stale-key sentence asks for — and
 * that new key must survive. A key supplied by `ROWCAT_SYNC_KEY` is not the file's and is left alone.
 *
 * It reads and rewrites the file itself, not the merged config: through `readConfig` an
 * environment cookie would replace the file's own (and `storedOnly` would then drop it), and an
 * environment API address would be written into the file to outlive the variable.
 */
export function forgetStoredDek(owner: string, dek: string): boolean {
	if (process.env.ROWCAT_SYNC_KEY !== undefined) return false;
	const { dek: stored, ...rest } = readStoredFile();
	if (stored !== dek || rest.memberId !== owner) return false;
	writeConfig(rest);
	return true;
}

/**
 * Returns the typed API address with trailing slashes trimmed, or `null` if unacceptable. Only
 * `http` and `https` pass. The path is left as written (including `/v2`); adding the prefix here
 * would give this tool a second copy of the contract's path rules.
 */
export function normalizeApiBaseUrl(input: string): string | null {
	const value = input.trim();
	if (value === "") return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return value.replace(/\/+$/, "");
	} catch {
		return null;
	}
}

export const isSignedIn = (config: McpConfig): boolean =>
	config.cookie !== undefined && config.cookie.length > 0;

/**
 * Whether an envelope key is in the file. Whether it may be used is a different question
 * (`dekForViewer`); folding them into one predicate would read an account-switched file as
 * unlocked.
 */
export const isUnlocked = (config: McpConfig): boolean =>
	config.dek !== undefined && config.dek.length > 0;

/**
 * Whether this session's viewer owns the envelope key. The only door `serve` and `doctor` pass.
 *
 * - `ok`: the key was opened by this account
 * - `locked`: no key; run unlock
 * - `owner_unknown`: a key with no recorded owner (old config, environment); fails closed
 * - `owner_mismatch`: opened by another account
 *
 * Not passing `owner_unknown` is the point: assuming an owner-less key is the current account's is
 * exactly the account-switch accident and costs someone else's drafts, while migrating costs one
 * more `unlock`. Identity is never guessed from cookie contents; the server-confirmed `viewer.id`
 * is the only basis.
 */
export type DekOwnership =
	| { readonly ok: true; readonly dek: string }
	| {
			readonly ok: false;
			readonly reason: "locked" | "owner_unknown" | "owner_mismatch";
	  };

export function dekForViewer(
	config: McpConfig,
	viewerId: string,
): DekOwnership {
	if (config.dek === undefined || config.dek.length === 0)
		return { ok: false, reason: "locked" };
	if (config.fromEnvironment?.dek === true)
		// The owner of an environment key is not the file's memo. Only when the same environment also
		// supplied the cookie is there an operator declaration that the two pair up.
		return config.fromEnvironment.cookie
			? { ok: true, dek: config.dek }
			: { ok: false, reason: "owner_unknown" };
	if (config.memberId === undefined || config.memberId.length === 0)
		return { ok: false, reason: "owner_unknown" };
	if (config.memberId !== viewerId)
		return { ok: false, reason: "owner_mismatch" };
	return { ok: true, dek: config.dek };
}

export interface LoginTransition {
	/** The config to persist after login. */
	readonly config: McpConfig;
	/** Whether the previous account's envelope key was dropped; the guidance sentence branches on it. */
	readonly discardedDek: boolean;
}

/**
 * Moves the config to the viewer the login confirmed, dropping the envelope key if the account
 * differs. The key survives only when logging in again as the same account (session expiry),
 * decided by the recorded owner matching the server-confirmed `viewer.id`. The leftover key is not
 * tried against the new account's keyring: it can never succeed, and a failure would only read as
 * "wrong code". Pure so the rule is testable without file I/O.
 */
export function loginTransition(
	current: McpConfig,
	cookie: string,
	viewerId: string,
): LoginTransition {
	// Only keys that were in the file carry over; environment values never reach disk.
	const stored = storedOnly(current);
	const sameAccount =
		stored.memberId !== undefined &&
		stored.memberId.length > 0 &&
		stored.memberId === viewerId;
	const keep = sameAccount && isUnlocked(stored);
	return {
		config: {
			...(stored.apiBaseUrl === undefined
				? {}
				: { apiBaseUrl: stored.apiBaseUrl }),
			cookie,
			memberId: viewerId,
			...(keep && stored.dek !== undefined ? { dek: stored.dek } : {}),
		},
		discardedDek: isUnlocked(stored) && !keep,
	};
}
