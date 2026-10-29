import { randomUUID } from "node:crypto";
import { authoringSyncCodecs } from "@rowcat/authoring";
import type { RuntimeAuthoringPort } from "@rowcat/runtime-mcp";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "@rowcat/runtime-mcp";
import type { RowCatClient } from "@rowcat/sdk";
import { createRowCatClient } from "@rowcat/sdk";
import type {
	AnySyncCodec,
	SyncRequestOptions,
	SyncTransport,
} from "@rowcat/sync";
import {
	createCodecRegistry,
	createSyncEngine,
	nobleAead,
	SyncPushConflictError,
	unlockWithRecovery,
} from "@rowcat/sync";
import { createDeviceAuthoringPort } from "./authoring.ts";
import { createRecordStore } from "./records.ts";

/**
 * The headless RowCat device: the only way the MCP server reaches an account's drafts. Session
 * cookie → SDK client → `SyncTransport`; with the envelope key (DEK) and the four authoring codecs
 * → registry → engine → in-memory record store → authoring port → MCP tools.
 *
 * The server has no drafts, only ciphertext it cannot open (`docs/sync/ARCHITECTURE.md`), so the
 * only way to read them is for this process to become one of the account's devices. A plaintext
 * authoring API on the server would break the product's zero-knowledge claim for this tool's
 * convenience.
 *
 * Only authoring codecs are registered. The engine passes unknown types as `ignored` and advances
 * the cursor (forward compatibility's normal path), so this device neither holds nor uploads chat,
 * personas or player saves; that is the guarantee it cannot touch someone's conversations.
 *
 * It does not create keyrings (first registration is the product's screen), reset, approve pairing
 * (a key-holding device's job) or reissue recovery codes. It only opens an existing keyring with a
 * recovery code; receiving a key from a trusted device is `../pairing.ts`.
 */

/** The four authoring types this device knows, enough for runtime authoring. */
const DEVICE_TYPES = new Set([
	"authoring.draft",
	"authoring.runtimeProject",
	"authoring.runtimeFile",
	"authoring.runtimeAsset",
]);

const toSdkOptions = (
	options?: SyncRequestOptions,
): { signal?: AbortSignal } | undefined =>
	options?.signal ? { signal: options.signal as AbortSignal } : undefined;

/** `RowCatClient` to `SyncTransport`; same shape as the web's adapter and thin for the same reason. */
export const syncTransport = (client: RowCatClient): SyncTransport => ({
	getKeyring: (options) => client.sync.getKeyring(toSdkOptions(options)),
	setupKeyring: (input, options) =>
		client.sync.setupKeyring(input, toSdkOptions(options)),
	rewrapKeyring: (input, options) =>
		client.sync.rewrapKeyring(input, toSdkOptions(options)),
	resetKeyring: (options) => client.sync.resetKeyring(toSdkOptions(options)),
	verifyKeyring: (input, options) =>
		client.sync.verifyKeyring(input, toSdkOptions(options)),
	pull: (input, options) => client.sync.pull(input, toSdkOptions(options)),
	push: (input, options) => client.sync.push(input, toSdkOptions(options)),
	startPairing: (input, options) =>
		client.sync.startPairing(input, toSdkOptions(options)),
	readPairing: (input, options) =>
		client.sync.readPairing(input, toSdkOptions(options)),
	approvePairing: (input, options) =>
		client.sync.approvePairing(input, toSdkOptions(options)),
	cancelPairing: (input, options) =>
		client.sync.cancelPairing(input, toSdkOptions(options)),
});

/**
 * Maps a sync failure to a value the agent can branch on. Not everything folds into `sync_failed`
 * because the next step differs: a connection problem can be retried, but a dead session cannot; a
 * person must run `rowcat-mcp login`. Folded, the agent would retry forever. Other failures are
 * rethrown unnamed; the authoring adapter then replaces the message with ours, so no unnamed
 * exception text leaks.
 */
const asAuthFailure = (error: unknown): RuntimeMcpError | null => {
	const status = (error as { failure?: { status?: unknown } } | null)?.failure
		?.status;
	return status === 401 || status === 403
		? new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.notAuthorized,
				"The RowCat session is no longer valid. A person must run rowcat-mcp login again.",
			)
		: null;
};

export const rowcatClient = (baseUrl: string, cookie: string): RowCatClient =>
	createRowCatClient({ baseUrl, headers: { Cookie: cookie } });

/** Opens the keyring with a recovery code and returns the DEK. The code never reaches the server. */
export async function unlockDek(
	client: RowCatClient,
	owner: string,
	recoveryCode: string,
): Promise<Uint8Array> {
	const { keyring } = await client.sync.getKeyring();
	if (keyring === null)
		throw new Error(
			"This account has no sync key yet. Turn on sync in the web or app first.",
		);
	return unlockWithRecovery(owner, keyring, recoveryCode, nobleAead);
}

export interface DeviceOptions {
	readonly baseUrl: string;
	readonly cookie: string;
	readonly owner: string;
	readonly dek: Uint8Array;
	/** One diagnostic line: counts and reasons only, never record ids or plaintext. */
	readonly log?: (line: string) => void;
}

export interface Device {
	readonly authoring: RuntimeAuthoringPort;
	/** Bootstrap or routine sync, once at startup. */
	sync(): Promise<void>;
	/** Whether edits are still not uploaded; checked before exit. */
	hasPending(): boolean;
}

/**
 * Stands up a device given only a transport; HTTP is outside this function. The wiring is split for
 * verification: this version's promises (refresh before write, push without convergence, undo on
 * conflict) hold only when two devices share one server, which cookies and an address cannot
 * construct. If a test re-wrote `openDevice`'s internals, that copy would go stale first.
 */
export function createDevice(
	options: Omit<DeviceOptions, "baseUrl" | "cookie"> & {
		readonly transport: SyncTransport;
	},
): Device {
	const codecs = authoringSyncCodecs.filter((codec) =>
		DEVICE_TYPES.has(codec.type),
	) as readonly AnySyncCodec[];
	const registry = createCodecRegistry(codecs);
	const store = createRecordStore({
		// Fresh per process; nothing is persisted, so there is nothing to carry over.
		deviceId: randomUUID().replace(/-/g, "").slice(0, 16),
		registry,
		now: () => Date.now(),
		nowIso: () => new Date().toISOString(),
	});
	const engine = createSyncEngine({
		owner: options.owner,
		registry,
		store,
		transport: options.transport,
		aead: nobleAead,
		clock: {
			nowIso: () => new Date().toISOString(),
			nowMs: () => Date.now(),
		},
		...(options.log === undefined
			? {}
			: {
					onDiagnostic: (event) =>
						options.log?.(`sync ${event.kind} ${JSON.stringify(event)}`),
				}),
	});

	return {
		authoring: createDeviceAuthoringPort({
			store,
			nowIso: () => new Date().toISOString(),
			// Pull only, not `run()`: its push would upload local edits before the decision and make the
			// checked value already the server's.
			refresh: async () => {
				try {
					await engine.pull(options.dek);
				} catch (error) {
					throw asAuthFailure(error) ?? error;
				}
			},
			// Explicit writes push without convergence. The engine's exception branches become one word here
			// so the adapter need not know them: only conflict is a value, the rest throw.
			flush: async () => {
				try {
					await engine.push(options.dek, { conflictMode: "surface" });
					return "ok";
				} catch (error) {
					if (error instanceof SyncPushConflictError) return "conflict";
					throw asAuthFailure(error) ?? error;
				}
			},
		}),
		sync: async () => {
			await engine.run(options.dek);
		},
		hasPending: () => store.hasPending(),
	};
}

export async function openDevice(options: DeviceOptions): Promise<Device> {
	return createDevice({
		...options,
		transport: syncTransport(rowcatClient(options.baseUrl, options.cookie)),
	});
}
