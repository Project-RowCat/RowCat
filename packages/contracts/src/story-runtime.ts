import { z } from "zod";

/**
 * Publish and playback contract for the creator runtime: source goes up, the artifact comes down.
 * (authoring device -> publish request -> server compile -> artifact -> playback response ->
 * playback device)
 *
 * The client never sends an artifact. Only the server compiles, so a client-built artifact would
 * prove nothing about having passed the RowCat compiler's policy passes (import and dynamic-code
 * restrictions, module graph validation, entry point checks). A plain HTTP client could skip that
 * layer. The sandbox remains the primary security boundary; server compilation only ensures
 * publishing cannot skip the policy layer.
 *
 * Published runtime code is not secret. The artifact runs on the authorized player's device, so its
 * strings and control flow can be inspected. promptProtected does not change this, and the
 * authoring surface must tell creators so.
 *
 * Not here:
 * - Authoring record fields (draftId, fileId, rev, dirty, deletedAt). The compiler does not know
 *   them, and the same draft yields the same artifact from any device. The server does not keep the
 *   source either; the durable original stays in the local-first E2EE authoring system.
 * - Player save state. That is the user's private data, synced by E2EE. This contract carries
 *   only the published execution snapshot.
 */

/**
 * The authoring limits (RUNTIME_PROJECT_LIMITS in @rowcat/authoring) cap one file and the file
 * count, but their product allows a 40 MB project that breaks no rule. Publishing compiles this
 * source on the server, so accepting that size would let one request consume the API process's CPU
 * and memory. The 2 MiB total sits between the publish request body, the compile budget (201 files,
 * 307 ms cold, measured; see docs/creator-runtime), and real projects (the five starter templates
 * are a few KB each). It is hundreds of times the templates and about ten times the 200 KB per-file
 * cap. Raising it is always possible; lowering it would break already published projects.
 */
export const STORY_RUNTIME_LIMITS = {
	/** Total UTF-8 bytes of runtime source in one publish request. */
	sourceBytes: 2 * 1024 * 1024,
	/**
	 * Serialized size of the stored artifact. It exceeds the source size because emitted output grows
	 * (JSX transform plus source maps). Without this cap, a story row could hold an unbounded
	 * executable JSON document, which is sent in full on every playback.
	 */
	artifactBytes: 8 * 1024 * 1024,
	/**
	 * Maximum number of diagnostics included in a failure response. The rest are reported only as a
	 * count.
	 */
	diagnostics: 50,
	diagnosticMessage: 500,
	/**
	 * Maximum number of managed image bindings a publication can carry. It matches the artifact's
	 * remote asset address limit (RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS), for the same reason: no
	 * single work needs to name more fixed pictures than this. The constant is not reused. This value
	 * belongs to the publish contract, and importing the compiler's constant would tie the contract to
	 * the emitted artifact format.
	 */
	assets: 256,
	/**
	 * Total UTF-8 bytes of all binding metadata. Counting entries alone would allow 256 logical paths
	 * of 200 characters each. This metadata is sent to the player's device on every playback, not only
	 * in the publish response. Both caps apply for the same reason as the remote address list: one
	 * asks how many, the other asks how large.
	 */
	assetBytes: 32 * 1024,
} as const;

export const StoryPublishRuntimeFile = z.object({
	path: z.string().min(1),
	content: z.string(),
});
export type StoryPublishRuntimeFile = z.infer<typeof StoryPublishRuntimeFile>;

/**
 * Managed image binding: a logical name and the RowCat media identity it points to, for example
 * characters/sena/smile -> media-A.
 *
 * Bytes are not here. Pictures are uploaded beforehand (POST /v2/me/runtime-assets), and publishing
 * carries only a reference. Embedding bytes would make one publish request tens of megabytes and
 * re-upload the same bytes on every republish.
 *
 * No URL is here. A client-asserted address would become authorization that the server cannot
 * verify. The server derives the address from the media identity it issued.
 *
 * The path syntax is decided by the server and is not narrowed here beyond a non-empty string. The
 * source of truth is classifyRuntimeAssetValue in @rowcat/runtime. A second regex here would go
 * stale when the language contract widens, and a stale one could reject paths the creator can
 * legitimately write.
 */
export const RUNTIME_MANAGED_ASSET_KINDS = ["image", "audio"] as const;
export const RuntimeManagedAssetKindSchema = z.enum(
	RUNTIME_MANAGED_ASSET_KINDS,
);
export type RuntimeManagedAssetKindValue = z.infer<
	typeof RuntimeManagedAssetKindSchema
>;

export const StoryPublishRuntimeAsset = z.object({
	/** The logical path written in asset(). The server decides its syntax. */
	path: z.string().min(1),
	/** Media identity returned by POST /v2/me/runtime-assets or /runtime-audio. */
	assetId: z.string().min(1).max(64),
	/**
	 * Whether the name refers to an image or audio. Absence means image.
	 *
	 * Optional for rollout: clients deployed before this field send only { path, assetId }, when
	 * images were the only managed assets, so absence is accurate. Making it required would block
	 * older clients from republishing their works.
	 *
	 * The reverse is not inferred. Audio must be stated explicitly as kind: "audio", because the kind
	 * is part of authorization. Guessing it from the MIME type would turn 'did the author mean to
	 * place this' into 'what do these bytes parse as'. The client's claim is an input to validation,
	 * not the conclusion: the database confirms the media is actually that kind.
	 */
	kind: RuntimeManagedAssetKindSchema.optional(),
});
export type StoryPublishRuntimeAsset = z.infer<typeof StoryPublishRuntimeAsset>;

export const StoryPublishRuntimeProject = z.object({
	/**
	 * The runtime language contract version this source expects. The server decides whether it can
	 * handle it.
	 */
	apiVersion: z.number().int().positive(),
	entry: z.string().min(1),
	files: z.array(StoryPublishRuntimeFile),
	/**
	 * `.default([])` is all the compatibility this field needs. Clients unaware of the field (older
	 * web and mobile during rollout, fixtures) send mode: "source" with the field empty. Absence then
	 * means 'a runtime with no managed images', which is accurate for them, since their version had no
	 * way to bind pictures.
	 *
	 * This is a different axis from the runtime field itself. An absent runtime field keeps the
	 * published runtime, bindings included. A runtime with mode "source" and an empty array
	 * republishes with no bindings, and that empty state is authoritative. Folding it into 'keep'
	 * would mean removing the last picture could never clear it, and the work would keep referencing
	 * media it no longer uses.
	 */
	assets: z.array(StoryPublishRuntimeAsset).default([]),
});
export type StoryPublishRuntimeProject = z.infer<
	typeof StoryPublishRuntimeProject
>;

/**
 * The runtime axis of the publish request. It is a discriminated union, not a boolean.
 *
 * - Field absent: an old client. On update, the already published runtime is kept.
 * - mode "disabled": the draft has the runtime turned off, so the published runtime is deleted.
 * - mode "source": one set of runtime source. The server compiles it into an artifact.
 *
 * The first two lines are why this type exists. During rollout, clients that do not know this field
 * still publish. Reading their request as 'runtime off' would let one update silently delete the
 * published runtime. Absence means 'not said'; explicit disabled means 'turn off'.
 */
export const StoryPublishRuntimeInput = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("disabled") }),
	z.object({ mode: z.literal("source"), project: StoryPublishRuntimeProject }),
]);
export type StoryPublishRuntimeInput = z.infer<typeof StoryPublishRuntimeInput>;

/**
 * Compile diagnostic, limited to values the creator can fix: no server file paths, TypeScript
 * internals, stack traces, or thrown exception strings. The path is inside the runtime project, the
 * name the creator sees in the editor.
 */
export const StoryRuntimeDiagnosticDto = z.object({
	code: z.string(),
	severity: z.enum(["error", "warning"]),
	message: z.string().max(STORY_RUNTIME_LIMITS.diagnosticMessage),
	/** Project path. Diagnostics not tied to a file, such as a missing entry point, have none. */
	path: z.string().optional(),
	line: z.number().int().positive().optional(),
	column: z.number().int().positive().optional(),
});
export type StoryRuntimeDiagnosticDto = z.infer<
	typeof StoryRuntimeDiagnosticDto
>;

/**
 * Failure body, sent in the details of the ordinary publish error envelope (ApiErrorBody). The
 * screen draws the same shape as a `Problems` list. `truncated` exists because diagnostics can
 * number in the hundreds. Sending all of them would make the response large, and silently cutting
 * them would make the end of the list look like the real end.
 */
export const StoryRuntimePublishFailure = z.object({
	diagnostics: z.array(StoryRuntimeDiagnosticDto),
	/** Number of diagnostics left out of the response. Zero means the list is complete. */
	truncated: z.number().int().nonnegative(),
});
export type StoryRuntimePublishFailure = z.infer<
	typeof StoryRuntimePublishFailure
>;

/**
 * How this story is played. The server projects this value. The screen must not guess it from the
 * title, the creator, draft metadata, or the presence of runtime authoring files. The authority is
 * the existence of one valid story_runtime row, which only the server knows.
 */
export const STORY_PLAY_MODES = ["chat", "runtime"] as const;
export const StoryPlayMode = z.enum(STORY_PLAY_MODES);
export type StoryPlayMode = z.infer<typeof StoryPlayMode>;
