import {
	CHAT_DEFAULT_OUTPUT_TOKENS,
	CHAT_MAX_OUTPUT_TOKENS,
	DEFAULT_MANAGED_MODEL,
	GENERATION_PROVIDERS,
	type GenerationProviderDto,
	isRowCatManagedModel,
	type RowCatManagedModel,
} from "@rowcat/contracts/chat";
import type { ReasoningEffort } from "./reasoning.ts";

/**
 * Generation preferences and their precedence: one vocabulary shared by global and room settings.
 *
 * The file exists because there are three layers: the product default, this device's global
 * preference, and a per-room override. If each screen wrote its own merge rule, the global settings
 * screen, the room dialog and the generation hook would answer slightly differently, and the
 * mismatch would look like 'I changed the setting but some rooms did not change'. So the merge
 * lives in this one function.
 *
 * Not here:
 * - Credentials. BYO keys, tokens and endpoints never enter a preference record. A preference
 *   says what to generate with; turning that into a real connection is the device's provider
 *   store's job. If keys entered preferences, syncing preferences would sync keys.
 * - Provider parameters (temperature, top_p, top_k, penalty, stop). Their meaning and range
 *   differ per provider, so one stored number would lose its meaning on the day a provider stops
 *   accepting it. Only product vocabulary (response length) is here, and the one table mapping it
 *   to each provider's parameters is below.
 * - Storage. Only a port (`GenerationPreferenceStore`) is defined; each platform implements it.
 *
 * There are three axes, and each inherits from its layers independently: response length,
 * generation target (`GenerationTarget`) and reasoning effort (`ReasoningEffort`). So the result
 * carries per-axis `sources`, not one `source`. 'Length from global, model from this room,
 * reasoning unset' is a normal state, and folding it into one value would leave one control always
 * wrong.
 *
 * The third axis differs in one way: the values that can be picked depend on the target. That
 * judgment is not here (`reasoning.ts`). Response length is not folded into the reasoning control
 * either, because length can be chosen with any model.
 *
 * Availability is not here. Whether this device can run the result is a different question
 * (`generation-availability.ts`). Combining the two would make this pure function aware of provider
 * connections, catalogs and the network, and the precedence rules could no longer be checked
 * without the app.
 */

/**
 * The vocabulary's source is the contract, not a local list.
 *
 * The names cross the wire: catalog responses (`GenerationModelDto.provider`) carry the same
 * values. A local copy would go stale when the server adds a provider, and that provider's entries
 * would be dropped silently.
 *
 * `-byo` marks who holds the credential. `rowcat` is called by the server with its own key; a
 * `-byo` provider is called by the device with the user's key. The request path and billing differ,
 * so the name shows it.
 */
export type GenerationProvider = GenerationProviderDto;

const PROVIDER_SET: ReadonlySet<string> = new Set(GENERATION_PROVIDERS);

/**
 * Whether a stored value is still in this vocabulary. Used only at the read boundary.
 *
 * Same reason as `isResponseLength`: a device may hold an old value, and an unknown provider name
 * passed through would leave the router without an adapter, failing that room's generation
 * entirely.
 */
export const isGenerationProvider = (
	value: unknown,
): value is GenerationProvider =>
	typeof value === "string" && PROVIDER_SET.has(value);

/**
 * Whether this is a provider that holds credentials on the device.
 *
 * The check is one line but is needed in several places (availability, the settings connection
 * line, the router's adapter choice). If each place wrote `provider !== 'rowcat'`, every new
 * provider would need edits in several conditions, and a missed place would judge that a provider
 * can run without a connection. That failure appears only after the user presses send.
 */
export const isByoProvider = (provider: GenerationProvider): boolean =>
	provider !== "rowcat";

/**
 * The providers that may hold user credentials (`GenerationProvider` minus managed).
 *
 * The split in the type is the point. `rowcat` is a product capability, not a user credential, so
 * an action like 'disconnect RowCat' must have no place to be constructed. Both apps' credential
 * stores read this same type.
 */
export type ByoProvider = Exclude<GenerationProvider, "rowcat">;

/**
 * Whether this provider can have a connection. Both apps' read boundaries and screens use this same
 * check.
 *
 * A stored row's `provider` must pass before the row is read. A mismatched row would have another
 * provider's key copied into this slot, and a request sent with it would give the user's secret to
 * a provider they did not choose.
 */
export const isByoProviderName = (value: unknown): value is ByoProvider =>
	isGenerationProvider(value) && isByoProvider(value);

/**
 * What to generate with: a provider and that provider's model.
 *
 * The two values are one record on purpose. Storing them separately would allow 'Anthropic plus a
 * Gemini model name', which could be saved but never run. As a discriminated union, such a value
 * cannot be built.
 *
 * The managed (`rowcat`) model is not a free string, for the same reason: only the public
 * identities the contract defines (`RowCatManagedModel`) are allowed. Upstream slugs belong to the
 * server. A free-text field would eventually receive a real slug, and the managed path would become
 * an arbitrary-model proxy.
 *
 * BYO model names are free strings because the difference is who interprets the name. A BYO model
 * name is passed by the browser to the provider as-is, so it is not the RowCat vocabulary. Whether
 * it is in the catalog is a separate question (`resolveGenerationExecution`).
 */
export type GenerationTarget =
	| { provider: "rowcat"; model: RowCatManagedModel }
	| { provider: "anthropic-byo"; model: string }
	| { provider: "gemini-byo"; model: string };

/**
 * Whether this target goes to the RowCat server, i.e. a managed generation run with the operator's
 * key.
 *
 * The check is one line but is a function so the string comparison does not scatter across the app
 * (the mobile static scan blocks `rowcat` comparisons outside the transport layer). It decides by
 * the target's namespace, not by provider name or model string, because managed and BYO sharing a
 * model name is normal.
 */
export const isManagedTarget = (target: GenerationTarget): boolean =>
	target.provider === "rowcat";

/**
 * Stored value to target. Never throws: unknown shapes return `null`.
 *
 * `null` means 'this layer did not choose'. A corrupted target, or one missing from the current
 * vocabulary, falls back to no override, and the upper layers (global, then product default) take
 * over. The worst outcome is 'as before'. Throwing would show the user a broken conversation
 * instead of a settings issue.
 *
 * The value is not cast through. `value as GenerationTarget` would let an arbitrary string become a
 * provider name that flows to the router, and the failure would surface only just before
 * generation.
 */
export function readGenerationTarget(value: unknown): GenerationTarget | null {
	if (typeof value !== "object" || value === null) return null;
	const { provider, model } = value as { provider?: unknown; model?: unknown };
	if (!isGenerationProvider(provider)) return null;
	if (typeof model !== "string" || !model) return null;
	/**
	 * A managed target passes only if it is inside the contract's vocabulary. An unknown identity
	 * would be sent with the request and rejected by the server with a 400, surfacing at the next
	 * conversation rather than when the setting was changed. Returning `null` here lets the upper
	 * layer take over, so the worst outcome stays 'as before'.
	 */
	if (provider === "rowcat")
		return isRowCatManagedModel(model) ? { provider, model } : null;
	return { provider, model };
}

/** Whether two targets are the same. The selection control and the store share this comparison. */
export const sameGenerationTarget = (
	a: GenerationTarget,
	b: GenerationTarget,
): boolean => a.provider === b.provider && a.model === b.model;

/**
 * A stable key that links a catalog entry to a stored target.
 *
 * The selection control handles a single string this way. Using the label as the key would make
 * label edits break stored preferences, and comparing objects directly would give each screen its
 * own method.
 */
export const generationTargetKey = (target: GenerationTarget): string =>
	`${target.provider}:${target.model}`;

/**
 * Response length: three steps the product chose.
 *
 * The raw token count is not exposed because it is not the user's vocabulary. '2048 max output
 * tokens' does not say what is being chosen, and the same number is a different amount of text on a
 * different provider. With three steps, the mapping becomes a table the product can update.
 */
export const RESPONSE_LENGTHS = ["short", "standard", "long"] as const;
export type ResponseLength = (typeof RESPONSE_LENGTHS)[number];

const RESPONSE_LENGTH_SET: ReadonlySet<string> = new Set(RESPONSE_LENGTHS);

/**
 * Whether a stored value is still in this vocabulary. Used at the read boundary.
 *
 * A device may hold a record from an older version, where step names changed or were removed.
 * Passing an unknown value through would make that room's token lookup return `undefined`, and
 * generation would fail for that room alone.
 */
export const isResponseLength = (value: unknown): value is ResponseLength =>
	typeof value === "string" && RESPONSE_LENGTH_SET.has(value);

/**
 * Response length to the contract's output ceiling. This table is the only source.
 *
 * `standard` equals the contract default, which matters: a user who saved no preference gets the
 * same ceiling as before, so this slice changes no existing conversation.
 *
 * Both extremes lie within the contract ceiling (`CHAT_MAX_OUTPUT_TOKENS`). A value above it would
 * be rejected by the server with a 400, and the failure would appear at the next conversation
 * rather than when the setting changed.
 */
const RESPONSE_LENGTH_TOKENS: Record<ResponseLength, number> = {
	/** Short: one or two paragraphs, for quick exchanges. */
	short: 768,
	standard: CHAT_DEFAULT_OUTPUT_TOKENS,
	/** Long: an extended scene description. About half the ceiling, which leaves headroom. */
	long: 4_096,
};

/**
 * The product default: the answer when the user has chosen nothing.
 *
 * It is not copied into the preference record; that is the core of this design. A copy would pin
 * every stored user to the old value on the day the product default changes, for a choice they
 * never made. Leaving it unstored lets 'unset' keep following the new default.
 */
export const PRODUCT_RESPONSE_LENGTH: ResponseLength = "standard";

/**
 * The product default target: one RowCat managed model.
 *
 * Handled by the same rule as response length: it is not copied into preference records. Storing it
 * would pin stored users to the old value when the product default changes, and the user never
 * chose it.
 *
 * Being managed is this slice's safety property. A user with no settings can generate without a BYO
 * connection and is asked for no credentials.
 *
 * Which model it is, is set by the contract (`DEFAULT_MANAGED_MODEL`). A literal here would be a
 * second copy of the same product decision, and the server's default and the client's default could
 * drift apart.
 */
export const PRODUCT_GENERATION_TARGET: GenerationTarget = {
	provider: "rowcat",
	model: DEFAULT_MANAGED_MODEL,
};

/**
 * The product default reasoning effort. It follows the same rule as the other two: not copied into
 * preference records, for the same reason.
 *
 * It is a different axis from the model's own default step. This is the answer to 'when nothing is
 * chosen, what does the user want?'. If the model cannot do that value, what runs instead is
 * decided by the catalog (`ModelReasoningCapability.defaultEffort`). Folding the two together would
 * make adding a model shake the product default.
 *
 * `medium` because it is the middle of the current vocabulary and the step nearly every target
 * supports. A user who never chose anything then sees the execution step stay stable across model
 * changes. The label is `Standard`, not `Medium`; that copy belongs to the app.
 */
export const PRODUCT_REASONING_EFFORT: ReasoningEffort = "medium";

/**
 * What one layer chose. The shape is the same for global and room.
 *
 * `null` means 'this layer did not choose', not 'chose the default'. If the two were not
 * distinguished, removing a room override (`Use default`) would copy the current global
 * value into the room, and that room would then stop following global changes.
 */
export interface GenerationPreference {
	responseLength: ResponseLength | null;
	/**
	 * The generation target this layer chose. `null` means inherit from above.
	 *
	 * No credentials come in here. The value only says what to generate with. Turning it into a usable
	 * connection is the device's provider store's job (`apps/web/src/lib/local-provider/`). If keys
	 * entered here, saving a preference would save a key, and every path that moves preferences would
	 * move keys.
	 */
	target: GenerationTarget | null;
	/**
	 * The reasoning effort this layer chose. `null` means inherit from above.
	 *
	 * `null` is not 'no reasoning'. It means exactly what it means for the other two axes: this layer
	 * did not choose, and the next layer answers. It is not 'off', not `Auto`, and not a copy of
	 * the current upper value. Without that distinction, choosing `Use default` would pin
	 * the current global value into the room.
	 *
	 * It is independent of the target. 'Choose the model in this room, inherit reasoning' is a normal
	 * state, and representing it requires each field to be independently `null`. The range of values
	 * that can be picked depends on the target, though. If a target change makes this override
	 * unusable, the override is removed (`reconcileReasoningOverride` in `reasoning.ts`), not moved to
	 * another step.
	 */
	reasoningEffort: ReasoningEffort | null;
}

/** A layer that chose nothing. The store also returns it when no record exists. */
export const EMPTY_GENERATION_PREFERENCE: GenerationPreference = {
	responseLength: null,
	target: null,
	reasoningEffort: null,
};

/**
 * Whether this layer chose anything at all. The store uses this to decide whether to delete the
 * record.
 *
 * When an axis is added, update this too. If missed, a preference with only the new axis set is
 * judged empty, its row is deleted right after saving, and the user sees 'picked but not saved'.
 */
export const isEmptyGenerationPreference = (
	preference: GenerationPreference,
): boolean =>
	preference.responseLength === null &&
	preference.target === null &&
	preference.reasoningEffort === null;

/** Which layer set a value. Drives the `Use default` label on screen. */
export type GenerationPreferenceSource = "product" | "global" | "room";

/**
 * Per-axis sources, not folded into one value.
 *
 * A single `source` cannot express 'length from global, model from this room', and that combination
 * is common, not an exception. Folding would give one of the two controls a wrong `Use default` label,
 * showing a model chosen in the room as if it were a global setting.
 */
export interface EffectiveGenerationSources {
	responseLength: GenerationPreferenceSource;
	target: GenerationPreferenceSource;
	/**
	 * The reasoning axis's source, kept separate from the first two.
	 *
	 * 'Model set in this room, reasoning inherited' is a common state. Folding it into one value would
	 * give one of the two controls a wrong `Use default` label.
	 */
	reasoningEffort: GenerationPreferenceSource;
}

/**
 * The settings this request actually uses: the resolved values.
 *
 * `sources` travels with them. The room settings screen must show, per axis, whether a value
 * belongs to the room or is inherited. If the screen re-derived that (`room.target !== null`), the
 * precedence rules would exist in two places.
 *
 * This value does not yet say whether it can run. `target` is the requested target; whether this
 * device can run it is answered by the next step (`resolveGenerationExecution` in
 * `generation-availability.ts`).
 */
export interface EffectiveGeneration {
	/** The requested target, before the availability check. */
	target: GenerationTarget;
	responseLength: ResponseLength;
	/**
	 * The reasoning effort the user requested, not yet passed through model capability.
	 *
	 * It is the same kind of value as `target`: whether it runs on this model, and what goes into the
	 * request, is answered by the next step (`reasoningEffortForRequest` in `reasoning.ts`).
	 * Consulting the catalog here would tie the pure precedence rule to server state, and this
	 * function could no longer be checked without the app.
	 *
	 * Unlike `maxOutputTokens`, no derived value is exported. Response length becomes a token count
	 * through a table, but reasoning steps differ by model. Fixing the value here would make it a
	 * promise that the request goes out with it, and this layer cannot keep that promise.
	 */
	reasoningEffort: ReasoningEffort;
	/** Sent as-is in the generation request (`ChatGenerationRequest.maxOutputTokens`). */
	maxOutputTokens: number;
	sources: EffectiveGenerationSources;
}

/**
 * Resolves one axis across layers: room, then global, then product default.
 *
 * Defined once instead of per axis. The axes differ only in value type; the precedence is
 * identical. Written separately, one axis would eventually diverge in a subtle way, such as
 * treating an empty value as an override.
 */
function resolveAxis<T>(
	room: T | null,
	global: T | null,
	product: T,
): { value: T; source: GenerationPreferenceSource } {
	if (room !== null) return { value: room, source: "room" };
	if (global !== null) return { value: global, source: "global" };
	return { value: product, source: "product" };
}

/**
 * Merges three layers (room, then global, then product default) for each axis.
 *
 * Pure function: it touches no storage or React, and it does not look at provider connections.
 * Checking connections here would fuse 'what the user wanted' with 'what this device can do',
 * removing the one place where a silent fallback to another provider on a device without the
 * connection could be blocked.
 *
 * Axes do not look at each other. If a room overrides only the model, length still follows the
 * global value, and the reverse holds too. If one axis's override dragged the others into the room,
 * values the user never changed would become fixed.
 *
 * Layers can be omitted because there are two kinds of caller. The generation runtime passes both.
 * The global settings screen asks for the current default with only `{ global }`, and the room
 * settings screen asks what it inherits the same way. That is how the text in `Use default (Standard)`
 * also comes from this function.
 */
export function resolveEffectiveGeneration(input: {
	global?: GenerationPreference | null;
	room?: GenerationPreference | null;
}): EffectiveGeneration {
	const responseLength = resolveAxis(
		input.room?.responseLength ?? null,
		input.global?.responseLength ?? null,
		PRODUCT_RESPONSE_LENGTH,
	);
	const target = resolveAxis(
		input.room?.target ?? null,
		input.global?.target ?? null,
		PRODUCT_GENERATION_TARGET,
	);
	/**
	 * The third axis follows the same table. Not looking at the other two is the point: overriding the
	 * target in a room must not drag reasoning into the room, or the user would see an unchanged value
	 * become fixed. That room would then stop following the global reasoning setting.
	 */
	const reasoningEffort = resolveAxis(
		input.room?.reasoningEffort ?? null,
		input.global?.reasoningEffort ?? null,
		PRODUCT_REASONING_EFFORT,
	);

	return {
		target: target.value,
		responseLength: responseLength.value,
		reasoningEffort: reasoningEffort.value,
		maxOutputTokens: RESPONSE_LENGTH_TOKENS[responseLength.value],
		sources: {
			responseLength: responseLength.source,
			target: target.source,
			reasoningEffort: reasoningEffort.source,
		},
	};
}

/**
 * Output-token ceiling for one response-length step. The table itself is not exported, only this
 * lookup. If the table were exported, callers would start putting these numbers into their own
 * decisions.
 */
export const outputTokensFor = (length: ResponseLength): number =>
	RESPONSE_LENGTH_TOKENS[length];

/**
 * Holds the fact that the table stays within the contract ceiling, as a runtime value rather than a
 * type.
 */
export const RESPONSE_LENGTH_TOKEN_CEILING = CHAT_MAX_OUTPUT_TOKENS;

/**
 * Schema version of the stored preference row. It belongs to the row, not to the database.
 *
 * The version exists because this value stays on the user's device for a long time. If the fields
 * change and old rows cannot be recognized, the only option is to discard them, which silently
 * erases preferences the user chose. No general migration framework is built here; what is needed
 * now is one question: is this row a version the code knows?
 *
 * Web (IndexedDB) and mobile (SQLite) must read the same value. Rows never cross devices, since
 * this record is not synced, but if versions diverged the same field would mean two things. That is
 * why there is one constant here, not one per app.
 *
 * It was deliberately not bumped. The reader ignores rows of an unknown version, so bumping to 2
 * would erase every stored response-length preference, though nobody chose a target axis. The
 * target and reasoning axes were added additively: a row without those fields reads as `null`
 * (inherit from above), and the result matches what each feature's absence gives.
 *
 * Bump the version only when the meaning of an existing field changes, such as redefining the
 * response-length steps or changing the storage format. Adding a field is not such a change.
 */
export const GENERATION_PREFERENCE_VERSION = 1;

/** Key of the global preference: exactly one per member and device. */
export const GLOBAL_PREFERENCE_KEY = "global";

export const ROOM_PREFERENCE_KEY_PREFIX = "room:";

export const roomPreferenceKey = (roomId: string): string =>
	`${ROOM_PREFERENCE_KEY_PREFIX}${roomId}`;

/**
 * Prefix for runtime-work overrides. It is deliberately different from the room prefix.
 *
 * Both live in the same table, but their lifetimes differ. A room override is removed when the room
 * is deleted. A runtime override is removed by nothing: removing a work from the library does not
 * clear it, and neither does resetting play. Distinct prefixes keep `clearRoom` from ever reaching
 * a runtime value.
 */
export const RUNTIME_PREFERENCE_KEY_PREFIX = "runtime:";

export const runtimePreferenceKey = (storyId: string): string =>
	`${RUNTIME_PREFERENCE_KEY_PREFIX}${storyId}`;

/**
 * The port for generation preferences. The device owns these values.
 *
 * The key difference from `ChatStore` is the absence of sync fields (`dirty`, `rev`,
 * `serverVersion`, tombstones). That absence is a decision, not an omission. Preferences are tied
 * to provider connections (BYO), and connections differ per device. Syncing globally would deliver
 * a value chosen on a Mac, where Anthropic is connected, to a phone without that connection, where
 * it would become an unusable default.
 *
 * So this record is not registered in the sync codec registry or in the sync store's type-to-table
 * map. The sync protocol does not know the value exists.
 *
 * Reads return an empty preference when nothing is stored and never throw. The reader runs at
 * generation time, and failing to read one preference would block a conversation, which is a fault
 * rather than a setting.
 */
export interface GenerationPreferenceStore {
	/** Global preference for this device and member. `EMPTY_GENERATION_PREFERENCE` when absent. */
	getGlobal(): Promise<GenerationPreference>;
	/**
	 * Writes the global preference. A preference with nothing chosen deletes the record.
	 *
	 * Storing 'nothing chosen' as a value would make it indistinguishable from 'never opened', and the
	 * product default could no longer follow changes.
	 */
	setGlobal(preference: GenerationPreference): Promise<void>;
	/** One room's override. `EMPTY_GENERATION_PREFERENCE` when absent. */
	getRoom(roomId: string): Promise<GenerationPreference>;
	setRoom(roomId: string, preference: GenerationPreference): Promise<void>;
	/**
	 * Clears a room's override. This is the cleanup that room deletion calls, and the implementation
	 * of 'use default settings'.
	 *
	 * Clearing a room that does not exist is silently ignored (idempotent). Deletion can happen in two
	 * tabs at once.
	 */
	clearRoom(roomId: string): Promise<void>;
	/**
	 * The override for one runtime work, keyed by work id rather than room id.
	 *
	 * A runtime playthrough is not a `ChatRoom`: it has no room record and no messages. It lives in
	 * this store because it answers the same question: which model should this target generate with on
	 * this device? The value shape, the precedence (work, then global, then product default) and the
	 * reason it is not synced (connections differ per device) are all identical to room overrides. A
	 * second store would inevitably drift in one of them.
	 *
	 * It is not folded into `getRoom('runtime:' + storyId)`. That would put work ids into the room
	 * namespace, and `clearRoom` could then clear a work's override. The two values have different
	 * lifetimes.
	 *
	 * There is no separate operation to clear a work's override. Removing a work from the library sets
	 * `removedAt` and keeps progress; resetting a playthrough clears only that run's progress. Neither
	 * affects which model the work uses, and an empty preference deletes the row anyway, the same rule
	 * as `setRoom`.
	 *
	 * The response-length axis has no effect here. A runtime's output ceiling is set by the creator's
	 * request (`maxOutputCharacters`), so a `responseLength` stored under this key never reaches
	 * execution. The axis stays in the port's shape because two shapes for one value would let storage
	 * implementations diverge. The screen simply does not draw that control.
	 */
	getRuntime(storyId: string): Promise<GenerationPreference>;
	setRuntime(storyId: string, preference: GenerationPreference): Promise<void>;
}
