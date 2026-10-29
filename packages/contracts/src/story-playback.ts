import { z } from "zod";
import { StoryChatSeedDto } from "./chat.ts";
import { RuntimeManagedAssetKindSchema } from "./story-runtime.ts";

/**
 * Unified playback response: how the story should be opened now. The old route (GET
 * /v2/stories/:id/play) keeps returning one StoryChatSeedDto unchanged. The new route (GET
 * /v2/stories/:id/playback) returns the discriminated union in this file.
 *
 * The old route is not changed, although that would be shorter. Web, iOS, and Android update
 * independently, so every deployed client would break at once and show 'this story cannot be
 * opened'. The old route keeps returning a chat snapshot even for runtime stories, as an
 * intentional fallback.
 *
 * Authorization goes through the same gate as the old route. The response carries the story's
 * content, so no check is loosened: creator and collector permanent access, temporary access from
 * `Cattower`, the adult gate, operator hiding, blocks, and existence hiding all apply. No second
 * authorization path is added.
 */

export const STORY_PLAYBACK_VERSION = 1;

/**
 * The version exists because installed apps live a long time, not because the envelope is stored. A
 * client that receives an unknown version must not try to run it; it should show an update-the-app
 * message instead.
 */
export const StoryPlaybackDto = z.discriminatedUnion("kind", [
	z.object({
		version: z.literal(STORY_PLAYBACK_VERSION),
		kind: z.literal("chat"),
		seed: StoryChatSeedDto,
	}),
	z.object({
		version: z.literal(STORY_PLAYBACK_VERSION),
		kind: z.literal("runtime"),
		/** Compiled runtime artifact. The runtime host validates it again before execution. */
		artifact: z.unknown(),
		/**
		 * A product UX value, not a security authority: the host's capability table decides what can
		 * actually be called. The list comes first because works that use generation must show the
		 * trusted AI disclosure before anything else. Creators do not declare it (usesGeneration: false
		 * would allow a charge with no disclosure). It is derived from the server's compiled graph.
		 */
		capabilities: z.array(z.enum(["generation"])),
		/**
		 * Logical-name image bindings, a snapshot fixed at publish time. asset("characters/sena/smile")
		 * resolves to { path, assetId }, and the player's resolver builds the RowCat media address from
		 * assetId. Bindings live here rather than in the artifact because they are a publish decision,
		 * not a compile result. Replacing a picture changes no source. Putting bindings in the artifact
		 * would make the compiler know the media store, or force the server to rewrite compile output so
		 * that sourceHash no longer matches the stored bytes. No URL is stored: freezing an address would
		 * tie every snapshot to the deployment's origin and path rules. Media ids stay valid when
		 * addresses change, and only the SDK builds addresses (media.url). The list is emitted only
		 * inside an already authorized playback response. A separate asset-list endpoint would let anyone
		 * read a private work's picture list without playback rights.
		 */
		managedAssets: z
			.array(
				z.object({
					path: z.string(),
					assetId: z.string(),
					/**
					 * Absence means image. Snapshots published before this field existed have no key, and at that
					 * time images were the only managed assets. Old snapshots are not rewritten, since that would
					 * create a way to alter a published work without republishing. The default is applied on read.
					 */
					kind: RuntimeManagedAssetKindSchema.optional(),
				}),
			)
			/**
			 * Runtimes published before this field have no bindings, which means no managed images. Nothing
			 * was lost, because there was no authoring surface for binding logical references at that time.
			 * The rule matches the absent remote asset list.
			 */
			.default([]),
	}),
]);
export type StoryPlaybackDto = z.infer<typeof StoryPlaybackDto>;

/**
 * Capability families a runtime publication may declare. Only capabilities that are implemented now
 * are listed.
 */
export const STORY_RUNTIME_CAPABILITIES = ["generation"] as const;
export type StoryRuntimeCapability =
	(typeof STORY_RUNTIME_CAPABILITIES)[number];
