import { STORY_RUNTIME_LIMITS } from "@rowcat/contracts/story-runtime";
import type { Rev } from "@rowcat/contracts/sync";
import type {
	AuthoringSoftDelete,
	AuthoringStamp,
	AuthoringSyncMeta,
} from "./model.ts";

/**
 * The authoring record for the optional code project attached to a creator draft. This file knows
 * only whether the draft has TypeScript/TSX attached and what its files are.
 * - No execution here. eval, bundler, and module resolver never enter this module.
 * - Two records instead of fields. A field group maps one-to-one onto an editor screen, and
 *   adding values to it would make the drafts stored on devices and the payload shape diverge. Most
 *   drafts never run the runtime, so rows exist only for drafts that turned it on. Adding types
 *   does not break compatibility: the engine ignores types without a codec and only advances the
 *   cursor (docs/sync/ARCHITECTURE.md §19), so the schema version is not bumped.
 * - Project identity is derived from the draft id. A random id would create two records if two
 *   devices each turned the runtime on, with no basis for merging, and both would survive.
 * - No position field on files. Order is the path. Every tool draws by path, so reordering
 *   changes nothing.
 * - Not here: folder records (a folder is a set of files; an empty folder is screen state),
 *   binary assets (media references RowCat media), dependencies and config files, and compiled
 *   output or bundles (only authoring source is stored).
 */

/**
 * The project record also has an entry, but the constant exists because the two values answer
 * different questions. The constant says where a new project starts. The record's value says where
 * this project starts now. A commit that changes the constant must not move the entry of projects
 * already created.
 */
export const RUNTIME_ENTRY_PATH = "src/main.tsx";

/** Extensions accepted as authoring source. Anything not listed here is not a code project file. */
export const RUNTIME_SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
export type RuntimeSourceExtension = (typeof RUNTIME_SOURCE_EXTENSIONS)[number];

/**
 * Project limits. At this stage they limit representation, not performance. Path length and depth
 * narrow the shape a future module resolver must handle. File count and content length keep one
 * draft from growing too large for the sync envelope. Users reach these limits only after they have
 * finished writing.
 */
export const RUNTIME_PROJECT_LIMITS = {
	path: 200,
	segment: 64,
	/** Maximum number of `/`-separated segments: folder depth plus one. */
	depth: 8,
	/** Maximum length of one file's content, counted in code points. */
	content: 200_000,
	files: 200,
	/**
	 * The managed-image count is not written as a number here. It is read from the publish contract.
	 * If authoring allowed more, creators would hit the rejection only at publish, after all the work
	 * was done. The two limits must match so that failure occurs where they are bound together. The
	 * source-file limit differs because it splits into two axes, file count and total bytes.
	 */
	assets: STORY_RUNTIME_LIMITS.assets,
} as const;

/**
 * Path segment characters are narrowed on purpose. The file system accepts more than the module
 * resolver handles. Keeping the set open would make later narrowing break stored projects. Widening
 * stays possible.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Top-level folder names the runtime compiler keeps for itself. Its virtual file system holds the
 * runtime package and the TypeScript libraries under node_modules/ and the entry check under
 * .rowcat/, so a creator file there would be read as the compiler's own: a type error in it surfaced
 * as an infrastructure failure, and a .rowcat/entry-check.ts was silently replaced by the injected
 * one. Refusing the name here means the editor never creates a file the compiler then refuses.
 *
 * This is a copy of RESERVED_PROJECT_ROOTS in @rowcat/runtime-compiler (the compiler cannot import
 * this package; see its paths.ts), and runtime-path-parity.test.ts in apps/web holds the two equal.
 * Only the first segment is reserved, because only there do the two trees overlap. Files already
 * stored under these names are not revalidated; they stay readable and can be renamed out.
 */
const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
	"node_modules",
	".rowcat",
]);

/**
 * Derives the project record id from the draft id. The `authoring-runtime:` prefix keeps the
 * server's (owner, id) primary key from colliding with the draft's own record row.
 */
export const runtimeProjectIdFor = (draftId: string): string =>
	`authoring-runtime:${draftId}`;

/**
 * The file list is intentionally absent from this record. An array would make editing one file
 * rewrite the whole project, and when two devices edit different files, merging would discard one
 * side wholesale. Files are separate records so that each merges on its own.
 */
export interface DraftRuntimeProject
	extends AuthoringSyncMeta,
		AuthoringSoftDelete {
	/** `runtimeProjectIdFor(draftId)`. */
	id: string;
	draftId: string;
	/**
	 * Whether the draft has the runtime attached. This is not inferred from file existence: that would
	 * make 'keep the code but turn it off' unrepresentable, and turning off would become deletion,
	 * which cannot be undone (decision §16).
	 */
	enabled: boolean;
	/**
	 * Entry path. The value persists even if the file is deleted; pointing at nothing is the correct
	 * state.
	 */
	entry: string;

	createdAt: string;
	updatedAt: string;
}

/**
 * A project file holds only its path and raw text. It has no language or kind field; both derive
 * from the path's extension. Storing them would let them diverge after a rename: the screen would
 * say .ts while the editor opened the file as TSX.
 */
export interface DraftRuntimeFile
	extends AuthoringSyncMeta,
		AuthoringSoftDelete {
	id: string;
	draftId: string;
	/** Normalized project-root-relative path, with no leading `/` and no `./`. */
	path: string;
	content: string;

	createdAt: string;
	updatedAt: string;
}

/**
 * A managed image: one logical name bound to one RowCat media item, e.g. characters/sena/smile ->
 * media-A.
 * - Not a file. In the same table as code files, content would become binary or empty. The bytes
 *   stay in media; this record keeps one reference. The scene image (DraftSceneImage) has the same
 *   shape and reason.
 * - Identity is not the path. With path as the primary key, a rename would delete and recreate
 *   the record, shaking createdAt. On a random id, path is an ordinary field, so a rename is a
 *   field update.
 * - width, height, and mime derive from the media but are stored here. The repo has no media
 *   metadata lookup, so a synced draft's dimensions are unknown until the image downloads. Media is
 *   immutable, so stored values never go stale. Replacing a picture means creating new media and
 *   moving assetId.
 */
/**
 * Whether the logical name points to a picture or a sound. It is a stored value, not recomputed
 * from MIME. This value is the authorization axis: the publish request states the kind, and the
 * server validates the media against it. If the screen recomputed MIME on every render, that
 * judgment would scatter across apps. Devices also exchange these records, so a device that meets
 * an unknown MIME must not change the kind. The type is deliberately different from MediaKind. That
 * one is the server vocabulary, including avatars and covers; this one is only what runtime code
 * can reference by logical name.
 */
export type DraftRuntimeAssetKind = "image" | "audio";

/**
 * An asset the draft binds under a logical name. It is not a discriminated union, because this
 * record passes through Dexie, SQLite, and the sync envelope, which all store flat columns. Storing
 * a union would make each layer read the discriminator and reshape the record, and if the
 * conversions diverged, one side would go stale. So the columns are nullable, and the invariants
 * are enforced by the creating function (CreateDraftRuntimeAssetInput is the union). The media
 * table has the same shape for the same reason.
 */
export interface DraftRuntimeAsset
	extends AuthoringSyncMeta,
		AuthoringSoftDelete {
	id: string;
	draftId: string;
	/**
	 * Logical path the creator writes inside `asset()`. The grammar is defined by the language
	 * contract.
	 */
	path: string;
	/**
	 * Records synced before this column existed do not have it. Absence means image, because at that
	 * version the only managed assets were images. The decoder and the store read fill in image. Old
	 * records are not rewritten, since that would generate sync traffic for a value that is already
	 * correct.
	 */
	kind: DraftRuntimeAssetKind;
	/**
	 * The identity of the RowCat media item, not its address. The SDK builds the address from this
	 * value.
	 */
	assetId: string;
	/**
	 * The stored byte format. Media is immutable, so this column changes only together with assetId.
	 */
	mime: string;
	width: number | null;
	height: number | null;
	durationMs: number | null;

	createdAt: string;
	updatedAt: string;
}

/**
 * New local records start with dirty = 1 and serverVersion = 0, meaning the server has not seen
 * them yet.
 */
const freshSyncMeta = (rev: Rev): AuthoringSyncMeta => ({
	dirty: 1,
	serverVersion: 0,
	rev,
});

export interface CreateDraftRuntimeProjectInput {
	draftId: string;
	enabled?: boolean;
	entry?: string;
}

/**
 * Creates the project record without saving it. `stamp.id` is not accepted: the identity is derived
 * from the draft, so the caller cannot choose it. This is the only creator whose shape differs from
 * the others, and the asymmetry encodes the rule that there is one record per draft.
 */
export function createDraftRuntimeProjectRecord(
	input: CreateDraftRuntimeProjectInput,
	stamp: Omit<AuthoringStamp, "id">,
): DraftRuntimeProject {
	return {
		id: runtimeProjectIdFor(input.draftId),
		draftId: input.draftId,
		enabled: input.enabled ?? true,
		entry: input.entry ?? RUNTIME_ENTRY_PATH,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export interface CreateDraftRuntimeFileInput {
	draftId: string;
	/** The path must already be normalized and validated. This function does not check it again. */
	path: string;
	content?: string;
}

export function createDraftRuntimeFileRecord(
	input: CreateDraftRuntimeFileInput,
	stamp: AuthoringStamp,
): DraftRuntimeFile {
	return {
		id: stamp.id,
		draftId: input.draftId,
		path: input.path,
		content: input.content ?? "",
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

/**
 * The thing the logical name points to: its kind and the values that belong only to that kind. It
 * has no path and no draft id; the wrapping layer adds those, so an upload result flows into an
 * authoring record in one shape. With this shape, a sound that has a width, or a sound with no
 * duration, cannot be written. Omit is not used to strip the wrapper, because Omit does not
 * distribute over unions and blurs the discrimination. Layers that need stripping are simply not
 * attached in the first place; intersection distributes.
 */
export type NewRuntimeAssetMedia =
	| {
			kind: "image";
			assetId: string;
			mime: string;
			width: number;
			height: number;
	  }
	| { kind: "audio"; assetId: string; mime: string; durationMs: number };

/**
 * The shape the storage port accepts: an asset and the name it is called by. `path` must already be
 * a checked logical path. The grammar's authority is the language contract
 * (classifyRuntimeAssetValue in
 * @rowcat/runtime), which this package does not import. The app that set up the editor knows that
 * contract's version; the server re-checks with the same function at publish time.
 */
export type NewDraftRuntimeAsset = NewRuntimeAssetMedia & { path: string };

export type CreateDraftRuntimeAssetInput = NewDraftRuntimeAsset & {
	draftId: string;
};

export function createDraftRuntimeAssetRecord(
	input: CreateDraftRuntimeAssetInput,
	stamp: AuthoringStamp,
): DraftRuntimeAsset {
	return {
		id: stamp.id,
		draftId: input.draftId,
		path: input.path,
		kind: input.kind,
		assetId: input.assetId,
		mime: input.mime,
		width: input.kind === "image" ? input.width : null,
		height: input.kind === "image" ? input.height : null,
		durationMs: input.kind === "audio" ? input.durationMs : null,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export type DraftRuntimeProjectPatch = Partial<
	Pick<DraftRuntimeProject, "enabled" | "entry">
>;

export type DraftRuntimeFilePatch = Partial<
	Pick<DraftRuntimeFile, "path" | "content">
>;

/**
 * Only the name and the picture it points to are editable. Picture fields change together, so they
 * are one patch. Replacing a picture must move the new media's identity and dimensions together;
 * partial changes would make the list lie. Changing only `path` is a rename; changing the rest
 * together is a replacement.
 */
export type DraftRuntimeAssetPatch = Partial<
	Pick<
		DraftRuntimeAsset,
		"path" | "assetId" | "mime" | "width" | "height" | "durationMs"
	>
>;

/**
 * Folds a path into canonical form. This is a pure conversion that runs before validation. The line
 * between folding and rejecting is one question: is the creator's intent clear? Surrounding spaces,
 * backslashes, doubled slashes, and a leading ./ are different ways to write the same path, so they
 * are folded. `..` cannot be folded. It either points outside the project or is a typo, and either
 * way the answer is 'this cannot be placed here'.
 */
export function normalizeRuntimePath(input: string): string {
	const slashed = input.trim().replace(/\\/g, "/");
	const segments = slashed.split("/").filter((segment) => segment.length > 0);
	const kept: string[] = [];
	for (const segment of segments) {
		// `.` means the current location, so it adds nothing to the path. `..` is kept so the check below
		// rejects it.
		if (segment === ".") continue;
		kept.push(segment);
	}
	return kept.join("/");
}

export const RUNTIME_PATH_ISSUE_CODE = {
	empty: "empty",
	traversal: "traversal",
	invalidCharacter: "invalid_character",
	tooLong: "too_long",
	segmentTooLong: "segment_too_long",
	tooDeep: "too_deep",
	unsupportedExtension: "unsupported_extension",
	duplicate: "duplicate",
	tooMany: "too_many",
	contentTooLong: "content_too_long",
	reserved: "reserved",
} as const;
export type RuntimePathIssueCode =
	(typeof RUNTIME_PATH_ISSUE_CODE)[keyof typeof RUNTIME_PATH_ISSUE_CODE];

export type RuntimePathCheck =
	| { ok: true; path: string }
	| { ok: false; code: RuntimePathIssueCode; message: string };

const fail = (
	code: RuntimePathIssueCode,
	message: string,
): RuntimePathCheck => ({ ok: false, code, message });

/**
 * Judges the shape of a path after normalization. The only difference between file and folder is
 * the extension requirement; folders do not need one. The other rules (length, depth, characters,
 * `..`) are identical. If they diverged, a folder could be created where no file could be placed.
 */
export function checkRuntimePath(
	input: string,
	kind: "file" | "folder" = "file",
): RuntimePathCheck {
	const path = normalizeRuntimePath(input);
	if (path.length === 0) return fail("empty", "Please enter a path.");
	if (path.length > RUNTIME_PROJECT_LIMITS.path)
		return fail(
			"too_long",
			`A path can't exceed ${RUNTIME_PROJECT_LIMITS.path} characters.`,
		);

	const segments = path.split("/");
	if (segments.length > RUNTIME_PROJECT_LIMITS.depth)
		return fail(
			"too_deep",
			`Folders can be nested only ${RUNTIME_PROJECT_LIMITS.depth - 1} levels deep.`,
		);

	for (const segment of segments) {
		if (segment === "..")
			return fail("traversal", "A path can't point outside the project.");
		if (segment.length > RUNTIME_PROJECT_LIMITS.segment)
			return fail(
				"segment_too_long",
				`A name can't exceed ${RUNTIME_PROJECT_LIMITS.segment} characters.`,
			);
		if (!SEGMENT_PATTERN.test(segment))
			return fail(
				"invalid_character",
				"Only letters, digits and `.`, `_`, `-` can be used.",
			);
	}

	if (RESERVED_ROOT_SEGMENTS.has(segments[0] ?? ""))
		return fail(
			"reserved",
			"node_modules and .rowcat are reserved at the top of the project. Use another folder name.",
		);

	if (kind === "file" && !isRuntimeSourcePath(path))
		return fail(
			"unsupported_extension",
			`Only ${RUNTIME_SOURCE_EXTENSIONS.join(" · ")} files can be created.`,
		);

	return { ok: true, path };
}

/** The extension list is the only basis for deciding whether a path is an authoring source file. */
export function isRuntimeSourcePath(path: string): boolean {
	return RUNTIME_SOURCE_EXTENSIONS.some(
		(extension) => path.endsWith(extension) && path.length > extension.length,
	);
}

/**
 * The editor chooses its grammar from the path extension. The extension is not stored in the
 * record, and there is no runtimeFileLanguage function here. Monaco picks the language from the URI
 * extension, so judging it again here would create two sources for the same fact.
 */

export const runtimeFileName = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);

export function runtimeFolderOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * File order is path ascending, with ties broken by id. `localeCompare` is not used:
 * locale-dependent results would differ between devices, and tests could not pin them. Path
 * characters are already narrowed to ASCII, so code-point comparison is dictionary order.
 */
export function sortRuntimeFiles(
	files: DraftRuntimeFile[],
): DraftRuntimeFile[] {
	return [...files].sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		return a.id < b.id ? -1 : 1;
	});
}

/**
 * No record means the runtime is not attached. The predicate narrows the type because some code
 * writes records after passing this check (the work test reads `entry`). If each caller wrote the
 * condition itself, one axis would split across two conditions, and someday only one would get
 * updated.
 */
export const isRuntimeEnabled = (
	project: DraftRuntimeProject | null | undefined,
): project is DraftRuntimeProject => project?.enabled === true;

/**
 * Judges whether a new file may be created: path shape, duplicates, and count. This is done here
 * rather than in the store because the user must be told why. The store also rejects duplicates as
 * the last authority, but its rejection carries no message, and another tab may create the same
 * path in between.
 */
export function planRuntimeFileCreate(
	files: readonly DraftRuntimeFile[],
	input: string,
): RuntimePathCheck {
	const checked = checkRuntimePath(input, "file");
	if (!checked.ok) return checked;
	if (files.length >= RUNTIME_PROJECT_LIMITS.files)
		return fail(
			"too_many",
			`Up to ${RUNTIME_PROJECT_LIMITS.files} files can be created.`,
		);
	if (files.some((file) => file.path === checked.path))
		return fail("duplicate", "A file with the same path already exists.");
	return checked;
}

/**
 * Judges whether a rename is allowed. A file's own id is not a duplicate. Case-only renames such as
 * Phone.tsx to phone.tsx are common; comparing a file against itself would block them.
 */
export function planRuntimeFileRename(
	files: readonly DraftRuntimeFile[],
	id: string,
	input: string,
): RuntimePathCheck {
	const checked = checkRuntimePath(input, "file");
	if (!checked.ok) return checked;
	if (files.some((file) => file.id !== id && file.path === checked.path))
		return fail("duplicate", "A file with the same path already exists.");
	return checked;
}

/** Counts content length in code points, so an emoji is not counted as two characters. */
export function checkRuntimeFileContent(content: string): RuntimePathCheck {
	const length = [...content].length;
	if (length > RUNTIME_PROJECT_LIMITS.content)
		return fail(
			"content_too_long",
			`A file can't exceed ${RUNTIME_PROJECT_LIMITS.content.toLocaleString("en-US")} characters.`,
		);
	return { ok: true, path: "" };
}

/**
 * Asset order is logical path ascending, with ties broken by id. Same rule and reason as
 * sortRuntimeFiles. This order belongs to the screen, not to execution. The publish snapshot does
 * not carry it; the server builds its own canonical order.
 */
export function sortRuntimeAssets(
	assets: readonly DraftRuntimeAsset[],
): DraftRuntimeAsset[] {
	return [...assets].sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		return a.id < b.id ? -1 : 1;
	});
}

/**
 * Checks whether this logical name may be bound. It checks only duplicates and count; the path
 * grammar is not checked here. This package does not import the language contract, so the caller
 * passes a value that has already passed classifyRuntimeAssetValue. Folding both checks into one
 * function would tie this package to one contract version, and when that version widens, only the
 * authoring side would stay on the old grammar. `excludeId` lets a rename skip itself as a
 * duplicate. Scene images deliberately warn instead of blocking, because a name swap can overlap
 * briefly. Here the name is the identity, so an overlap has no defined meaning; a swap can go
 * through a temporary name instead.
 */
export function planRuntimeAssetBinding(
	assets: readonly DraftRuntimeAsset[],
	checkedPath: string,
	options: { excludeId?: string } = {},
): RuntimePathCheck {
	if (
		options.excludeId === undefined &&
		assets.length >= RUNTIME_PROJECT_LIMITS.assets
	)
		return fail(
			"too_many",
			`Up to ${RUNTIME_PROJECT_LIMITS.assets} images can be bound.`,
		);
	if (
		assets.some(
			(asset) => asset.id !== options.excludeId && asset.path === checkedPath,
		)
	)
		return fail("duplicate", "An image with the same name already exists.");
	return { ok: true, path: checkedPath };
}

/**
 * The binding list that publish and preview read. It is the authoring record with its authoring
 * fields stripped. id, rev, dirty, updatedAt, and dimensions do not leave. The publish contract
 * carries only the pair, and the preview resolver asks only for the pair. If authoring metadata
 * crossed this boundary, the server would learn the device's identity, and one sync would disturb
 * the preview's run signal.
 */
export function runtimeAssetBindings(
	assets: readonly DraftRuntimeAsset[],
): { path: string; assetId: string; kind: DraftRuntimeAssetKind }[] {
	return sortRuntimeAssets(assets).map((asset) => ({
		path: asset.path,
		assetId: asset.assetId,
		/**
		 * The kind is sent. It is an authorization axis, not authoring metadata: the server picks its
		 * predicate by it, and the preview resolver decides whether `<Image>` or `<Audio>` renders by it.
		 * Leaving it out would publish a sound as a picture, and that publish would quietly succeed.
		 */
		kind: asset.kind,
	}));
}

/**
 * What is created when the runtime is first turned on: the entry and the files. Values are created
 * in one place, the template registry (runtime-templates/). The starter-file body used to be
 * written as a string here, which was correct while there was only one starter. Now the creator
 * chooses, and two sources would conflict. The store accepts only this shape and does not know
 * which template produced it.
 */
export interface RuntimeStarter {
	entry: string;
	files: readonly { path: string; content: string }[];
}

export interface RuntimeTreeFile {
	kind: "file";
	/** The full path. File-explorer selection and operations refer to files by this value. */
	path: string;
	name: string;
	fileId: string;
}

export interface RuntimeTreeFolder {
	kind: "folder";
	path: string;
	name: string;
	children: RuntimeTreeNode[];
}

export type RuntimeTreeNode = RuntimeTreeFile | RuntimeTreeFolder;

/**
 * Builds a tree from the file list. Folders are derived from paths. `extraFolders` is the point of
 * this function: a folder without files is screen state, not a record. To show a folder the user
 * just created with `New folder`, the tree needs that list. Nothing is stored; a folder begins deriving
 * from paths as soon as a file enters it. Sorting is folders first, then by name, following the
 * convention of file-system tools.
 */
export function buildRuntimeTree(
	files: readonly DraftRuntimeFile[],
	extraFolders: readonly string[] = [],
): RuntimeTreeNode[] {
	const root: RuntimeTreeFolder = {
		kind: "folder",
		path: "",
		name: "",
		children: [],
	};

	const folders = new Map<string, RuntimeTreeFolder>([["", root]]);

	const folderAt = (path: string): RuntimeTreeFolder => {
		const existing = folders.get(path);
		if (existing) return existing;
		const parent = folderAt(runtimeFolderOf(path));
		const node: RuntimeTreeFolder = {
			kind: "folder",
			path,
			name: runtimeFileName(path),
			children: [],
		};
		folders.set(path, node);
		parent.children.push(node);
		return node;
	};

	for (const folder of extraFolders) {
		const normalized = normalizeRuntimePath(folder);
		if (normalized.length > 0) folderAt(normalized);
	}

	for (const file of sortRuntimeFiles([...files])) {
		folderAt(runtimeFolderOf(file.path)).children.push({
			kind: "file",
			path: file.path,
			name: runtimeFileName(file.path),
			fileId: file.id,
		});
	}

	sortTree(root.children);
	return root.children;
}

function sortTree(nodes: RuntimeTreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
		if (a.name !== b.name) return a.name < b.name ? -1 : 1;
		return 0;
	});
	for (const node of nodes) if (node.kind === "folder") sortTree(node.children);
}

/**
 * The explorer's initial expansion no longer uses this function. Expanding every folder on open fit
 * only the three-file project; now only the ancestors of the open file expand
 * (runtimeFileAncestors). This function stays because it states a pure fact about the tree: which
 * folders are derived. The check that decides whether an empty folder actually appears in the tree
 * uses it.
 */
export function runtimeFolderPaths(
	nodes: readonly RuntimeTreeNode[],
): string[] {
	const out: string[] = [];
	const walk = (list: readonly RuntimeTreeNode[]): void => {
		for (const node of list) {
			if (node.kind !== "folder") continue;
			out.push(node.path);
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}
