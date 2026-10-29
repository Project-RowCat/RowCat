import { z } from "zod";

/**
 * Chat protocol: replayable work snapshots and the generation stream.
 *
 * This file holds only the shapes that cross the wire. Local room and message records do not belong
 * here; they are owned by @rowcat/chat. Local records are device-owned persistent structures, while
 * this file carries values exchanged with the server. Mixing them would make every local schema
 * change disturb the HTTP contract, and a server field addition would turn already-stored room
 * records into contract violations.
 *
 * Two parts:
 * 1. StoryChatSeedDto: the play snapshot, received once and stored in a local room.
 * 2. ChatGenerationRequest and ChatStreamEvent: the generation request and stream exchanged
 *    every turn.
 */

/**
 * Play payload schema version. It matters because the payload stays on the user's device for a long
 * time.
 *
 * Rooms keep the shape they were created with in IndexedDB and may open months later, after the
 * server's story schema has changed. Relying on 'whatever fields Story had then' would leave no way
 * to read them. An explicit version boundary gives a migration somewhere to attach.
 *
 * When the format changes, do not edit this constant. Add a v2 schema beside it and make the reader
 * a union. Only v1 exists now, so it is a literal.
 */
export const CHAT_SEED_VERSION = 1;

/**
 * Character card. If the free-form prompt is set, that text becomes the card body instead of the
 * structured fields. This is legacy behavior, kept as is.
 *
 * The two forms are not merged, because a creator who wrote a free-form prompt has already
 * completed the card in their own format. Appending fields such as '- personality:' would break it.
 */
export const ChatSeedCharacterDto = z.object({
	name: z.string().default("Unnamed"),
	description: z.string().default(""),
	personality: z.string().default(""),
	speechStyle: z.string().default(""),
	exampleDialogue: z.string().default(""),
	/** Free-form prompt. When non-empty, this text replaces the structured fields as the card body. */
	prompt: z.string().default(""),
});
export type ChatSeedCharacterDto = z.infer<typeof ChatSeedCharacterDto>;

/** Persona the story proposes for the user to play. Null when absent. */
export const ChatSeedPersonaDto = z.object({
	name: z.string(),
	description: z.string().default(""),
});
export type ChatSeedPersonaDto = z.infer<typeof ChatSeedPersonaDto>;

/**
 * Lore injection position.
 *
 * The legacy at_depth option (inserting between history messages) is not carried. That position
 * belongs to a separate insertion rule (depth, group, and secondary matching) that lies outside
 * this slice and is handled by the context engine. Carrying only the position would leave a field
 * the payload has but the assembler ignores, so the creator's placement would silently vanish.
 */
export const CHAT_LORE_POSITIONS = [
	"system_top",
	"system_bottom",
	"before_history",
] as const;
export const ChatLorePosition = z.enum(CHAT_LORE_POSITIONS);
export type ChatLorePosition = z.infer<typeof ChatLorePosition>;

/**
 * A lore entry: a setting injected into the prompt when its keywords match or when it is constant.
 *
 * The trigger logic is a pure function in @rowcat/chat. The contract carries only the values that
 * logic reads.
 */
export const ChatSeedLoreDto = z.object({
	/**
	 * Primary trigger keys, matched partially and case-insensitively. If the list is empty and the
	 * entry is not constant, it never fires.
	 */
	keys: z.array(z.string()).default([]),
	content: z.string().default(""),
	constant: z.boolean().default(false),
	position: ChatLorePosition.default("system_bottom"),
	/** Priority within the same position. Higher values come first. */
	order: z.number().int().default(0),
});
export type ChatSeedLoreDto = z.infer<typeof ChatSeedLoreDto>;

export const ChatSeedStartSceneDto = z.object({
	title: z.string().default("Start"),
	content: z.string().default(""),
});
export type ChatSeedStartSceneDto = z.infer<typeof ChatSeedStartSceneDto>;

/**
 * Limits for scene images. The server is the final authority, and the screen shows the same values
 * in advance.
 *
 * `trigger` is short because it is a word that appears in the body. A sentence would only match if
 * the model reproduced it verbatim, which practically never happens, and the creator would conclude
 * that a feature they enabled was broken.
 */
export const CHAT_SCENE_IMAGE_LIMITS = {
	/**
	 * Length limit for a trigger line, counted in characters rather than code points (zod's max counts
	 * characters).
	 */
	trigger: 40,
	perStory: 40,
	/** Length limit for an asset reference. Server-issued media ids are 32-character hex strings. */
	assetId: 64,
} as const;

/**
 * Characters a trigger may not contain. This is a matter of syntax, not preference.
 *
 * A token has the form `[img:<trigger>]`, so a ']' in the trigger would make the token unable to
 * end. Newlines are excluded for the same reason: the parser reads tokens within one line only, and
 * allowing a token to span lines would let one bracket swallow two paragraphs.
 */
export const CHAT_SCENE_TRIGGER_PATTERN = /^[^\]\n\r]+$/;

/**
 * A scene image is only a server-issued media id and the trigger word that calls it.
 *
 * Bytes are not stored here. The legacy dataUrl grew snapshots to several MB, copied the same image
 * into every room record, and inflated about 1.8x when synced (base64 inside base64). Bytes travel
 * only through GET /v2/media/:id, and the SDK builds that URL.
 *
 * assetId is required because a row with neither a reference nor an image would display nothing
 * while still counting as an image in the creator's list.
 */
export const ChatSeedSceneImageDto = z.object({
	/** Matched case-insensitively when the word appears in the body. It is also the token's name. */
	trigger: z
		.string()
		.trim()
		.min(1)
		.max(CHAT_SCENE_IMAGE_LIMITS.trigger)
		.regex(CHAT_SCENE_TRIGGER_PATTERN),
	/** Server-issued media id. It is a reference, not the image bytes. */
	assetId: z.string().min(1).max(CHAT_SCENE_IMAGE_LIMITS.assetId),
});
export type ChatSeedSceneImageDto = z.infer<typeof ChatSeedSceneImageDto>;

/**
 * A playable story snapshot: the body of GET /stories/:id/play and the value stored in a local
 * room.
 *
 * Kept separate from StoryDto (discovery metadata) on purpose. Gallery cards do not need scenarios,
 * character cards, or lore, which are far larger than metadata. Merging them would make each card
 * list several MB, and browsing a story would become the same request as receiving it, so
 * prefetching would leak the body.
 *
 * Included: the fields that affect generation and the fields the play screen renders. sceneImages
 * was absent for a while only because no play UI drew it. Cover art and BGM are absent because the
 * cover has its own asset and BGM is not a product feature. Optimization pack keys and model
 * settings are absent because they belong to room settings, not to the story.
 */
export const StoryChatSeedDto = z.object({
	/**
	 * The schema version. Because it is a literal, this schema accepts only v1; a future v2 is read
	 * through a union.
	 */
	version: z.literal(CHAT_SEED_VERSION),
	/**
	 * Source story id, which records provenance. After acquisition it is not the source of truth for
	 * room content.
	 */
	storyId: z.string(),
	title: z.string(),
	tagline: z.string().default(""),
	/**
	 * The story's rating. This value, not the member's setting, is the primary basis for the safety
	 * guard. An all-ages story stays all-ages even for a member who has passed adult verification.
	 */
	adult: z.boolean(),
	/** Prompt-protected copy. Product policy: creative prompts are never shown on screen. */
	promptProtected: z.boolean(),
	scenario: z.string().default(""),
	/**
	 * The opening scene is folded into the system prompt (@rowcat/chat) rather than sent as the first
	 * history message. The opening sets the room's voice, point of view, and pacing more strongly than
	 * anything else. As a regular message, it would drop out of context once history windowing moved
	 * past it.
	 */
	firstScene: z.string().default(""),
	playGuide: z.string().default(""),
	persona: ChatSeedPersonaDto.nullable().default(null),
	characters: z.array(ChatSeedCharacterDto).default([]),
	lore: z.array(ChatSeedLoreDto).default([]),
	/**
	 * Opening-scene candidates. There is no selection UI yet, but the snapshot carries them so rooms
	 * are self-contained. A room created before a selection UI exists would otherwise lack the
	 * candidates and miss the feature. If firstScene is empty, the assembler uses the first candidate.
	 */
	startScenes: z.array(ChatSeedStartSceneDto).default([]),
	/**
	 * Scene images that the body's `[img:<trigger>]` tokens refer to.
	 *
	 * `.default([])` is the entire compatibility story for this field. Rooms already stored on devices
	 * have no such key, and that absence is correct because those stories had no scene images. Bumping
	 * the schema version would make old devices reject the whole seed, so one image would block the
	 * story from opening at all. Gallery metadata (StoryDto) does not carry these images: cards do not
	 * need them, and browsing must not become the same request as receiving.
	 */
	sceneImages: z
		.array(ChatSeedSceneImageDto)
		.max(CHAT_SCENE_IMAGE_LIMITS.perStory)
		.default([]),
});
export type StoryChatSeedDto = z.infer<typeof StoryChatSeedDto>;

/**
 * The shape before validation, where fields with defaults may be omitted. Writers use it
 * (development fixtures and production data migrations). Building an output-typed value would
 * require every defaulted field, which is the opposite of why the schema has defaults.
 */
export type StoryChatSeedInput = z.input<typeof StoryChatSeedDto>;

/**
 * Failure codes for obtaining a play payload. Most unplayable stories return 404, so a hidden story
 * and a missing story look identical. The codes carry two outcomes:
 * - unavailable: the story is accessible but its payload does not exist yet (awaiting migration).
 *   Waiting is the only option.
 * - invalid: the stored payload does not match the contract. The failure is shown, not papered
 *   over.
 *
 * A third outcome, story_purchase_required, existed when viewing did not imply possession. Once
 * ownership was removed, play access became a single view predicate, and that outcome went with it.
 */
export const STORY_PLAY_ERROR_CODE = {
	/**
	 * The story is accessible, but its play payload does not exist yet (awaiting migration). Waiting
	 * is the only thing the user can do.
	 */
	unavailable: "story_play_unavailable",
	/**
	 * The stored payload does not match the contract. Failing visibly is preferred over silently
	 * inventing values.
	 */
	invalid: "story_play_invalid",
} as const;
export type StoryPlayErrorCode =
	(typeof STORY_PLAY_ERROR_CODE)[keyof typeof STORY_PLAY_ERROR_CODE];

/**
 * Public identity of RowCat-managed models: the vocabulary that crosses the wire. Only ids are
 * here, with no labels, ordering, or upstream slugs.
 *
 * The chain is: this public id, then the server's routing registry
 * (apps/api/src/services/generation/managed-models.ts), then the OpenRouter upstream slug, which
 * never leaves the server.
 *
 * The contract owns this vocabulary so the server's validation and the client's types share one
 * list. Otherwise the browser could send arbitrary strings and turn the managed path into a proxy.
 * Labels stay with the server-owned catalog (GET /v2/chat/models). Upstream slugs such as
 * `openai/gpt-5.6-luna` must never reach the browser, or the server's allowlist check would mean
 * nothing.
 */
export const ROWCAT_MANAGED_MODELS = [
	"gpt-6-astra",
	"gpt-6.1-sol",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-haiku-4-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-sonnet-4-5",
	"gemini-3.8-flash",
	"gemini-3.7-flash",
	"gemini-3.6-flash",
	"gemini-3.5-flash",
	"gemini-3.5-flash-lite",
	"deepseek-v4-pro",
	"deepseek-v4.1-flash",
	"deepseek-v4-flash",
	"mimo-v2.6-flash",
	"glm-5.3",
	"glm-5.3-flash",
	"glm-5.2",
] as const;
export const RowCatManagedModel = z.enum(ROWCAT_MANAGED_MODELS);
export type RowCatManagedModel = z.infer<typeof RowCatManagedModel>;

const MANAGED_MODEL_SET: ReadonlySet<string> = new Set(ROWCAT_MANAGED_MODELS);

/**
 * Whether a stored value still belongs to the managed vocabulary. Used only at the read boundary.
 *
 * A device may hold a preference from an older version. Passing an unknown name through would send
 * it in a request, and the server would reject it with a 400 during the next conversation rather
 * than when the setting was changed.
 */
export const isRowCatManagedModel = (
	value: unknown,
): value is RowCatManagedModel =>
	typeof value === "string" && MANAGED_MODEL_SET.has(value);

/**
 * The managed model for a member who has chosen nothing. This is a product decision, not deployment
 * configuration.
 *
 * It was once an upstream slug in an environment variable (CHAT_MODEL), which worked while each
 * deployment had one managed model. With member choice, the default would differ per deployment, so
 * code could not state what it is, and the value would be routing information rather than a public
 * id.
 *
 * It is not copied into preference records. A copy would pin existing members to the old model
 * whenever this value changes (see PRODUCT_GENERATION_TARGET in @rowcat/chat).
 */
export const DEFAULT_MANAGED_MODEL: RowCatManagedModel = "deepseek-v4-pro";

/**
 * Reasoning effort, with four product-defined levels.
 *
 * Provider parameters are not exposed directly, for the same reason as response length. The
 * provider fields differ in meaning and range: reasoning_effort is an enum, while
 * thinking.budget_tokens and thinkingConfig.thinkingBudget are token counts. Putting any one of
 * them in the contract would make saved settings meaningless on providers that do not support it.
 *
 * The mapping to each provider's parameter lives in one table per execution boundary:
 * - managed: apps/api/src/services/generation/chat.ts, to OpenRouter `reasoning: { effort }`
 * - BYO: apps/web/src/lib/generation/*.ts, to per-provider token budgets
 *
 * Token budgets are not sent here. Their ceilings differ by model and interact with response limits
 * (Anthropic requires max_tokens > budget_tokens), so users do not pick them.
 *
 * `minimal` exists because it is not off. OpenAI-family models still reason at that level, only
 * minimally. A value meaning 'no reasoning' would be false for models that cannot disable
 * reasoning. 'Not set' is not in this vocabulary; it is `null` in the preference (@rowcat/chat).
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export const ReasoningEffortDto = z.enum(REASONING_EFFORTS);
export type ReasoningEffortDto = z.infer<typeof ReasoningEffortDto>;

const REASONING_EFFORT_SET: ReadonlySet<string> = new Set(REASONING_EFFORTS);

/**
 * Whether a stored value is still in this vocabulary. Used only at the read boundary, for the same
 * reason as response length. An old preference could hold a level that no longer exists, and
 * passing it through would send it in the request.
 */
export const isReasoningEffort = (
	value: unknown,
): value is ReasoningEffortDto =>
	typeof value === "string" && REASONING_EFFORT_SET.has(value);

/**
 * Whether this catalog entry offers user-adjustable reasoning. The catalog supplies this flag, and
 * that is the whole boundary of this slice.
 *
 * If the screen inferred it from the model id or provider name (for example model.includes('gpt')),
 * every new model would require frontend edits. A screen that missed one would show an option the
 * server rejects, and the failure would surface only after the user sent a message. The server
 * holds authority over capability.
 *
 * `reasoning: null` means 'RowCat provides no adjustable reasoning setting for this target.' It
 * does not mean 'this model does not reason', which is a fact RowCat cannot know. Such an entry
 * gets no reasoning row at all.
 */
export const ModelReasoningDto = z
	.object({
		/** The efforts the user can choose for this target. Catalog order is display order. */
		efforts: z.array(ReasoningEffortDto).min(1),
		/**
		 * The default when nothing is chosen, or when the inherited value is unsupported by this target.
		 *
		 * This axis is distinct from the product default (PRODUCT_REASONING_EFFORT in @rowcat/chat). That
		 * one answers 'what does the user want when they have not chosen?' This one answers 'what should
		 * run if this model cannot do the chosen level?' Folding them together would make changing the
		 * product default also change every model's runtime default.
		 */
		defaultEffort: ReasoningEffortDto,
	})
	/**
	 * A default outside the efforts list is a contract violation. Such an entry would be normalized to
	 * an unsupported level on every run, and the provider would reject the request. Failing the schema
	 * early is better.
	 */
	.refine((value) => value.efforts.includes(value.defaultEffort), {
		message: "The default reasoning effort must be in the supported list.",
		path: ["defaultEffort"],
	});
export type ModelReasoningDto = z.infer<typeof ModelReasoningDto>;

/**
 * The lineage: which family of narration body the target reads. 'standard' and 'reduced' are
 * product vocabulary.
 *
 * The aliases (hedge, thumbs, deepseek) are body file names and the names of original works.
 * Carrying them here would cause two problems: the screen would show words users cannot interpret,
 * and renaming a body file would break clients already shipped. The alias-to-lineage table lives in
 * one place, narration.ts in @rowcat/chat. This matches how the routing session key `session_id` is
 * kept from leaving the server.
 *
 * - standard: general lineage, with two density levels.
 * - reduced: for models that follow reasoning notation less well; one density level.
 */
export const PROMPT_PACK_LINEAGES = ["standard", "reduced"] as const;
export const PromptPackLineageDto = z.enum(PROMPT_PACK_LINEAGES);
export type PromptPackLineageDto = z.infer<typeof PromptPackLineageDto>;

/**
 * Narration density: how finely the target describes. The two levels, and the names light and rich,
 * are product decisions. Token counts are not exposed, for the same reason as response length: the
 * number is not the user's vocabulary, and the same number means a different amount on another
 * model.
 */
export const PROMPT_PACK_DENSITIES = ["light", "rich"] as const;
export const PromptPackDensityDto = z.enum(PROMPT_PACK_DENSITIES);
export type PromptPackDensityDto = z.infer<typeof PromptPackDensityDto>;

/**
 * Whether this catalog entry accepts a narration pack; null if not. The reasoning is the same as
 * for the reasoning field above.
 *
 * The legacy client checked model.toLowerCase().includes('haiku'), and that one line was the entire
 * gate for the feature. With 25 models, that approach forces a frontend edit for every model added,
 * and a missed spot shows a setting that does nothing. The server holds authority over capability.
 * null means 'RowCat provides no narration pack for this target', not 'this model's narration is
 * poor'.
 */
export const ModelPromptPackDto = z
	.object({
		/**
		 * The lineage this target reads. The screen does not display it; it uses the value only to choose
		 * the body.
		 */
		lineage: PromptPackLineageDto,
		/**
		 * The densities this target can actually take. If there is only one, the screen shows no control.
		 *
		 * This is an array rather than being derived from lineage. Derivation would require the same
		 * table on both server and screen, and it would fail on the first exception. There already is
		 * one: Claude Haiku models use 'standard' lineage but support a single density, and a derivation
		 * has no place to express that.
		 */
		densities: z.array(PromptPackDensityDto).min(1),
	})
	/** A list containing the same density twice would render the same choice twice on screen. */
	.refine((value) => new Set(value.densities).size === value.densities.length, {
		message: "The density list cannot contain duplicates.",
		path: ["densities"],
	});
export type ModelPromptPackDto = z.infer<typeof ModelPromptPackDto>;

/**
 * Request size limits: the sizes the server accepts. Both sides must see the same values.
 *
 * The client trims during assembly, but the server does not trust that and validates again. If each
 * side kept its own numbers, changing one would send valid conversations to a 400.
 */
export const CHAT_MAX_SYSTEM_CHARS = 200_000;
export const CHAT_MAX_MESSAGE_CHARS = 40_000;
export const CHAT_MAX_MESSAGES = 200;
export const CHAT_MAX_OUTPUT_TOKENS = 8_192;
export const CHAT_DEFAULT_OUTPUT_TOKENS = 2_048;

/**
 * Tool calls: the model may pause mid-response to call a tool. The device runs the tool, and the
 * next request carries the result.
 *
 * The server only forwards tool declarations upstream and returns calls. It never executes them,
 * because the device holds the data tools read (lore, memory, characters). Managed and BYO paths
 * share this neutral vocabulary, so each provider adapter absorbs its own wire shape. Those shapes
 * differ: OpenAI-compatible tool_calls, Anthropic tool_use blocks, and Gemini functionCall parts.
 * Anthropic also streams partial JSON.
 *
 * Absent on purpose: parallel calls, forced tool choice, argument streaming, nested parameters, and
 * server-run tools. Each can be added later as a widening change, but narrowing after shipping
 * would break clients. Old clients never see this axis, because the SDK frame reader throws on
 * unknown events.
 */

/**
 * The maximum number of tools one request may declare. The declarations are part of the prompt, so
 * they count as input tokens on every turn.
 */
export const CHAT_MAX_TOOLS = 8;
export const CHAT_MAX_TOOL_DESCRIPTION_CHARS = 1_000;
export const CHAT_MAX_TOOL_PARAMETERS = 6;
export const CHAT_MAX_TOOL_PARAMETER_CHOICES = 24;
/**
 * Upper bound on one argument string. It stops the model from pushing long text through tool
 * arguments.
 */
export const CHAT_MAX_TOOL_ARGUMENT_CHARS = 2_000;
/**
 * Upper bound on one tool result, which is smaller than the message limit. Results are
 * machine-generated, so the limit is the cost: a full lore or memory dump would be resent every
 * turn, because results stay in history. Trimming is the tool layer's job; the contract only
 * rejects oversized requests.
 */
export const CHAT_MAX_TOOL_RESULT_CHARS = 8_000;
/**
 * Upper bound on the provider state attached to one call. This differs from the result limit: the
 * provider produced these opaque bytes, so truncating them makes the request a 400. Omitting the
 * state when it is too large is the only option, and that case matches the time before this axis
 * existed. The cap is sized for a signature plus a few encrypted reasoning blocks, and it is needed
 * because the state is resent on each round trip. The model does not read it, since it is not
 * prompt content.
 */
export const CHAT_MAX_TOOL_PROVIDER_STATE_CHARS = 16_000;
/**
 * The round-trip cap for tool calls within one turn. The server cannot enforce it, because each
 * round trip is an independent request and the server only sees a first request each time. The
 * constant exists so both apps use the same number. The only server-side ceiling is per-member rate
 * limiting. It belongs in the contract for that reason alone, since per-app values would let the
 * same conversation run different counts on different devices.
 */
export const CHAT_MAX_TOOL_ROUND_TRIPS = 3;

/**
 * The shape of tool and parameter names: the intersection of the three providers. Restricting to
 * lowercase snake case means no adapter renames anything. A renaming step would need a map to match
 * returned names against declared ones, and a wrong map would silently stop tools from being
 * called.
 */
export const CHAT_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
export const ChatToolName = z
	.string()
	.regex(
		CHAT_TOOL_NAME_PATTERN,
		"Tool names must start with a lowercase letter and use up to 48 lowercase letters, digits and underscores.",
	);
export type ChatToolName = z.infer<typeof ChatToolName>;

/**
 * Parameter types: three scalars. Arrays and objects are absent on purpose. Adding them would mean
 * partly reimplementing JSON Schema (nesting depth, additionalProperties, oneOf), and each provider
 * interprets that half differently. Flat scalars mean the same thing on all three.
 */
export const CHAT_TOOL_PARAMETER_TYPES = [
	"string",
	"number",
	"boolean",
] as const;
export const ChatToolParameterType = z.enum(CHAT_TOOL_PARAMETER_TYPES);
export type ChatToolParameterType = z.infer<typeof ChatToolParameterType>;

/** One tool parameter. Each adapter translates it into its provider's schema shape. */
export const ChatToolParameter = z.object({
	name: ChatToolName,
	type: ChatToolParameterType,
	/** The description the model reads. It is product-written copy, not creative content. */
	description: z.string().max(CHAT_MAX_TOOL_DESCRIPTION_CHARS).default(""),
	required: z.boolean().default(false),
	/**
	 * Constrains a value to this list; an empty list means no constraint. It is named 'choices' rather
	 * than 'enum' on purpose. enum is JSON Schema vocabulary, and adding minimum or pattern beside it
	 * would drift the object toward a partial JSON Schema. It applies only to string parameters;
	 * adapters ignore it for other types.
	 */
	choices: z
		.array(z.string().min(1).max(CHAT_MAX_TOOL_ARGUMENT_CHARS))
		.max(CHAT_MAX_TOOL_PARAMETER_CHOICES)
		.default([]),
});
export type ChatToolParameter = z.infer<typeof ChatToolParameter>;

/**
 * The declaration of one tool. The description is required because it is the only basis on which
 * the model chooses a tool. If it could be empty, the model would choose by name alone, and the
 * failure would be silent (wrong calls or no calls).
 *
 * These sentences count as dependent application content under the safety policy, the same class as
 * creator instructions, so they cannot rank above the guard.
 */
export const ChatToolDeclaration = z
	.object({
		name: ChatToolName,
		description: z.string().min(1).max(CHAT_MAX_TOOL_DESCRIPTION_CHARS),
		parameters: z
			.array(ChatToolParameter)
			.max(CHAT_MAX_TOOL_PARAMETERS)
			.default([]),
	})
	/**
	 * Two parameters with the same name would be resolved differently by each provider, so such a
	 * declaration is rejected.
	 */
	.refine(
		(tool) =>
			new Set(tool.parameters.map((p) => p.name)).size ===
			tool.parameters.length,
		{
			message: "Parameter names cannot repeat.",
			path: ["parameters"],
		},
	);
export type ChatToolDeclaration = z.infer<typeof ChatToolDeclaration>;

/**
 * The identifier of one call, which is opaque. It is used only to pair a result with its call
 * (Anthropic's tool_use_id, OpenAI's tool_call_id).
 *
 * Providers usually issue it, but Gemini does not. Its adapter generates the value and strips it
 * again when returning the result, so only the format is constrained here. The id must not carry
 * room, message, or member ids, because it goes upstream (the same rule as RoutingSessionId).
 */
export const CHAT_TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const ChatToolCallId = z
	.string()
	.regex(
		CHAT_TOOL_CALL_ID_PATTERN,
		"Tool call ids must be up to 128 letters, digits, underscores and hyphens.",
	);
export type ChatToolCallId = z.infer<typeof ChatToolCallId>;

/**
 * Argument values, one per parameter type. null and undefined are expressed as the absence of a
 * key.
 *
 * This does not mean a model sending null is rejected. Many models write null to mean absent, and
 * treating that as a protocol error would kill the whole turn. The correct implementation accepts
 * null on the call side, and the tool layer reads it as absence.
 */
export const ChatToolArgumentValue = z.union([
	z.string().max(CHAT_MAX_TOOL_ARGUMENT_CHARS),
	z.number().finite(),
	z.boolean(),
]);
export type ChatToolArgumentValue = z.infer<typeof ChatToolArgumentValue>;

/**
 * One call made by the model. Arguments are a Record because declarations are flat.
 *
 * Validation happens elsewhere: this layer checks shape only. The holder of the declarations (the
 * tool layer in @rowcat/chat) decides whether the name is declared and whether the arguments fit. A
 * name that was never declared is not a protocol error; it is a call to refuse.
 */
export const ChatToolCall = z.object({
	id: ChatToolCallId,
	name: ChatToolName,
	/**
	 * The arguments the model passed, or null if they could not be read. {} means called with no
	 * arguments; null means something was passed but could not be read as a value.
	 *
	 * This is one slot, not two. A separate flag (argumentsUnreadable) would allow 'value present but
	 * unread', and which side wins would differ by call site. null is a type-enforced split, so every
	 * reader must handle that state.
	 *
	 * A truncated stream, a nested object, or a capitalized key are normal paths, not exceptions. The
	 * goal is to tell the model what happened and let it call again, rather than end the turn after
	 * text has already streamed. Unread arguments are not reconstructed: the assistant turn sent back
	 * contains an empty object, because inventing the original is worse. Validity is judged by the
	 * holder of the declarations (resolveChatToolCall), so arguments that pass this schema can still
	 * be refused there.
	 */
	arguments: z
		.record(ChatToolName, ChatToolArgumentValue.nullable())
		.nullable()
		.default({}),
	/**
	 * An opaque value the provider requires when it receives its own call back. This slot exists
	 * because the next request's assistant turn is rebuilt on the device (nextChatToolRequest), and
	 * the provider requires that turn to match what it originally produced. Gemini 3 returns 400 when
	 * the thought signature attached to functionCall is missing, even with thinking disabled. Without
	 * this slot, tools could not work at all on those models.
	 *
	 * Only values the device cannot read are carried: encrypted blocks such as Gemini's signature and
	 * the gateway's reasoning.encrypted. Human-readable reasoning text or summaries are not carried,
	 * because that would break the repo's rule that thought content is never stored, on the managed
	 * path included.
	 *
	 * Anthropic's extended thinking requires the original thinking block text, so this slot cannot
	 * carry it. The answer there is to drop the reasoning axis from the round-trip request
	 * (nextChatToolRequest). Only the adapters write and read this value. The tool layer ignores it,
	 * it is not rendered or logged, and it is not stored in message records. Its format is therefore
	 * capped but not constrained, since knowing the shape would bring provider reasoning vocabulary
	 * into the contract.
	 */
	providerState: z.string().max(CHAT_MAX_TOOL_PROVIDER_STATE_CHARS).optional(),
});
export type ChatToolCall = z.infer<typeof ChatToolCall>;

/**
 * The wire role. This is a different axis from the stored message role (ChatRole in
 * @rowcat/chat). 'tool' is added here and not to ChatRole, because tool results are built for this
 * one request and never persist in the conversation. If they were stored, unreadable lines would
 * appear in conversation lists, search, and copy, and the device can rebuild the value from its
 * current state.
 *
 * Adding the value breaks any Record<ChatGenerationRole, ...> table at compile time, on purpose. An
 * adapter that does not recognize a third role should fail, not silently fold it into user turns.
 */
export const ChatGenerationRole = z.enum(["user", "assistant", "tool"]);
export type ChatGenerationRole = z.infer<typeof ChatGenerationRole>;

/**
 * One message: a discriminated union by role. A single object with optional fields would allow user
 * messages carrying tool calls, and tool results with no matching call. Those combinations would
 * only fail with a 400 once they reached upstream.
 *
 * All three roles carry content on purpose, so readers of content work without narrowing. Only the
 * tool axis differs by role.
 */
export const ChatGenerationMessage = z.discriminatedUnion("role", [
	z.object({
		role: z.literal("user"),
		content: z.string().max(CHAT_MAX_MESSAGE_CHARS),
	}),
	/**
	 * The assistant turn. A toolCall means the turn ended with a tool call.
	 *
	 * Content and the call travel together because they really do arrive together: the model may write
	 * prose before calling a tool, and that prose has already been shown. The turn must stay in
	 * history so the next request is valid, since all three providers require the call-bearing
	 * assistant turn to come before the tool result.
	 */
	z.object({
		role: z.literal("assistant"),
		content: z.string().max(CHAT_MAX_MESSAGE_CHARS),
		toolCall: ChatToolCall.optional(),
	}),
	/**
	 * The tool result. callId must equal the preceding assistant turn's toolCall.id. The contract does
	 * not check that pairing, not because it cannot, but because it is the wrong place: a check across
	 * the whole array belongs to the assembler, and doing it here would duplicate the rule.
	 *
	 * Failure is also a result. If the tool throws and the message is dropped, the model never gets an
	 * answer to its call, and all three providers reject an unpaired call with a 400. So the failure
	 * is written as a sentence and sent here. This role has no success or failure axis.
	 */
	z.object({
		role: z.literal("tool"),
		callId: ChatToolCallId,
		content: z.string().max(CHAT_MAX_TOOL_RESULT_CHARS),
	}),
]);
export type ChatGenerationMessage = z.infer<typeof ChatGenerationMessage>;

/**
 * The rendering rating for this turn. The name 'mode' matters: this value is a request, not a
 * verdict.
 *
 * The client applies the same rule when it assembles the prompt from the room rating and member
 * settings (@rowcat/chat). An HTTP client that skips that assembler can still call this endpoint,
 * so the server reads this value as a floor request rather than a cap, and re-decides it from the
 * member qualification it knows.
 */
export const CHAT_GENERATION_MODES = ["all-ages", "adult"] as const;
export const ChatGenerationMode = z.enum(CHAT_GENERATION_MODES);
export type ChatGenerationMode = z.infer<typeof ChatGenerationMode>;

/**
 * The basis for the safety judgment carried by a generation request: a rating axis, not creative
 * content. It is kept apart from system on purpose. The system prompt is the creative context the
 * client assembles (world, characters, lore); this is the value the server reads to choose its
 * policy. Merging them would force the server to parse prompt text to learn the rating, and that
 * parse could be bypassed by a small wording change.
 *
 * No room or story id is sent. The server holds no rooms, and a story id is trivially dropped by a
 * hostile client, so it could not serve as verification. The value that actually caps behavior is
 * the member qualification the server reads from the session, not requestedMode below.
 */
export const ChatGenerationContext = z.object({
	requestedMode: ChatGenerationMode.default("all-ages"),
	/**
	 * Whether the content has a character read as a minor. This is the basis for enabling the minor
	 * guard at adult rating. The guard sentence itself is not carried: it is applied in one place
	 * (applyPlatformSafetyPolicy), and this value carries only the judgment that function reads. A
	 * client can claim this value or leave it out, but it could already omit the guard block before,
	 * so trust did not drop. Defaulting to false means requests from older clients still pass.
	 */
	minorCharacterPresent: z.boolean().default(false),
});
export type ChatGenerationContext = z.infer<typeof ChatGenerationContext>;

/**
 * The shape of the opaque routing key attached to one conversation. The format is narrowed because
 * the value leaves RowCat's server, where the gateway receives it as a routing hint. As a free-form
 * string, a caller could one day send room:<id> or a member id, breaking both 'the server holds no
 * room' and 'upstream cannot trace back to RowCat users'. With the vocabulary narrowed, such values
 * are rejected at the contract with a 400.
 *
 * The range covers both id generators in this repo: web crypto.randomUUID() (36 characters with
 * hyphens) and mobile Crockford base32 (26 characters). Mixing the families is normal, as
 * SyncRecordId already decided. Nothing compares this value, so it is handled as an opaque string.
 */
export const ROUTING_SESSION_ID_PATTERN = /^[0-9A-Za-z-]{16,64}$/;
export const RoutingSessionId = z
	.string()
	.regex(
		ROUTING_SESSION_ID_PATTERN,
		"Routing session ids must be 16 to 64 letters, digits and hyphens.",
	);
export type RoutingSessionId = z.infer<typeof RoutingSessionId>;

/**
 * The generation request, provider-neutral. OpenRouter, Claude, and local model body shapes are not
 * exposed. Exposing them would teach the web client about providers, and changing providers would
 * then require a client release. This is the minimal representation that any provider can be mapped
 * from.
 *
 * `system` is a single string on purpose. The legacy format split it into channels (stable, static,
 * dynamic) for cache prefixes. That split is a cost optimization, not part of the contract. If it
 * becomes necessary, the server can split it again with the assembler's rules.
 */
export const ChatGenerationRequest = z.object({
	system: z.string().max(CHAT_MAX_SYSTEM_CHARS),
	messages: z.array(ChatGenerationMessage).min(1).max(CHAT_MAX_MESSAGES),
	/** Response length cap. When omitted, the server default applies. */
	maxOutputTokens: z
		.number()
		.int()
		.min(1)
		.max(CHAT_MAX_OUTPUT_TOKENS)
		.default(CHAT_DEFAULT_OUTPUT_TOKENS),
	/**
	 * The reasoning effort for this request. null means no reasoning parameter is sent at all.
	 *
	 * It sits next to maxOutputTokens because it has the same properties: it is product vocabulary, it
	 * maps to any provider, and BYO adapters receive it too. Keeping it only in the managed type would
	 * silently drop it on the BYO path, with no visible symptom on screen.
	 *
	 * null does not mean 'use the default'. It means this request carries no reasoning parameter. A
	 * model without adjustable reasoning (reasoning: null in the catalog) and an older client without
	 * this field therefore send the same request, and both produce upstream bodies byte-identical to
	 * the pre-feature version.
	 *
	 * This is a different axis from a null in preferences ('this layer has not decided'). Inheritance
	 * finishes before this point (resolveEffectiveGeneration in @rowcat/chat), so what arrives here is
	 * an executable value. On the managed path, the server re-validates against its own registry:
	 * unsupported levels fold to the model's default, and models without adjustable reasoning drop the
	 * field entirely.
	 */
	reasoningEffort: ReasoningEffortDto.nullable().default(null),
	/**
	 * The rating request. When omitted, it is read in the most conservative way, so a client that does
	 * not know this field can never reach adult mode.
	 */
	context: ChatGenerationContext.default({
		requestedMode: "all-ages",
		minorCharacterPresent: false,
	}),
	/**
	 * The routing-affinity key for this conversation. When absent, no key is sent at all.
	 *
	 * Its meaning is one thing: these requests continue the same conversation. If the gateway knows
	 * that, it can send the next turn to the same provider endpoint as the previous turn, so the
	 * provider's prompt-prefix cache matches again. Roleplay resends a large stable prefix on every
	 * turn (safety guard, scenario, characters, lore, summary), so the hit rate is the cost.
	 *
	 * It is product vocabulary, not provider vocabulary. The server adapter decides which provider
	 * parameter it maps to (apps/api/src/services/generation/chat.ts), which is why the name is not
	 * openRouterSessionId. Changing providers should not require a client release.
	 *
	 * It is never a room, story, member, or device id. None of those have a place in this contract
	 * (see the ChatGenerationContext header), and including one would break 'the server holds no room'
	 * through a routing field. The value is an opaque random id issued when the conversation starts.
	 * Narrowing the format is the last line of defense: the two apps' id formats pass, while
	 * structured values such as room:<id> are blocked by the schema.
	 *
	 * It matters only for managed generation, but it lives here for the same reason as maxOutputTokens
	 * and reasoningEffort: it is a portable product term. If it lived only in the managed type, a BYO
	 * adapter that later needs it would have no way to receive it. BYO adapters do not read it yet,
	 * and no matching behavior is invented for that path.
	 */
	routingSessionId: RoutingSessionId.optional(),
	/**
	 * Whether this request is a continuation: the last assistant utterance is kept as a prefill, and
	 * generation resumes from there. The assembler already builds that shape without adding a nudge,
	 * but transport must know it. Providers do not treat a conversation ending in an assistant message
	 * the same way.
	 *
	 * Anthropic accepts prefill but rejects it when thinking is enabled, and it also rejects trailing
	 * whitespace in the final assistant content. Gemini requires contents to end with the model role.
	 * Through the gateway, Anthropic's constraints carry over.
	 *
	 * The message array alone cannot reliably reveal this, because a conversation can end with an
	 * assistant turn for other reasons (for example, the user spoke again after an unanswered turn,
	 * and the assembler then adds a nudge). Continuation is an intent, so it is sent rather than
	 * inferred. It is product vocabulary, so BYO adapters receive it too, and each adapter keeps its
	 * provider-specific handling. Default false keeps the old meaning for clients that do not know
	 * this field.
	 */
	continuation: z.boolean().default(false),
	/**
	 * The tools the model may call in this conversation. An empty array means the axis is absent.
	 *
	 * When empty, no tools key is created upstream (the same rule as reasoningEffort: null), so a
	 * request from a client without this axis produces an upstream body byte-identical to the
	 * pre-feature one. Its stream has no tool_call frame. The SDK frame reader throws on unknown
	 * events, so this symmetry is the entire compatibility story.
	 *
	 * Declaration is not permission to execute. The server forwards the list upstream and runs
	 * nothing. If the model calls a name not in the list, that is not a protocol error; the tool layer
	 * rejects the call. A declared tool also does not mean it can run on this device.
	 *
	 * The axis is neutral, so BYO adapters receive it too. The tools read lore, memory, and
	 * characters, which live on the device, so both paths execute in the same place. Limiting this to
	 * the managed type would silently remove the feature from BYO conversations.
	 */
	tools: z.array(ChatToolDeclaration).max(CHAT_MAX_TOOLS).default([]),
});
export type ChatGenerationRequest = z.infer<typeof ChatGenerationRequest>;

/**
 * The managed generation request: the provider-neutral request plus the one managed model chosen.
 *
 * Why a separate type: BYO adapters accept ChatGenerationRequest as-is, so provider concepts must
 * not enter it. A managed model identity has meaning only to the RowCat API. Adding it to the
 * common request would create a field that BYO adapters ignore, and that field would later read as
 * a provider-selection slot, turning this endpoint into an arbitrary model proxy.
 *
 * The enum type is the substance of that defense. Neither openai/gpt-5.6-luna nor anthropic-byo can
 * be expressed here; the contract blocks them before the server needs code to reject them.
 *
 * The field is required. If it were optional, the server would have to pick a default, and a client
 * that forgot the field would silently generate with a model other than the one the user chose. The
 * product default belongs to the preference resolver (resolveEffectiveGeneration in @rowcat/chat),
 * and its result must be sent explicitly here.
 */
export const ManagedChatGenerationRequest = ChatGenerationRequest.extend({
	/** The public identity of the managed model the user chose, not an upstream slug. */
	model: RowCatManagedModel,
});
export type ManagedChatGenerationRequest = z.infer<
	typeof ManagedChatGenerationRequest
>;

/**
 * The room's share of a generation request for a protected story. The story's share (the seed) is
 * not here.
 *
 * The shape of this request is the entire feature. Protected prompt fields (scenario, play guide,
 * character cards, lore) are not sent to the device, since /play returns them blank, so the client
 * cannot assemble the system prompt. The client sends only the assembler arguments it holds. The
 * server reads the currently published seed and builds the prompt with the same assembler
 * (buildChatGenerationRequest in @rowcat/chat).
 *
 * For that reason this contract has no system field. If one existed, a client could fill it, and
 * this path would be indistinguishable from ordinary generation. Neither a seed nor a story id
 * appears in the body; the path names the story. The rating is only a request, and the server
 * re-decides it from the story rating and the member qualification.
 *
 * The size bounds are in bytes. The exact limit, counted in code points, lives in @rowcat/chat;
 * this is a looser UTF-16 limit.
 */
export const StoryChatAssemblyMessage = z
	.object({
		role: z.enum(["user", "assistant"]),
		speaker: z.string().max(200),
		content: z.string().max(CHAT_MAX_MESSAGE_CHARS),
	})
	.strict();
export type StoryChatAssemblyMessage = z.infer<typeof StoryChatAssemblyMessage>;

/**
 * A memory line, carrying only the fields the assembler reads when selecting and building. Pinning,
 * source, last-modified time, and id are the values that decide what fits in the budget
 * (sortMemories). If the device pre-selected and sent strings, the same decision would live in two
 * places, and when they drifted, one room would get different memories depending on the path.
 */
export const StoryChatAssemblyMemory = z
	.object({
		id: z.string().min(1).max(128),
		content: z.string().max(4_000),
		pinned: z.boolean(),
		source: z.enum(["user", "auto"]),
		updatedAt: z.string().max(64),
	})
	.strict();
export type StoryChatAssemblyMemory = z.infer<typeof StoryChatAssemblyMemory>;

export const StoryChatGenerationRequest = z
	.object({
		/** Stored history, in ascending order. The server assembler trims the window again. */
		messages: z.array(StoryChatAssemblyMessage).max(CHAT_MAX_MESSAGES),
		/** Input not yet saved. It is normally absent. */
		userInput: z.string().max(CHAT_MAX_MESSAGE_CHARS).optional(),
		memories: z.array(StoryChatAssemblyMemory).max(500).default([]),
		summary: z.string().max(8_000).optional(),
		/**
		 * This conversation's overrides, with the same fields as the room record. When absent, the
		 * story's suggestion applies.
		 */
		room: z
			.object({
				persona: z
					.object({
						name: z.string().max(200),
						description: z.string().max(8_000),
					})
					.strict()
					.nullable()
					.optional(),
				userNote: z.string().max(8_000).optional(),
				intensity: z.enum(["softened", "intense"]).optional(),
			})
			.strict()
			.default({}),
		/** The characters introduced in this conversation, in display order. */
		characters: z
			.array(
				z
					.object({
						name: z.string().max(200),
						prompt: z.string().max(8_000),
					})
					.strict(),
			)
			.max(50)
			.default([]),
		/**
		 * The narration pack: the body already fetched and its judgment. The device sends it because
		 * packs are source works and not secret. The server holds no pack bodies (@rowcat/prompt-packs).
		 */
		narration: z
			.object({ text: z.string().max(60_000), writesUser: z.boolean() })
			.strict()
			.nullable()
			.optional(),
		maxOutputTokens: ChatGenerationRequest.shape.maxOutputTokens,
		reasoningEffort: ChatGenerationRequest.shape.reasoningEffort,
		continuation: z.boolean().default(false),
		routingSessionId: RoutingSessionId.optional(),
		/**
		 * The rating request. The server re-decides it from the story rating and the member
		 * qualification.
		 */
		requestedMode: ChatGenerationMode.default("all-ages"),
		model: RowCatManagedModel,
	})
	.strict();
export type StoryChatGenerationRequest = z.infer<
	typeof StoryChatGenerationRequest
>;
export type StoryChatGenerationRequestInput = z.input<
	typeof StoryChatGenerationRequest
>;

/**
 * Stream events: the protocol RowCat owns.
 *
 * Provider SSE chunks are not passed through, for two reasons. Changing providers would break the
 * screen if chunks were forwarded. Provider chunks also carry things that must not be emitted:
 * routing details, cost, and internal error text. The server translates them once, here.
 *
 * `usage` is a separate event so it can be stored. The client keeps it on the assistant message,
 * and that copy means the same thing on managed and BYO paths.
 *
 * The cache fields (cachedInputTokens, cacheWriteInputTokens) are here for the same reason. Vendor
 * names do not cross the wire: cache_read_input_tokens, cached_tokens, and cachedContentTokenCount
 * are all mapped by the adapters to the three names below. Vendor names in the contract would mean
 * that adding a provider widens the contract, and stored messages would hold a mix of vendor
 * vocabularies.
 */
export const ChatStreamEvent = z.discriminatedUnion("type", [
	z.object({ type: z.literal("delta"), text: z.string() }),
	z.object({
		type: z.literal("usage"),
		/**
		 * Total input tokens the model processed for this request, including the portion read from cache.
		 *
		 * The meaning is pinned because providers disagree on raw fields. Anthropic's input_tokens
		 * excludes cache reads, while OpenRouter's prompt_tokens and Gemini's promptTokenCount include
		 * them. Each adapter normalizes to this definition (the arithmetic is in the adapter header).
		 * Otherwise usage aggregation would read one name with different meanings per provider.
		 */
		inputTokens: z.number().int().nonnegative().optional(),
		/**
		 * The part of inputTokens read from the provider's prompt cache. It is a subset, so 0 <=
		 * cachedInputTokens <= inputTokens whenever both are known.
		 */
		cachedInputTokens: z.number().int().nonnegative().optional(),
		/**
		 * Tokens this request wrote to the provider cache. This is a separate axis and is not subtracted
		 * from inputTokens. It is optional because some providers do not report it (Gemini's implicit
		 * caching). Unknown and zero are different, so the field is omitted when unknown.
		 */
		cacheWriteInputTokens: z.number().int().nonnegative().optional(),
		outputTokens: z.number().int().nonnegative().optional(),
		/**
		 * The public model identity of this generation. On the managed path it is always the RowCat model
		 * the user chose; the upstream slug the gateway actually routed to (for example
		 * anthropic/claude-sonnet-5) is never included. An earlier version passed through the upstream
		 * response's model field, which let a value only the server knew reach the browser in a usage
		 * frame.
		 *
		 * On the BYO path the adapter sends the provider's model id as-is, since the browser already sent
		 * that value and nothing new is disclosed.
		 */
		model: z.string().optional(),
	}),
	/**
	 * A failure after the stream has started. Failures before the stream starts are returned as the
	 * shared error envelope (ApiErrorBody), because 200 has not been sent yet and that envelope is
	 * correct at that point.
	 */
	z.object({
		type: z.literal("error"),
		code: z.string(),
		message: z.string(),
	}),
	/**
	 * The model called a tool. The turn stops here, and the device must produce the answer.
	 *
	 * This is not a terminal frame. `usage` follows, and `done` marks the end. The `finishReason` on
	 * `done` is raw provider text (tool_calls or tool_use), so the screen and router do not branch on
	 * that string. They judge by this frame's presence.
	 *
	 * At most one per stream. Parallel calls were removed from the vocabulary here. The adapter asks
	 * the provider to disable parallel calls; if two or more still arrive, it keeps the first and
	 * discards the rest. An unpaired call does not produce a 400 on the next request, because the
	 * device builds that request's assistant turn (nextChatToolRequest) with only the one chosen call.
	 * Ending with an error would kill the turn after text had already streamed, leaving the user with
	 * a response cut off mid-sentence.
	 *
	 * Arguments arrive complete. Anthropic streams partial JSON, but the adapter finishes that
	 * assembly, so the frame carries a finished object. Exposing partial arguments would force the
	 * screen and the router to each reassemble them, and those two copies would eventually diverge.
	 *
	 * No tool_call frame is sent for a request that declares no tools. The SDK frame reader throws on
	 * unknown events, and that rule is what keeps older clients working.
	 */
	z.object({
		type: z.literal("tool_call"),
		call: ChatToolCall,
	}),
	z.object({
		type: z.literal("done"),
		finishReason: z.string().optional(),
	}),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>;

/**
 * The stream wire format: NDJSON, one JSON value per line, not SSE.
 *
 * NDJSON is chosen because the parser stays short. SSE has event names, ids, reconnect fields, and
 * comment lines in its spec, while this protocol uses only one kind of line, and a partial SSE
 * parser almost always has bugs. Browsers' EventSource also cannot send POST, so the client reads
 * the stream with fetch either way. NDJSON works the same with fetch streams in Expo.
 */
export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson";

/**
 * Generation failure codes. A status code alone does not let the screen pick guidance, so each
 * failure gets a machine-readable name.
 */
export const CHAT_ERROR_CODE = {
	/** No provider key is configured on the server (503). Better than fabricating a response. */
	providerUnconfigured: "chat_provider_unconfigured",
	/**
	 * The provider failed. The raw error is not returned in the response; it is logged on the server
	 * only.
	 */
	providerFailed: "chat_provider_failed",
	/**
	 * The server cannot route the requested managed model (400).
	 *
	 * The server never silently substitutes another model. A substitution would make the user believe
	 * the model they chose produced the answer, and would present a response from a different model,
	 * with different character and cost, as if it came from the chosen one.
	 */
	managedModelUnavailable: "chat_managed_model_unavailable",
	/**
	 * Too many generation requests (429), with Retry-After. The check runs before any upstream call,
	 * so a request that gets this code never reached upstream.
	 */
	rateLimited: "chat_rate_limited",
	/**
	 * Managed generation is closed to an allowlist for this deployment, and this member is not on it
	 * (403).
	 *
	 * Managed generation runs on the operator's provider key. The allowlist is the last barrier
	 * against spending in the public build, which has no metering (MANAGED_GENERATION_ACCESS). The
	 * screen's job is not to wait but to connect the user's own key, so the response leads to AI
	 * settings rather than a retry. The check runs before any upstream call.
	 */
	managedNotAllowed: "chat_managed_not_allowed",
	/**
	 * A non-protected story was sent to the server-assembly path (400). That path is for protected
	 * stories only. If it were open, conversations for unprotected stories would silently move onto
	 * it, and the rule that a room is a copy taken at acquisition would break for no reason.
	 */
	storyNotProtected: "chat_story_not_protected",
} as const;
export type ChatErrorCode =
	(typeof CHAT_ERROR_CODE)[keyof typeof CHAT_ERROR_CODE];

/**
 * The providers that actually perform generation. Only what the product says it supports is listed.
 *
 * The vocabulary is in the contract because the catalog crosses the wire. The server holds
 * authority over what generation can use (models can change without a web deploy), so both sides
 * must see the same provider names in the response.
 *
 * `-byo` describes who owns the credential. `rowcat` means the server calls the provider with its
 * own key. `-byo` means the browser calls the provider directly with the user's key. The two take
 * different request paths and send bills to different places.
 *
 * Unused names are not listed in advance. A provider with no adapter placed here would appear as a
 * selectable catalog entry, and a user who chose it would have a setting that leads nowhere. That
 * is why OpenAI direct keys, OpenRouter BYO, and arbitrary OpenAI-compatible endpoints are absent.
 */
export const GENERATION_PROVIDERS = [
	"rowcat",
	"anthropic-byo",
	"gemini-byo",
] as const;
export const GenerationProviderDto = z.enum(GENERATION_PROVIDERS);
export type GenerationProviderDto = z.infer<typeof GenerationProviderDto>;

/**
 * One catalog row: a generation target the screen can select. Upstream metadata (context length,
 * pricing, routing policy, provider internal state) is omitted. The screen's job is to pick one
 * entry, and anything beyond that is leakage rather than a basis for choice.
 */
export const GenerationModelDto = z.object({
	/**
	 * A stable identifier inside the catalog, in the form provider:model. The selection control uses
	 * it. It is kept apart from the human-readable name, because using a label as the transport id
	 * would make refining labels break saved preferences.
	 */
	id: z.string(),
	provider: GenerationProviderDto,
	/** The provider's human-readable name. It becomes the label of the provider section on screen. */
	providerLabel: z.string(),
	/**
	 * The human-readable name of the company that made the model. It is the subgroup heading inside
	 * the model section.
	 *
	 * This is a different axis from providerLabel. That one answers who is billed (RowCat or
	 * Anthropic); this one answers who made the model (OpenAI, Anthropic, Google, and so on). On BYO
	 * the two coincide, but on managed one provider lists models from several companies. Without
	 * grouping by company, a long list would run with no order.
	 *
	 * It is not routing information. The company name already appears in the label (for example
	 * GPT-5.6 Luna), and the upstream slug still never leaves the server; this value cannot be used to
	 * build one.
	 */
	vendorLabel: z.string(),
	label: z.string(),
	/**
	 * The model name that identifies this target. Who interprets it depends on the path.
	 *
	 * On BYO, the browser calls the provider directly with this value, so it must be the provider's
	 * canonical model id. On managed, it is one public identity from ROWCAT_MANAGED_MODELS. Only the
	 * server knows which upstream model that identity routes to
	 * (apps/api/src/services/generation/managed-models.ts), and no upstream slug appears in this
	 * response.
	 */
	model: z.string(),
	/**
	 * Whether this target needs a provider connection on the device (a personal API key). The server
	 * supplies the answer so the screen does not repeat `provider !== 'rowcat'` checks in several
	 * places, where every new provider would need an edit.
	 */
	requiresConnection: z.boolean(),
	/**
	 * Whether the user can choose a reasoning effort for this target; null if not.
	 *
	 * The server supplies this so the screen does not guess from the model id, provider, or company
	 * name (the same reason as requiresConnection). Guessing code must be edited for each new model,
	 * and one that misses a spot shows a setting that is never applied. For managed targets this is a
	 * projection of the server registry (services/generation/managed-models.ts). For BYO it is the set
	 * of levels this deployment's adapter can actually map. In both cases, values outside this list
	 * never reach a provider.
	 */
	reasoning: ModelReasoningDto.nullable(),
	/**
	 * Whether this target can use a narration pack; null if not. It has the same property and the same
	 * reason as `reasoning` above. For managed targets it is a projection of the server registry
	 * (services/generation/managed-models.ts). For BYO it is what this deployment knows about the
	 * model.
	 */
	promptPack: ModelPromptPackDto.nullable(),
});
export type GenerationModelDto = z.infer<typeof GenerationModelDto>;

/**
 * The catalog response. The array is wrapped in an object rather than returned bare, so a catalog
 * version or update time can be added later without needing a top-level array to extend.
 */
export const GenerationModelListDto = z.object({
	models: z.array(GenerationModelDto),
});
export type GenerationModelListDto = z.infer<typeof GenerationModelListDto>;
