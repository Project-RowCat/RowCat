import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeFilePatch,
	DraftRuntimeProject,
} from "@rowcat/authoring";
import { runtimeProjectIdFor } from "@rowcat/authoring";
import type { RuntimeAuthoringPort, RuntimeMcpDraftView } from "../ports.ts";

/**
 * Test authoring store with only the product store's semantics. It is neither Dexie nor SQLite. It
 * imitates only the port's contract: path uniqueness, deleted files absent from listings, and
 * operations on a missing draft returning null. Merging, revisions, and dirty state are absent on
 * purpose. Those belong to sync, which this layer never touches.
 *
 * Time is passed in for determinism. Calling Date.now() would give each run a different updatedAt,
 * and since that value appears in responses, snapshot comparisons would be unstable.
 */

export interface MemoryAuthoringSeed {
	readonly draftId: string;
	readonly title?: string;
	readonly enabled?: boolean;
	readonly entry?: string;
	readonly files?: readonly { path: string; content: string }[];
	readonly assets?: readonly { path: string; assetId: string }[];
}

const STAMP = "2026-01-01T00:00:00.000Z";

export class MemoryAuthoringStore implements RuntimeAuthoringPort {
	private readonly drafts = new Map<string, RuntimeMcpDraftView>();
	private readonly projects = new Map<string, DraftRuntimeProject>();
	private readonly files = new Map<string, DraftRuntimeFile>();
	private readonly assets = new Map<string, DraftRuntimeAsset>();
	private counter = 0;
	/** Incremented on every write, so tests can count whether writes actually reached the store. */
	writes = 0;

	constructor(seeds: readonly MemoryAuthoringSeed[] = []) {
		for (const seed of seeds) this.seed(seed);
	}

	private id(prefix: string): string {
		this.counter += 1;
		return `${prefix}-${this.counter}`;
	}

	seed(seed: MemoryAuthoringSeed): void {
		this.drafts.set(seed.draftId, {
			id: seed.draftId,
			title: seed.title ?? "Test draft",
			updatedAt: STAMP,
			deletedAt: null,
		});
		if (seed.enabled !== false)
			this.projects.set(seed.draftId, {
				id: runtimeProjectIdFor(seed.draftId),
				draftId: seed.draftId,
				enabled: true,
				entry: seed.entry ?? "src/main.tsx",
				createdAt: STAMP,
				updatedAt: STAMP,
				deletedAt: null,
				dirty: 1,
				serverVersion: 0,
				rev: { t: 0, c: 0, d: "test" },
			});
		for (const file of seed.files ?? []) {
			const id = this.id("file");
			this.files.set(id, {
				id,
				draftId: seed.draftId,
				path: file.path,
				content: file.content,
				createdAt: STAMP,
				updatedAt: STAMP,
				deletedAt: null,
				dirty: 1,
				serverVersion: 0,
				rev: { t: 0, c: 0, d: "test" },
			});
		}
		for (const asset of seed.assets ?? []) {
			const id = this.id("asset");
			this.assets.set(id, {
				id,
				draftId: seed.draftId,
				path: asset.path,
				assetId: asset.assetId,
				/** This layer reads only an asset's logical name, so one image kind is enough. */
				kind: "image",
				mime: "image/webp",
				width: 512,
				height: 512,
				durationMs: null,
				createdAt: STAMP,
				updatedAt: STAMP,
				deletedAt: null,
				dirty: 1,
				serverVersion: 0,
				rev: { t: 0, c: 0, d: "test" },
			});
		}
	}

	/**
	 * Simulates a file changed elsewhere after it was read. The optimistic-concurrency tests use it.
	 */
	overwrite(draftId: string, path: string, content: string): void {
		for (const file of this.files.values())
			if (
				file.draftId === draftId &&
				file.path === path &&
				file.deletedAt === null
			)
				this.files.set(file.id, { ...file, content });
	}

	async listDrafts(): Promise<readonly RuntimeMcpDraftView[]> {
		return [...this.drafts.values()];
	}

	async getDraft(id: string): Promise<RuntimeMcpDraftView | null> {
		return this.drafts.get(id) ?? null;
	}

	async getRuntimeProject(
		draftId: string,
	): Promise<DraftRuntimeProject | null> {
		return this.projects.get(draftId) ?? null;
	}

	async listRuntimeFiles(
		draftId: string,
	): Promise<readonly DraftRuntimeFile[]> {
		return [...this.files.values()].filter(
			(file) => file.draftId === draftId && file.deletedAt === null,
		);
	}

	async createRuntimeFile(
		draftId: string,
		input: { path: string; content?: string },
	): Promise<DraftRuntimeFile | null> {
		if (!this.projects.has(draftId)) return null;
		const clash = [...this.files.values()].some(
			(file) =>
				file.draftId === draftId &&
				file.deletedAt === null &&
				file.path === input.path,
		);
		if (clash) return null;
		this.writes += 1;
		const id = this.id("file");
		const created: DraftRuntimeFile = {
			id,
			draftId,
			path: input.path,
			content: input.content ?? "",
			createdAt: STAMP,
			updatedAt: STAMP,
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
			rev: { t: 0, c: 0, d: "test" },
		};
		this.files.set(id, created);
		return created;
	}

	async updateRuntimeFile(
		id: string,
		patch: DraftRuntimeFilePatch,
	): Promise<void> {
		const file = this.files.get(id);
		if (file === undefined || file.deletedAt !== null) return;
		this.writes += 1;
		this.files.set(id, {
			...file,
			...(patch.path === undefined ? {} : { path: patch.path }),
			...(patch.content === undefined ? {} : { content: patch.content }),
		});
	}

	async deleteRuntimeFile(id: string): Promise<void> {
		const file = this.files.get(id);
		if (file === undefined) return;
		this.writes += 1;
		this.files.set(id, { ...file, deletedAt: STAMP });
	}

	async listRuntimeAssets(
		draftId: string,
	): Promise<readonly DraftRuntimeAsset[]> {
		return [...this.assets.values()].filter(
			(asset) => asset.draftId === draftId && asset.deletedAt === null,
		);
	}
}
