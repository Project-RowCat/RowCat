import type { DraftRuntimeFile } from "@rowcat/authoring";
import {
	checkRuntimeFileContent,
	isRuntimeEnabled,
	planRuntimeFileCreate,
	planRuntimeFileRename,
	RUNTIME_PROJECT_LIMITS,
	sortRuntimeFiles,
} from "@rowcat/authoring";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "./errors.ts";
import { RUNTIME_MCP_LIMITS } from "./limits.ts";
import type { RuntimeMcpContext, RuntimeMcpDraftView } from "./ports.ts";

/**
 * Operations that read and write a draft's runtime source. No rule is written here.
 *
 * - Path shape, duplicates, file count, and content length are answered by pure functions in
 *   @rowcat/authoring (planRuntimeFileCreate, planRuntimeFileRename, checkRuntimeFileContent). The
 *   studio calls the same functions. Rewriting them here would give MCP-made and studio-made files
 *   different rules, and the mismatch would surface on another device after sync.
 * - Writes pass through the storage operations unchanged. createRuntimeFile, updateRuntimeFile,
 *   and deleteRuntimeFile are the methods the studio's autosave calls. Tables are not touched
 *   directly, so revision issuance, dirty marking, and sync signals all happen as usual.
 * - Writes are judged against the latest version. Each operation begins with refresh(). Reads see
 *   the storage's current value, and the storage decides when that value was authoritative. A
 *   headless device's memory holds its last pull. Checking expectedHash without refreshing only
 *   guards against changes inside this process, and misses the thing that matters: a change another
 *   device made after the read.
 * - If refresh fails, the operation fails. Proceeding with the existing value because the update
 *   could not be fetched would disable exactly that guard, and nothing in the response would show
 *   it.
 * - Create and overwrite are separate. write_file only modifies existing files. Merging the two
 *   would let one mistyped path silently create a new file, and the agent could not find why its
 *   edit appears absent. Writing to a missing file fails with a message that points to create_file.
 */

export interface RuntimeMcpFileView {
	readonly path: string;
	readonly bytes: number;
	/** Content fingerprint. Pass it to write_file's expectedHash unchanged. */
	readonly hash: string;
	readonly updatedAt: string;
	readonly entry: boolean;
}

export interface RuntimeMcpProjectView {
	readonly draftId: string;
	readonly title: string;
	readonly entry: string;
	/** Whether the entry file exists. Without it, compilation cannot start. */
	readonly entryExists: boolean;
	readonly files: readonly RuntimeMcpFileView[];
	readonly assets: readonly { readonly path: string }[];
	readonly limits: {
		readonly files: number;
		readonly fileCharacters: number;
	};
}

interface Resolved {
	readonly draft: RuntimeMcpDraftView;
	readonly entry: string;
	readonly files: readonly DraftRuntimeFile[];
}

/**
 * Refresh before writing. A failure produces `sync_failed`. Failures are not swallowed, for the
 * reason stated in the header. If the store does not have this capability, because it is itself the
 * authority as Dexie is in the browser, nothing happens.
 */
async function freshen(context: RuntimeMcpContext): Promise<void> {
	if (context.authoring.refresh === undefined) return;
	try {
		await context.authoring.refresh();
	} catch (error) {
		if (error instanceof RuntimeMcpError) throw error;
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.syncFailed,
			"Couldn't get RowCat's latest version, so nothing was changed. Check the connection and call again.",
		);
	}
}

const notFound = (draftId: string): RuntimeMcpError =>
	new RuntimeMcpError(
		RUNTIME_MCP_ERROR_CODE.projectNotFound,
		`Can't find draft ${draftId}.`,
	);

/**
 * Draft to project. A missing draft and another member's draft produce the same failure. The store
 * belongs to this member, so another member's draft cannot be told apart from one that does not
 * exist.
 */
export async function resolveRuntimeProject(
	context: RuntimeMcpContext,
	draftId: string,
): Promise<Resolved> {
	const draft = await context.authoring.getDraft(draftId);
	if (draft === null || draft.deletedAt != null) throw notFound(draftId);
	const project = await context.authoring.getRuntimeProject(draftId);
	if (!isRuntimeEnabled(project))
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.runtimeDisabled,
			project === null
				? "This draft doesn't have the runtime turned on. Turn it on in the studio first."
				: "This draft's runtime is off. The files remain, and you can turn it back on in the studio.",
			{ draftId },
		);
	const files = sortRuntimeFiles([
		...(await context.authoring.listRuntimeFiles(draftId)),
	]);
	return { draft, entry: project?.entry ?? "", files };
}

const fileView = (
	context: RuntimeMcpContext,
	file: DraftRuntimeFile,
	entry: string,
): RuntimeMcpFileView => ({
	path: file.path,
	bytes: [...file.content].length,
	hash: context.host.digest(file.content),
	updatedAt: file.updatedAt,
	entry: file.path === entry,
});

/**
 * Lists only drafts with the runtime enabled. Drafts with it off are omitted, since the agent has
 * nothing it can edit in them.
 */
export async function listRuntimeProjects(context: RuntimeMcpContext): Promise<{
	readonly projects: readonly {
		readonly draftId: string;
		readonly title: string;
		readonly entry: string;
		readonly files: number;
		readonly updatedAt: string;
	}[];
}> {
	const drafts = await context.authoring.listDrafts();
	const projects: {
		draftId: string;
		title: string;
		entry: string;
		files: number;
		updatedAt: string;
	}[] = [];
	for (const draft of drafts) {
		if (draft.deletedAt != null) continue;
		const project = await context.authoring.getRuntimeProject(draft.id);
		if (!isRuntimeEnabled(project) || project === null) continue;
		const files = await context.authoring.listRuntimeFiles(draft.id);
		projects.push({
			draftId: draft.id,
			title: draft.title,
			entry: project.entry,
			files: files.length,
			updatedAt: draft.updatedAt,
		});
	}
	projects.sort((left, right) =>
		left.updatedAt === right.updatedAt
			? left.draftId < right.draftId
				? -1
				: 1
			: left.updatedAt < right.updatedAt
				? 1
				: -1,
	);
	return { projects };
}

export async function getRuntimeProjectView(
	context: RuntimeMcpContext,
	draftId: string,
): Promise<RuntimeMcpProjectView> {
	const { draft, entry, files } = await resolveRuntimeProject(context, draftId);
	const assets = await context.authoring.listRuntimeAssets(draftId);
	return {
		draftId: draft.id,
		title: draft.title,
		entry,
		entryExists: files.some((file) => file.path === entry),
		files: files
			.slice(0, RUNTIME_MCP_LIMITS.filesListed)
			.map((file) => fileView(context, file, entry)),
		assets: assets.map((asset) => ({ path: asset.path })),
		limits: {
			files: RUNTIME_PROJECT_LIMITS.files,
			fileCharacters: RUNTIME_PROJECT_LIMITS.content,
		},
	};
}

export async function listRuntimeFiles(
	context: RuntimeMcpContext,
	draftId: string,
): Promise<{
	readonly entry: string;
	readonly files: readonly RuntimeMcpFileView[];
}> {
	const { entry, files } = await resolveRuntimeProject(context, draftId);
	return {
		entry,
		files: files
			.slice(0, RUNTIME_MCP_LIMITS.filesListed)
			.map((file) => fileView(context, file, entry)),
	};
}

const requireFile = (
	files: readonly DraftRuntimeFile[],
	path: string,
): DraftRuntimeFile => {
	const file = files.find((entry) => entry.path === path);
	if (file === undefined)
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.fileNotFound,
			`There is no file ${path}.`,
			{ path },
		);
	return file;
};

export async function readRuntimeFile(
	context: RuntimeMcpContext,
	draftId: string,
	path: string,
): Promise<{
	readonly path: string;
	readonly content: string;
	readonly hash: string;
	readonly entry: boolean;
}> {
	const { entry, files } = await resolveRuntimeProject(context, draftId);
	const file = requireFile(files, path);
	return {
		path: file.path,
		content: file.content,
		hash: context.host.digest(file.content),
		entry: file.path === entry,
	};
}

/**
 * A rejection from a pure rule becomes this channel's failure. Carrying the code over unchanged is
 * the point.
 */
function rejectPath(
	check: { ok: false; code: string; message: string },
	path: string,
): never {
	const code =
		check.code === "duplicate"
			? RUNTIME_MCP_ERROR_CODE.duplicatePath
			: check.code === "unsupported_extension"
				? RUNTIME_MCP_ERROR_CODE.unsupportedExtension
				: check.code === "too_many" || check.code === "content_too_long"
					? RUNTIME_MCP_ERROR_CODE.resourceLimit
					: RUNTIME_MCP_ERROR_CODE.invalidPath;
	throw new RuntimeMcpError(code, check.message, { path, reason: check.code });
}

const guardContent = (content: string, path: string): void => {
	const checked = checkRuntimeFileContent(content);
	if (!checked.ok) rejectPath(checked, path);
};

/**
 * The file changed after it was read. Includes the current fingerprint. The fingerprint has to come
 * along so the agent can decide its next step: re-read, merge, and write again with that
 * fingerprint. If the file is gone entirely, that fact is reported instead of a fingerprint,
 * because telling the agent to re-read the same value would just produce file_not_found again.
 */
async function fileConflict(
	context: RuntimeMcpContext,
	draftId: string,
	path: string,
): Promise<RuntimeMcpError> {
	let current: string | null = null;
	let removed = false;
	try {
		const { files } = await resolveRuntimeProject(context, draftId);
		const file = files.find((candidate) => candidate.path === path);
		if (file === undefined) removed = true;
		else current = context.host.digest(file.content);
	} catch {
		/** The project itself may have disappeared. The conflict is still reported as a conflict. */
	}
	return new RuntimeMcpError(
		RUNTIME_MCP_ERROR_CODE.fileConflict,
		removed
			? `${path} was deleted on another device. Read the project again and decide.`
			: `${path} changed after you read it. Read it again and merge.`,
		{
			path,
			...(current === null ? {} : { hash: current }),
			...(removed ? { deleted: true } : {}),
		},
	);
}

/**
 * Turns a storage conflict into a failure that carries the path and the current fingerprint. The
 * adapter says only that the push failed and knows no file vocabulary. If the adapter began knowing
 * paths, the same rules would exist twice. The latest version is resolved again here and its value
 * attached.
 */
async function withConflictDetail<T>(
	context: RuntimeMcpContext,
	draftId: string,
	path: string,
	mutate: () => Promise<T>,
): Promise<T> {
	try {
		return await mutate();
	} catch (error) {
		if (
			!(error instanceof RuntimeMcpError) ||
			error.code !== RUNTIME_MCP_ERROR_CODE.fileConflict ||
			error.details !== null
		)
			throw error;
		throw await fileConflict(context, draftId, path);
	}
}

/**
 * Checks the supplied fingerprint against the current value. Nothing is checked unless one is
 * supplied. Requiring it on every call would turn an ordinary operation into two round trips, and
 * agents would not memorize that procedure and would end up inventing values. The tool description
 * therefore asks the agent to pass the fingerprint from read_file unchanged. A write without one
 * has no protection against a stale version.
 */
async function guardExpectedHash(
	context: RuntimeMcpContext,
	draftId: string,
	path: string,
	content: string,
	expectedHash: string | undefined,
): Promise<void> {
	if (expectedHash === undefined) return;
	if (expectedHash === context.host.digest(content)) return;
	throw await fileConflict(context, draftId, path);
}

export interface RuntimeMcpWriteResult {
	readonly path: string;
	readonly hash: string;
	readonly bytes: number;
	/**
	 * Whether the entry file disappeared as a result of this operation. Deleting or renaming can leave
	 * the project in a state that does not compile. If that were passed on silently, the agent could
	 * not connect the next compile's runtime_entry_missing to what it just did.
	 */
	readonly entryMissing: boolean;
}

const entryMissingAfter = (
	files: readonly DraftRuntimeFile[],
	entry: string,
): boolean => !files.some((file) => file.path === entry);

export async function writeRuntimeFile(
	context: RuntimeMcpContext,
	input: {
		draftId: string;
		path: string;
		content: string;
		expectedHash?: string;
	},
): Promise<RuntimeMcpWriteResult> {
	await freshen(context);
	const { entry, files } = await resolveRuntimeProject(context, input.draftId);
	const file = files.find((candidate) => candidate.path === input.path);
	if (file === undefined)
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.fileNotFound,
			`There is no file ${input.path}. To create one, use create_file.`,
			{ path: input.path },
		);
	guardContent(input.content, input.path);
	await guardExpectedHash(
		context,
		input.draftId,
		input.path,
		file.content,
		input.expectedHash,
	);
	/**
	 * Another device can slip in between the check and the push. The final authority in that race is
	 * the server's optimistic concurrency, and its rejection is surfaced here rather than hidden by
	 * convergence.
	 */
	await withConflictDetail(context, input.draftId, input.path, () =>
		context.authoring.updateRuntimeFile(file.id, { content: input.content }),
	);
	return {
		path: input.path,
		hash: context.host.digest(input.content),
		bytes: [...input.content].length,
		entryMissing: entryMissingAfter(files, entry),
	};
}

export async function createRuntimeFile(
	context: RuntimeMcpContext,
	input: { draftId: string; path: string; content?: string },
): Promise<RuntimeMcpWriteResult> {
	/**
	 * Creation has no fingerprint to compare against, so refreshing is the only duplicate guard.
	 * Without the latest version, a path another device just created would be invisible to this one.
	 */
	await freshen(context);
	const { entry, files } = await resolveRuntimeProject(context, input.draftId);
	const planned = planRuntimeFileCreate(files, input.path);
	if (!planned.ok) rejectPath(planned, input.path);
	const content = input.content ?? "";
	guardContent(content, planned.path);
	const created = await withConflictDetail(
		context,
		input.draftId,
		planned.path,
		() =>
			context.authoring.createRuntimeFile(input.draftId, {
				path: planned.path,
				content,
			}),
	);
	if (created === null)
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.duplicatePath,
			`${planned.path} already exists.`,
			{ path: planned.path },
		);
	return {
		path: created.path,
		hash: context.host.digest(content),
		bytes: [...content].length,
		entryMissing: entryMissingAfter([...files, created], entry),
	};
}

/**
 * Rename does not fix imports. It does not follow references by string replacement, because that
 * replacement fails in the wrong direction. The same string can appear in comments, string
 * literals, or as part of another path, and a wrongly fixed import can pass compilation while
 * pointing at a different file. A broken import is instead named in the diagnostic, so the agent
 * can fix it from that message. That loop already exists in this tool set.
 */
export async function renameRuntimeFile(
	context: RuntimeMcpContext,
	input: {
		draftId: string;
		path: string;
		to: string;
		expectedHash?: string;
	},
): Promise<RuntimeMcpWriteResult & { readonly from: string }> {
	await freshen(context);
	const { entry, files } = await resolveRuntimeProject(context, input.draftId);
	const file = requireFile(files, input.path);
	await guardExpectedHash(
		context,
		input.draftId,
		input.path,
		file.content,
		input.expectedHash,
	);
	const planned = planRuntimeFileRename(files, file.id, input.to);
	if (!planned.ok) rejectPath(planned, input.to);
	await withConflictDetail(context, input.draftId, input.path, () =>
		context.authoring.updateRuntimeFile(file.id, { path: planned.path }),
	);
	const after = files.map((candidate) =>
		candidate.id === file.id ? { ...candidate, path: planned.path } : candidate,
	);
	return {
		from: file.path,
		path: planned.path,
		hash: context.host.digest(file.content),
		bytes: [...file.content].length,
		entryMissing: entryMissingAfter(after, entry),
	};
}

export async function deleteRuntimeFile(
	context: RuntimeMcpContext,
	input: { draftId: string; path: string; expectedHash?: string },
): Promise<{
	readonly path: string;
	readonly remaining: number;
	readonly entryMissing: boolean;
}> {
	await freshen(context);
	const { entry, files } = await resolveRuntimeProject(context, input.draftId);
	const file = requireFile(files, input.path);
	/**
	 * Delete also requires a fingerprint, because it is the costliest operation to undo. If another
	 * device wrote to the file after this read, the deleter believes it removes the content it read,
	 * but actually removes a draft it never saw.
	 */
	await guardExpectedHash(
		context,
		input.draftId,
		input.path,
		file.content,
		input.expectedHash,
	);
	await withConflictDetail(context, input.draftId, input.path, () =>
		context.authoring.deleteRuntimeFile(file.id),
	);
	const after = files.filter((candidate) => candidate.id !== file.id);
	return {
		path: file.path,
		remaining: after.length,
		entryMissing: entryMissingAfter(after, entry),
	};
}
