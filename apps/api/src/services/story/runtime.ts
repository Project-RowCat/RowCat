import {
	checkRuntimeFileContent,
	checkRuntimePath,
	RUNTIME_PROJECT_LIMITS,
} from "@rowcat/authoring/runtime";
import {
	STORY_PUBLISH_ERROR_CODE,
	STORY_RUNTIME_CAPABILITIES,
	STORY_RUNTIME_LIMITS,
	type StoryPublishRuntimeAsset,
	type StoryPublishRuntimeInput,
	type StoryRuntimeCapability,
	type StoryRuntimeDiagnosticDto,
	type StoryRuntimePublishFailure,
} from "@rowcat/contracts";
import {
	classifyRuntimeAssetValue,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import type {
	RuntimeArtifact,
	RuntimeDiagnostic,
} from "@rowcat/runtime-compiler";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { story_runtime } from "../../db/schema.ts";
import { ApiError } from "../../lib/errors.ts";
import { findUnusableRuntimeAudio } from "../runtime-audio.ts";
import {
	findUnusableRuntimeImages,
	syncStoryRuntimeAssetReferences,
} from "../runtime-image.ts";
import type { Tx } from "./index.ts";
import { compileRuntimeInIsolation } from "./runtime-compile.ts";

/**
 * Runtime publication: turns authored source into an executable artifact.
 *
 * ```text
 * request runtime source
 *   -> shape and limit checks   (path, extension, duplicates, file count, total bytes)
 *   -> authoritative compile    @rowcat/runtime-compiler
 *   -> artifact validation and limits
 * story_runtime  (upsert, delete or preserve inside the publish transaction)
 * ```
 *
 * The server recompiles because a client-built artifact proves nothing about having passed the
 * compiler's policy layer (import limits, dynamic-code limits, module graph validation, entry type
 * check all ran in the browser, and a plain HTTP client skips them). The contract has no slot for
 * an artifact. The sandbox is still the primary security boundary: this keeps publication from
 * deliberately skipping the policy layer, and the player's runtime host validates the artifact
 * again before running it.
 *
 * Compilation is outside the transaction: building a TypeScript program takes hundreds of
 * milliseconds (measured: 307ms cold for 201 files), and holding the story row lock that long would
 * stall the creator's other operations (cover normalization sits there for the same reason). Order:
 * auth and contract validation, source shape and limits, compile (no DB until here, so a failure
 * publishes nothing), then the publish transaction. A failed republish therefore leaves the
 * published runtime untouched.
 *
 * Authoring source is not stored; it crosses once as compile input and only the artifact and its
 * identity are committed.
 */

/** A diagnostic in response shape; no server paths or TypeScript internals. */
const toDiagnosticDto = (
	diagnostic: RuntimeDiagnostic,
): StoryRuntimeDiagnosticDto => ({
	code: diagnostic.code,
	severity: diagnostic.severity,
	message: diagnostic.message.slice(0, STORY_RUNTIME_LIMITS.diagnosticMessage),
	...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
	...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
	...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
});

/**
 * Runtime publish rejection, carrying diagnostics the creator can fix. Failures that are not
 * compiler diagnostics (limits, shape) use the same envelope because the screen draws both as one
 * list, as the studio's `Problems` does.
 */
function rejectRuntime(
	diagnostics: readonly StoryRuntimeDiagnosticDto[],
	message = "Couldn't publish the runtime code.",
): never {
	const shown = diagnostics.slice(0, STORY_RUNTIME_LIMITS.diagnostics);
	const failure: StoryRuntimePublishFailure = {
		diagnostics: [...shown],
		truncated: diagnostics.length - shown.length,
	};
	throw new ApiError(400, STORY_PUBLISH_ERROR_CODE.runtimeInvalid, message, {
		details: failure,
	});
}

/** Writes limit and shape violations in the compiler diagnostics' vocabulary. */
const shapeIssue = (
	code: string,
	message: string,
	path?: string,
): StoryRuntimeDiagnosticDto => ({
	code,
	severity: "error",
	message,
	...(path === undefined ? {} : { path }),
});

/**
 * Source shape and limits, checked before calling the compiler.
 *
 * The server re-checks authoring limits because that check ran in the browser, using the same
 * constants as `@rowcat/authoring` (no looser copy). The total byte cap lives here because the
 * per-file cap (200,000 chars) times the file cap (200) allows a theoretical 40MB project that
 * breaks no rule and would take the process's memory to compile.
 */
function requireValidRuntimeSource(project: {
	apiVersion: number;
	entry: string;
	files: readonly { path: string; content: string }[];
}): void {
	const issues: StoryRuntimeDiagnosticDto[] = [];

	if (project.files.length === 0)
		issues.push(
			shapeIssue("runtime_project_empty", "The runtime project is empty."),
		);
	if (project.files.length > RUNTIME_PROJECT_LIMITS.files)
		issues.push(
			shapeIssue(
				"runtime_too_many_files",
				`Up to ${RUNTIME_PROJECT_LIMITS.files} files can be published.`,
			),
		);

	const seen = new Set<string>();
	let bytes = 0;
	for (const file of project.files) {
		const checked = checkRuntimePath(file.path, "file");
		if (!checked.ok) {
			issues.push(
				shapeIssue("runtime_invalid_path", checked.message, file.path),
			);
			continue;
		}
		/**
		 * Duplicates are judged on the normalized path: on the raw string `./src/a.ts` and `src/a.ts`
		 * pass as different files while module resolution reads them as the same.
		 */
		if (seen.has(checked.path)) {
			issues.push(
				shapeIssue(
					"runtime_duplicate_path",
					"More than one file has the same path.",
					checked.path,
				),
			);
			continue;
		}
		seen.add(checked.path);
		const content = checkRuntimeFileContent(file.content);
		if (!content.ok)
			issues.push(
				shapeIssue("runtime_content_too_long", content.message, checked.path),
			);
		bytes += Buffer.byteLength(file.content, "utf8");
		bytes += Buffer.byteLength(checked.path, "utf8");
	}

	if (bytes > STORY_RUNTIME_LIMITS.sourceBytes)
		issues.push(
			shapeIssue(
				"runtime_source_too_large",
				`Runtime source can't exceed ${Math.floor(STORY_RUNTIME_LIMITS.sourceBytes / 1024 / 1024)}MB.`,
			),
		);

	const entry = checkRuntimePath(project.entry, "file");
	if (!entry.ok)
		issues.push(shapeIssue("runtime_entry_invalid_path", entry.message));
	else if (!seen.has(entry.path))
		issues.push(
			shapeIssue(
				"runtime_entry_missing",
				"The runtime entry file wasn't found.",
				entry.path,
			),
		);

	/**
	 * Do not compile an API version this server cannot handle. The compiler makes the same check
	 * (`runtime_api_version_unsupported`) but only after building the program; failing here keeps a
	 * request claiming a future version from spending compile budget.
	 */
	if (project.apiVersion > RUNTIME_API_VERSION)
		issues.push(
			shapeIssue(
				"runtime_api_version_unsupported",
				"This runtime API version isn't supported yet. Please update the app.",
			),
		);

	if (issues.length > 0) rejectRuntime(issues);
}

/**
 * Rejects the binding list with a code different from `runtimeInvalid`: compile failures mean "fix
 * the code" and draw the `Problems` list, while this means "fix the asset list"; folded together, a
 * creator who lost one image would search the diagnostics. It does not say which binding failed:
 * separating missing from foreign assets would make the response a media-id existence probe (scene
 * images and covers made the same call).
 */
function rejectRuntimeAssets(message: string): never {
	throw new ApiError(
		400,
		STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		message,
	);
}

/**
 * Shape of the binding list (syntax, duplicates, count, total size); does not read the DB.
 *
 * Path syntax is decided by the language contract (`classifyRuntimeAssetValue`) rather than a
 * second regex, so a name the editor accepts is never rejected at publish. That function also
 * rejects remote addresses here: an `https://...` entry in the logical-asset table would be a route
 * around the remote authorization list.
 *
 * Duplicates are rejected, not folded. Taking the first is deterministic, but where the name is the
 * identity two entries have no defined meaning, and a silent choice would impose a decision the
 * creator never made.
 */
function requireValidRuntimeAssets(
	assets: readonly StoryPublishRuntimeAsset[],
): void {
	if (assets.length > STORY_RUNTIME_LIMITS.assets)
		rejectRuntimeAssets(
			`Up to ${STORY_RUNTIME_LIMITS.assets} runtime images can be bound.`,
		);

	let bytes = 0;
	const seen = new Set<string>();
	for (const asset of assets) {
		const target = classifyRuntimeAssetValue(asset.path);
		if (target === null || target.kind !== "logical")
			rejectRuntimeAssets("The image name is invalid.");
		if (seen.has(target.path))
			rejectRuntimeAssets("More than one image has the same name.");
		seen.add(target.path);
		bytes += Buffer.byteLength(asset.path, "utf8");
		bytes += Buffer.byteLength(asset.assetId, "utf8");
		/**
		 * The kind is counted too. It does not move the total, but the budget answers "how much goes to
		 * the player's device per playback", and that answer includes this field.
		 */
		if (asset.kind !== undefined)
			bytes += Buffer.byteLength(asset.kind, "utf8");
	}

	if (bytes > STORY_RUNTIME_LIMITS.assetBytes)
		rejectRuntimeAssets("The runtime image list is too large.");
}

/**
 * Whether these bindings point at this creator's runtime media; the authoritative publish check.
 *
 * The contract checks shape only, and an unchecked foreign media id would render fine (media reads
 * are public), letting someone use another person's picture. `kind` is checked together with
 * ownership: otherwise the creator's own avatar, cover or scene image id could be published as a
 * runtime asset, pictures they never chose to put there (the predicates in
 * `services/runtime-image.ts` check all three). The entry is not dropped silently because the
 * creator would believe the assets shipped.
 */
async function requireOwnRuntimeAssets(
	ownerId: string,
	assets: readonly StoryPublishRuntimeAsset[],
): Promise<void> {
	/**
	 * Split by the kind the request states; each kind asks its own predicate.
	 *
	 * A missing `kind` means `image`: studios deployed before this axis send `{ path, assetId }`, and
	 * managed assets were images only then. Guessing from MIME is refused because the kind is the
	 * authorization, and guessing would change the question from "did this person choose to put it
	 * here" to "what do these bytes parse as". The client's claim is validation input, not the
	 * conclusion: `kind: "audio"` only selects the audio predicate, and the DB decides whether that
	 * media is really this person's runtime audio.
	 */
	const images: string[] = [];
	const audio: string[] = [];
	for (const asset of assets)
		(asset.kind === "audio" ? audio : images).push(asset.assetId);

	/** Run both checks side by side: order is irrelevant (the same rejection either way) and both are short reads. */
	const [missingImages, missingAudio] = await Promise.all([
		findUnusableRuntimeImages(ownerId, images),
		findUnusableRuntimeAudio(ownerId, audio),
	]);

	/**
	 * The messages differ because the screen's advice differs: telling someone to re-upload an image
	 * when a sound is missing sends them looking for a picture that does not exist.
	 */
	if (missingAudio.length > 0)
		rejectRuntimeAssets(
			"A runtime sound wasn't found. Please upload the sound again.",
		);
	if (missingImages.length > 0)
		rejectRuntimeAssets(
			"A runtime image wasn't found. Please upload the image again.",
		);
}

/**
 * Canonical list for storage and responses: path-sorted, deduplicated, logical paths only. Writes
 * and reads share it so a corrupt row (old deployment, manual edit) cannot reach a response and the
 * same publish always commits the same bytes.
 */
function canonicalManagedAssets(value: unknown): StoryPublishRuntimeAsset[] {
	const entries = Array.isArray(value)
		? (value as { path?: unknown; assetId?: unknown; kind?: unknown }[])
		: [];
	return [...runtimeManagedAssetBindings(entries)]
		.map(([path, managed]) => ({
			path,
			assetId: managed.mediaId,
			/**
			 * The kind is written explicitly, not folded. Folding to `{ path, assetId }` would turn a sound
			 * binding into an image once stored, and the name would not resolve in `<Audio>` at playback:
			 * publish succeeds and the sound never plays. Old rows lack this key and
			 * `runtimeManagedAssetBindings` reads that as `image`, so an old snapshot passing through here
			 * gains `kind: "image"`, a fact that was already true; stored rows are not rewritten.
			 */
			kind: managed.mediaKind,
		}))
		.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/**
 * Capabilities this publication uses, derived from the compile graph.
 *
 * The creator does not declare them: if `usesGeneration: false` could be sent, a publication could
 * call generation without the trusted AI notice. Detection looks at emitted code of modules that
 * import the runtime builtin and searches for the public hook name; an aliased import
 * (`useGeneration as useAi`) still leaves the original property name in emitted code.
 *
 * It errs toward over-detecting: an extra notice on a work that does not use generation is an
 * inconvenience, a missing one is an incident. This value is not a security authority; the host's
 * capability table decides what can actually be called.
 */
function deriveCapabilities(
	artifact: RuntimeArtifact,
): StoryRuntimeCapability[] {
	const usesGeneration = artifact.modules.some((module) => {
		const importsRuntime = module.dependencies.some(
			(dependency) => dependency.kind === "builtin",
		);
		return importsRuntime && module.code.includes("useGeneration");
	});
	return usesGeneration ? ["generation"] : [];
}

export interface CompiledStoryRuntime {
	artifact: RuntimeArtifact;
	capabilities: StoryRuntimeCapability[];
	bytes: number;
}

/**
 * Runtime source -> artifact; does not touch the DB.
 *
 * The compile runs in a thread of its own with a memory ceiling and a deadline
 * (`runtime-compile.ts`): type checking is unbounded, and inline it let a kilobyte of source take
 * the whole API down. Running out of either is the source's doing and is rejected like any other
 * diagnostic; a busy compiler is a 503.
 *
 * Exceptions thrown by the compiler are our failures, not the creator's. Folding them into
 * diagnostics would make a server incident look like a syntax error, so they are not caught here
 * and become a 500 with a log entry.
 */
export async function compileStoryRuntime(project: {
	apiVersion: number;
	entry: string;
	files: readonly { path: string; content: string }[];
}): Promise<CompiledStoryRuntime> {
	requireValidRuntimeSource(project);

	const isolated = await compileRuntimeInIsolation({
		apiVersion: project.apiVersion,
		entry: project.entry,
		files: project.files.map((file) => ({
			path: file.path,
			content: file.content,
		})),
	});
	if (isolated.kind === "busy")
		throw new ApiError(
			503,
			STORY_PUBLISH_ERROR_CODE.runtimeCompileBusy,
			"Too many runtime projects are being checked right now. Please try again in a moment.",
			{ retryAfterSeconds: 10 },
		);
	if (isolated.kind === "exhausted")
		rejectRuntime([
			shapeIssue(
				"runtime_compile_exhausted",
				isolated.reason === "memory"
					? "Checking this project needed more memory than a publication may use. Simplify the types (deeply recursive or very large type computations are the usual cause) and try again."
					: "Checking this project took longer than a publication may take. Simplify the types (deeply recursive or very large type computations are the usual cause) and try again.",
			),
		]);
	const result = isolated.result;

	if (!result.ok)
		rejectRuntime(
			result.diagnostics
				.filter((diagnostic) => diagnostic.severity === "error")
				.map(toDiagnosticDto),
		);

	/**
	 * Measure the emitted size before storing. Committing an oversize value would make every playback
	 * send those bytes, invisibly to creator and player.
	 */
	const serialized = JSON.stringify(result.artifact);
	const bytes = Buffer.byteLength(serialized, "utf8");
	if (bytes > STORY_RUNTIME_LIMITS.artifactBytes)
		rejectRuntime([
			shapeIssue(
				"runtime_artifact_too_large",
				`The compiled runtime exceeds ${Math.floor(STORY_RUNTIME_LIMITS.artifactBytes / 1024 / 1024)}MB.`,
			),
		]);

	return {
		artifact: result.artifact,
		capabilities: deriveCapabilities(result.artifact),
		bytes,
	};
}

/**
 * The request's runtime axis, folded into a result that is compiled already:
 *
 * ```text
 * undefined         `preserve`   not stated; an update leaves the published runtime as is
 * mode: "disabled"  `remove`     delete the published runtime
 * mode: "source"    `publish`    one artifact
 * ```
 */
export type StoryRuntimePlan =
	| { kind: "preserve" }
	| { kind: "remove" }
	| {
			kind: "publish";
			compiled: CompiledStoryRuntime;
			/** Canonicalized bindings, exactly what is stored (path-sorted, no duplicates, logical paths only). */
			assets: StoryPublishRuntimeAsset[];
	  };

/**
 * Builds the plan; reads only, never writes.
 *
 * It is async because ownership of the bindings needs media rows, and that read must sit before and
 * outside the publish transaction: a rejection writes nothing to the story row and leaves the
 * published runtime untouched (the same reason compilation is here). Order is shape, then
 * ownership, then compile: the first two are nearly free and compile takes hundreds of
 * milliseconds, so a request with a bad asset list does not spend compile budget.
 */
export async function planStoryRuntime(
	input: StoryPublishRuntimeInput | undefined,
	ownerId: string,
): Promise<StoryRuntimePlan> {
	if (input === undefined) return { kind: "preserve" };
	if (input.mode === "disabled") return { kind: "remove" };
	requireValidRuntimeAssets(input.project.assets);
	await requireOwnRuntimeAssets(ownerId, input.project.assets);
	return {
		kind: "publish",
		compiled: await compileStoryRuntime(input.project),
		assets: canonicalManagedAssets(input.project.assets),
	};
}

/**
 * Applies the plan to the story row in the same transaction. `preserve` emits no statement, which
 * is what keeps an old client's update from silently deleting the published runtime.
 */
export async function applyStoryRuntimePlan(
	tx: Tx,
	storyId: string,
	plan: StoryRuntimePlan,
): Promise<void> {
	if (plan.kind === "preserve") return;
	if (plan.kind === "remove") {
		await tx.delete(story_runtime).where(eq(story_runtime.story_id, storyId));
		/**
		 * Turning the runtime off drops its media dependencies, runtime role only. Without this the work
		 * would hold unused images forever and the creator's account deletion would retain them. Scene
		 * image references are untouched (the role is in the predicate): turning off the runtime must not
		 * delete the chat snapshot's pictures.
		 */
		await syncStoryRuntimeAssetReferences(tx, storyId, []);
		return;
	}
	const { artifact } = plan.compiled;
	await tx
		.insert(story_runtime)
		.values({
			story_id: storyId,
			artifact,
			artifact_format_version: artifact.formatVersion,
			runtime_api_version: artifact.apiVersion,
			compiler_version: artifact.compilerVersion,
			source_hash: artifact.sourceHash,
			capabilities: plan.compiled.capabilities,
			managed_assets: plan.assets,
		})
		.onConflictDoUpdate({
			target: story_runtime.story_id,
			set: {
				artifact,
				artifact_format_version: artifact.formatVersion,
				runtime_api_version: artifact.apiVersion,
				compiler_version: artifact.compilerVersion,
				source_hash: artifact.sourceHash,
				capabilities: plan.compiled.capabilities,
				/**
				 * Bindings move in the same statement as the artifact; split, "new code with old images" or the
				 * reverse would commit and look healthy to players (a placeholder, or a renamed image).
				 */
				managed_assets: plan.assets,
				updated_at: new Date(),
			},
		});
	/**
	 * Media dependencies are reconciled to their final state in the same transaction. One image bound
	 * under several logical names is one dependency row (deduplicated): the table answers "does this
	 * work stand without this media", not how often it is used.
	 */
	await syncStoryRuntimeAssetReferences(
		tx,
		storyId,
		plan.assets.map((asset) => asset.assetId),
	);
}

export interface PublishedStoryRuntime {
	artifact: unknown;
	capabilities: StoryRuntimeCapability[];
	/** Logical name -> media identity; not an address, which the playback surface builds with the SDK. */
	managedAssets: StoryPublishRuntimeAsset[];
	runtimeApiVersion: number;
	artifactFormatVersion: number;
}

/**
 * One published runtime; the caller has already authorized.
 *
 * There is no viewer or exposure axis here: playback entitlement must pass the same door as chat
 * playback (the route guards it), and a second decision here could loosen independently. The value
 * is `unknown` for the same reason: jsonb enforces no shape, so no code trusting stored values sits
 * in this layer; the response boundary validates the contract and the player's runtime host
 * validates again before running.
 */
export async function getPublishedStoryRuntime(
	storyId: string,
): Promise<PublishedStoryRuntime | null> {
	const [row] = await db
		.select({
			artifact: story_runtime.artifact,
			capabilities: story_runtime.capabilities,
			managedAssets: story_runtime.managed_assets,
			runtimeApiVersion: story_runtime.runtime_api_version,
			artifactFormatVersion: story_runtime.artifact_format_version,
		})
		.from(story_runtime)
		.where(eq(story_runtime.story_id, storyId))
		.limit(1);
	if (!row) return null;
	return {
		artifact: row.artifact,
		/**
		 * Drop values outside the vocabulary. The column is `text[]` and enforces none, and an unknown
		 * name in the response makes contract parsing reject the whole response; opening the work without
		 * that capability beats failing to open it (the notice holds only for capabilities we know).
		 */
		capabilities: row.capabilities.filter(
			(name): name is StoryRuntimeCapability =>
				(STORY_RUNTIME_CAPABILITIES as readonly string[]).includes(name),
		),
		/**
		 * Passes the same canonicalization as writes. A corrupt row (manual edit, old deployment) could
		 * put a remote address or broken path in the response and make contract parsing reject it
		 * entirely; opening the work without that entry beats failing to open it (the capability list
		 * made the same call).
		 */
		managedAssets: canonicalManagedAssets(row.managedAssets),
		runtimeApiVersion: row.runtimeApiVersion,
		artifactFormatVersion: row.artifactFormatVersion,
	};
}
