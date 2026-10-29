import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { story } from "./story.ts";

/**
 * The executable runtime snapshot of a published story: one artifact compiled by the server.
 *
 * ```text
 * story.play_payload   conversation playback snapshot   always present (runtime works too)
 * story_runtime        runtime artifact                 only for works published with the runtime on
 * ```
 *
 * Not placed on `play_payload`: that column already has a contract (`StoryChatSeedDto`) and an
 * artifact of a different shape would make its parser carry unknown keys. The lifetimes also
 * differ: the conversation snapshot must exist for every work (it is the old-client fallback) while
 * the artifact exists only when the runtime is on, and one cell would let "turn the runtime off"
 * delete the conversation snapshot too.
 *
 * List and detail queries never select this table's bytes (a gallery page must not drag in
 * twenty-four artifacts); they look only at the existence of `story_id`.
 *
 * The only FK is to the story (`cascade`). There is no FK to a member or creator: when a creator
 * deletes their account the public work stays with identity detached (`story.owner = null`) and its
 * runtime must stay playable (same call as `story_media`). The owner is not copied here either.
 * Lifecycle transitions never touch this row, so a restored work runs the same code again.
 *
 * Authoring source is not stored (no `mainTsx`, `runtimeSourceFiles` or similar). It crosses once
 * as compile input and the durable original stays in the device's local-first, E2EE authoring
 * system; keeping it here would accumulate creators' manuscripts as plaintext.
 *
 * The metadata columns duplicate values inside the artifact JSON so compatibility queries need not
 * parse jsonb: "which publications cannot run on the current runtime API version" must be asked
 * when the API version is raised, and reading TOAST wholesale would make that an incident. All of
 * them derive from the compile result, never from client input.
 */
export const story_runtime = pgTable("story_runtime", {
	story_id: text("story_id")
		.primaryKey()
		.references(() => story.id, { onDelete: "cascade" }),
	/** The compiled artifact as-is. The player's runtime host validates it again before running. */
	artifact: jsonb("artifact").notNull(),
	/** `RuntimeArtifact.formatVersion`: version of the shape. */
	artifact_format_version: integer("artifact_format_version").notNull(),
	/** `RuntimeArtifact.apiVersion`: version of the language contract this code expects. */
	runtime_api_version: integer("runtime_api_version").notNull(),
	/** `RuntimeArtifact.compilerVersion`: version of the rules that produced these bytes. */
	compiler_version: integer("compiler_version").notNull(),
	/**
	 * Canonical hash of the creator's source. No device identity enters it, so the same manuscript
	 * from any device gives the same value and answers "did this publication actually change code".
	 */
	source_hash: text("source_hash").notNull(),
	/**
	 * Capability families this publication uses. A product-UX value, not a security authority: what
	 * can actually be called is decided by the player host's capability table. Its job is to stand in
	 * front of that, since works using generation must show the trusted AI notice first and a
	 * creator-declared flag would allow billing without it. It derives from the server's compile
	 * graph, never the request, and is stored so playback does not scan artifact code per request.
	 */
	capabilities: text("capabilities").array().notNull().default([]),
	/**
	 * Images this publication calls by logical name: `[{ path, assetId }]`, e.g. `{ "path":
	 * "characters/sena/smile", "assetId": "media-A" }`.
	 *
	 * Not inside the artifact: the artifact is a compile result and this table is a publication
	 * decision with a different lifetime. Swapping an image changes no source byte, so two
	 * publications with the same `source_hash` must be able to point at different images; putting it
	 * in the artifact would make the server edit a compile result afterwards and break the link
	 * between `source_hash` and the stored bytes.
	 *
	 * Not its own table (`story_runtime_asset`): it is always read and written together with the
	 * artifact (one playback response carries both), so atomicity is true by being the same tuple, and
	 * there is no lookup axis beyond reading the whole map.
	 *
	 * Media lifecycle dependency is recorded by `story_media` (role `runtime_asset`), not here;
	 * answering "is this image still needed" from JSON would need a parser that silently returns an
	 * empty list when the contract changes (`db/tables/story-media.ts` header).
	 *
	 * `assetId` is `media.id`, not a URL; freezing an address would tie every snapshot to the
	 * deployment's origin and path rules.
	 *
	 * `[]` is the correct default: runtimes published before this column had no managed images (no
	 * authoring surface could bind a logical reference), so there is no backfill.
	 */
	managed_assets: jsonb("managed_assets").notNull().default(sql`'[]'::jsonb`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
