import { randomUUID } from "node:crypto";
import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeFilePatch,
	DraftRuntimeProject,
	StoryDraft,
} from "@rowcat/authoring";
import type {
	RuntimeAuthoringPort,
	RuntimeMcpDraftView,
} from "@rowcat/runtime-mcp";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "@rowcat/runtime-mcp";
import type { SyncRecordShape } from "@rowcat/sync";
import type { RuntimeMcpRecordStore } from "./records.ts";

/**
 * The authoring port over synced records: the store MCP sees. Tools apply `@rowcat/runtime-mcp`'s
 * rules (paths, duplicates, caps); this adapter creates records, gets revisions issued and uploads
 * immediately, through the `@rowcat/sync` engine, envelope crypto and server.
 *
 * Writes wait for the push. This diverges from the web because of the store: a browser draft in
 * IndexedDB is durable on its own, but this device's records live in memory and an edit that was
 * not uploaded vanishes when the process ends. So write tools return success only after the push
 * and report `sync_failed` otherwise; folding that into success would let the agent believe it was
 * saved and move on.
 *
 * Read-modify-write must not overwrite someone else's edit. Reads see memory, whose freshness is
 * the last pull, and another device editing the same file after the agent read it really happens.
 * An explicit write therefore goes through three steps:
 *
 * - refresh: pull only, without first uploading pending local edits
 * - decision: the rules layer compares `expectedHash` with the current value
 * - flush: push without convergence, so a server refusal surfaces as-is
 *
 * The last step is where this diverges from routine sync. Convergence (pull, merge, retry) is the
 * protocol's right default but here would silently overwrite a value changed after the read. On
 * conflict this adapter undoes the write it just made, pulls the latest and answers
 * `file_conflict`; without the undo that edit would stay `dirty` and ride the next operation's
 * push.
 *
 * It never edits drafts. The only writes are runtime files (create, update, delete); there is no
 * operation for a draft's body, lore, start scenes or publication, matching the product rule that
 * those four lock while the runtime is on. MCP must not be a door around that lock.
 */

const DRAFT = "authoring.draft";
const PROJECT = "authoring.runtimeProject";
const FILE = "authoring.runtimeFile";
const ASSET = "authoring.runtimeAsset";

/** Same shape as the repository's id convention: a hyphenless UUIDv4. */
const newId = (): string => randomUUID().replace(/-/g, "");

export interface DeviceAuthoringOptions {
	readonly store: RuntimeMcpRecordStore;
	readonly nowIso: () => string;
	/**
	 * Pulls the server's latest; pull only. Full sync (`run`) is wrong here because it pushes:
	 * uploading pending local edits before the decision would make the checked value already the
	 * server's and void what `expectedHash` promises.
	 */
	readonly refresh: () => Promise<void>;
	/**
	 * Uploads local writes without converging. `"conflict"` means the server's version is newer and
	 * nothing was applied; transport, auth and crypto failures throw, since the agent's next step
	 * differs for each.
	 */
	readonly flush: () => Promise<"ok" | "conflict">;
}

export function createDeviceAuthoringPort(
	options: DeviceAuthoringOptions,
): RuntimeAuthoringPort {
	const { store, nowIso } = options;

	/**
	 * Finalizes one write: success if uploaded, otherwise undone and reported as a failure. `before`
	 * is the row just before the write (`null` if absent). Pulling again after the undo is what lets
	 * the next `read_file` return the other device's value; without it the agent has nothing to merge.
	 */
	const commit = async (
		type: string,
		id: string,
		before: SyncRecordShape | null,
	): Promise<void> => {
		let outcome: "ok" | "conflict";
		try {
			outcome = await options.flush();
		} catch (error) {
			store.restore(type, id, before);
			// Named failures (e.g. session expiry) pass through; their branch is already decided.
			if (error instanceof RuntimeMcpError) throw error;
			// The original message is not carried: transport errors mix in addresses, headers and response
			// bodies. The agent needs only "not uploaded" and what it can do.
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.syncFailed,
				"Couldn't upload the edit to RowCat. Check the connection and call the same operation again.",
			);
		}
		if (outcome === "ok") return;
		store.restore(type, id, before);
		await options.refresh().catch(() => undefined);
		// Path and hash are unknown here; the rules layer re-reads the latest and attaches both. A store
		// adapter with file vocabulary would duplicate that rule.
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.fileConflict,
			"This file changed on another device first. Read it again and merge.",
		);
	};

	const filesOf = (draftId: string): DraftRuntimeFile[] =>
		store
			.list<DraftRuntimeFile>(FILE)
			.filter((file) => file.draftId === draftId);

	return {
		refresh: options.refresh,

		listDrafts: async (): Promise<readonly RuntimeMcpDraftView[]> =>
			store.list<StoryDraft>(DRAFT).map((draft) => ({
				id: draft.id,
				title: draft.title,
				updatedAt: draft.updatedAt,
				deletedAt: draft.deletedAt,
			})),

		getDraft: async (id): Promise<RuntimeMcpDraftView | null> => {
			const draft = store.get<StoryDraft>(DRAFT, id);
			return draft === null
				? null
				: {
						id: draft.id,
						title: draft.title,
						updatedAt: draft.updatedAt,
						deletedAt: draft.deletedAt,
					};
		},

		getRuntimeProject: async (draftId) =>
			store
				.list<DraftRuntimeProject>(PROJECT)
				.find((project) => project.draftId === draftId) ?? null,

		listRuntimeFiles: async (draftId) => filesOf(draftId),

		createRuntimeFile: async (draftId, input) => {
			const project = store
				.list<DraftRuntimeProject>(PROJECT)
				.find((entry) => entry.draftId === draftId);
			if (project === undefined) return null;
			// The pure rules already checked duplicates; checking again here is the last authority on races.
			if (filesOf(draftId).some((file) => file.path === input.path))
				return null;
			const stamp = nowIso();
			const created: DraftRuntimeFile = {
				id: newId(),
				draftId,
				path: input.path,
				content: input.content ?? "",
				createdAt: stamp,
				updatedAt: stamp,
				deletedAt: null,
				dirty: 1,
				serverVersion: 0,
				// Issued by the store; `put` overwrites this value.
				rev: { t: 0, c: 0, d: "" },
			};
			store.put(FILE, created);
			await commit(FILE, created.id, null);
			return store.get<DraftRuntimeFile>(FILE, created.id);
		},

		updateRuntimeFile: async (id, patch: DraftRuntimeFilePatch) => {
			const file = store.get<DraftRuntimeFile>(FILE, id);
			if (file === null) return;
			const before = store.snapshot(FILE, id);
			store.put(FILE, {
				...file,
				...(patch.path === undefined ? {} : { path: patch.path }),
				...(patch.content === undefined ? {} : { content: patch.content }),
				updatedAt: nowIso(),
			});
			await commit(FILE, id, before);
		},

		deleteRuntimeFile: async (id) => {
			const before = store.snapshot(FILE, id);
			store.remove(FILE, id);
			await commit(FILE, id, before);
		},

		listRuntimeAssets: async (draftId) =>
			store
				.list<DraftRuntimeAsset>(ASSET)
				.filter((asset) => asset.draftId === draftId),
	};
}
