import type { ChatCharacter } from "./character.ts";
import type { ChatRuntimeMessage, ChatRuntimeRoom } from "./context.ts";
import type { AssistantContinuation } from "./continuation.ts";
import type { GeneratedAssistantMessage } from "./generation.ts";
import type { GenerationPreference } from "./generation-preference.ts";
import type { ChatMemory } from "./memory.ts";
import type { ChatMessage } from "./model.ts";
import type { ChatNarrationSettings } from "./narration.ts";

/**
 * This module was moved out of `apps/web/src/features/conversation/`, because it now has three
 * consumers:
 * - web local rooms: persisted and synced in IndexedDB
 * - web work test (the creator's draft playtest): in memory only, gone on reload
 * - mobile local rooms: persisted and synced in SQLite
 *
 * Only storage differs between them. Prompt assembly, safety guards, lore selection, target
 * resolution, sending, stream end rules and ownership checks must match exactly, so they must live
 * in one place. Per-app copies diverge in ways that appear on one platform only, for example a
 * stale reply attaching to another user's conversation after an account switch on mobile.
 *
 * Not here, and why:
 * - React and hooks. Lifecycle wiring stays in each app (DOM on web, React Native on mobile).
 *   This module holds only the rules that wiring must follow, checkable without rendering.
 * - Transport, providers and SDKs. These belong to the router. If this package knew transport,
 *   the BYO path could not use the same assembler (see the package header rules).
 * - Screen copy. Each app maps failures to user-facing text. Korean copy here would tie pure
 *   rules to one locale.
 */

/**
 * The value a durable save returns: an identity, or nothing.
 *
 * The alias exists because `Promise<string | void>` reads poorly at call sites. The name says on
 * the spot that a reply may or may not be answered.
 *
 * The point of the type is `void`, not `undefined`. An implementation that returns nothing (`async
 * (message) => { await store.append(message); }`) infers `Promise<void>`. Narrowing to `undefined`
 * would force every conversation to write `return undefined`, and that line would turn 'does not
 * answer' into 'answers with an unknown value'.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: see the paragraph above. The `void` in this union is the entire signal.
export type AppendedAssistantMessageId = string | void;

export interface ConversationSession {
	/**
	 * This conversation's execution identity. Ownership checks compare it by reference.
	 *
	 * A local room uses that member's store instance. A replay session uses the session object. When
	 * this value changes, a generation in progress loses its conversation and cannot write anything.
	 * This one rule is what makes the story test's `Reset test` and `New test from latest draft` (new test
	 * from latest draft) safe.
	 */
	readonly token: object;
	readonly runtime: ChatRuntimeRoom & { adult: boolean };
	/**
	 * The work this conversation's prompt must be assembled from on the server, if any. Otherwise
	 * absent.
	 *
	 * The protected prompt source never goes down to the device (`projectProtectedSeed`), so turns in
	 * such a room are assembled on the server from the currently published seed
	 * (`planChatGeneration`). This is set only when a local room has both `promptProtected` and its
	 * source work. A legacy-migrated room has no source work id, and its source is already on the
	 * device. A work-test draft belongs to its creator. Absence is the accurate representation of both
	 * cases.
	 */
	readonly protectedStoryId?: string;
	/**
	 * This layer's generation override. `null` means no override, and the upper layers apply (global,
	 * then product default).
	 *
	 * It is async on purpose. Local rooms must read it from storage. Passing it through render state
	 * would make 'which settings this request went out with' depend on render timing. Replay sessions
	 * answer at once from memory.
	 */
	loadPreference(): Promise<GenerationPreference | null>;
	/** History in ascending order (oldest first), up to the limit. */
	loadHistory(): Promise<ChatRuntimeMessage[]>;
	/**
	 * This conversation's memories. A conversation with none returns an empty array.
	 *
	 * Replay sessions have none by decision, not because the feature is unfinished. Memories are
	 * per-room content and carry every sync axis. A disposable session that produced them would create
	 * records that belong to no room.
	 */
	loadMemories(): Promise<ChatMemory[]>;
	/**
	 * Characters the user has introduced in this conversation. A conversation with none returns an
	 * empty array.
	 *
	 * Same place and same rules as memories. It is read once at start and frozen, so characters added
	 * while a response streams do not change this request. The next turn reads the new list. Replay
	 * sessions and the runtime also return an empty array, for the same reason as memories: there is
	 * no room record to hold them.
	 */
	loadCharacters(): Promise<ChatCharacter[]>;
	/**
	 * The summary of history that has fallen outside the history window. Empty string if there is
	 * none.
	 *
	 * It is the same kind of snapshot as memories and sits in the same place. It is read once at
	 * start, so background maintenance that updates the summary during a stream does not change this
	 * request.
	 *
	 * Replay sessions always return an empty string. A work test has no past to summarize and no room
	 * record to store a summary in. A room-level summary created there would belong to no room.
	 */
	loadSummary(): Promise<string>;
	/**
	 * Secures this conversation's routing-friendly key. Optional, since some conversations have none.
	 *
	 * Only persisted rooms provide it. The value lives in the room record. A room created by an older
	 * version receives one here, and it is saved (`ChatStore.ensureRoomRoutingSession`). Creating a
	 * new key per request would send a different key every turn, which is worse than having none,
	 * because the gateway would see every turn as a new conversation.
	 *
	 * Replay sessions do not provide it. They have no cache across turns, so absence is the accurate
	 * answer, and no `null`-returning stub is invented.
	 *
	 * `null` means the conversation cannot have the key right now (for example, the room was deleted
	 * in the meantime). The turn then goes out without the axis, which is the same request as before
	 * this feature existed.
	 */
	loadRoutingSessionId?: () => Promise<string | null>;
	/**
	 * The narration style this conversation has chosen. Optional, since some conversations have none.
	 *
	 * As with the routing key, only persisted rooms provide it. Replay sessions have no room record to
	 * hold settings, so absence is the accurate answer.
	 *
	 * It is async for the same reason as preferences: the value lives in storage, and passing it
	 * through render state would tie 'which settings this request used' to render timing. It is read
	 * once at start, so changing the setting mid-response does not affect this request.
	 *
	 * What this returns is the intent, not the outcome. Whether it becomes the body this turn depends
	 * on model capability (`resolveNarrationExecution`), and capturing that body comes after. The
	 * wiring that joins the three belongs to each app's generation hook.
	 */
	loadNarration?: () => Promise<ChatNarrationSettings | null>;
	/**
	 * Wakes automatic maintenance after the confirmed response has been saved. Optional, since some
	 * conversations do not have it.
	 *
	 * Whether maintenance is needed depends on how many messages have accumulated, and that count
	 * changes exactly here. If the screen called it instead, web and mobile would each wire it
	 * separately, and a miss in one app would mean summaries are never built there. Nothing would
	 * report the absence.
	 *
	 * It returns `void` on purpose, so it is never awaited. Maintenance is a paid model call. Awaiting
	 * it would keep the user from sending the next message for seconds after reading the answer. A
	 * returned Promise invites someone to add `await` later, and that one keyword would change the
	 * rhythm of the conversation.
	 *
	 * It must not throw. An exception escaping here would fail a turn that already succeeded, and the
	 * user would see the answer alongside an error message.
	 */
	maintain?: () => void;
	/**
	 * Appends this user utterance to the conversation. This happens **before** any network call.
	 *
	 * The speaker name is not an argument, because the conversation owns it: a room uses the seed's
	 * persona. If the lifecycle chose the name, two conversations could attach different names.
	 */
	appendUserMessage(content: string): Promise<void>;
	/**
	 * Appends the confirmed assistant response.
	 *
	 * It takes the shape without `roomId` (`GeneratedAssistantMessage`), since the conversation knows
	 * where to append it. A replay session has no room to append to.
	 *
	 * The returned value identifies the row, but only when the conversation can answer. The
	 * observability layer needs to know which turn produced this response, and only the conversation
	 * that issued the identity knows that mapping. If the screen guessed instead (assuming the last
	 * row belongs to the last turn), one late-finishing generation would break the guess. The
	 * inspector would then cite another turn's prompt as the basis of this response.
	 *
	 * `void` means this conversation does not provide the mapping. It is not a failure. The
	 * observability layer cannot tie the turn to a message, and the screen says so rather than
	 * inventing one.
	 */
	appendAssistantMessage(
		message: GeneratedAssistantMessage,
	): Promise<AppendedAssistantMessageId>;
	/**
	 * Appends a continuation result to the last response that was cut off by the output cap. Optional.
	 *
	 * Some conversations do not provide it. A work test (a replay session) supports only per-row copy,
	 * so it leaves this out, and the absence is itself the screen's rule. The lifecycle does not start
	 * continuation in a session without this function (`maintain` is optional in the same way).
	 *
	 * The merge rule is not decided here. It lives in `extendAssistantRecord` (continuation.ts), and
	 * storage calls that inside its own transaction. If each conversation kind had its own merge rule,
	 * the same continuation would leave a different body on each device.
	 */
	extendAssistantMessage?: (
		messageId: string,
		continuation: AssistantContinuation,
	) => Promise<void>;
}

/**
 * The rule here is one: nothing is written unless the owner at the start is still the owner. When
 * it is broken, the symptom is silent. A response arriving after Alice logs out is written to a
 * closed database and rejected, which drops the cleanup path entirely. In the worst case it is
 * saved through Bob's scope. Neither outcome shows on screen.
 *
 * Why an opaque token rather than `ChatStore`: the question is whether the conversation this
 * generation targeted at start is still the same one. The store instance was only the answer for
 * local rooms. A work test (a non-persisted replay session) has no store, and the session object
 * fills that role.
 *
 * The check does not inspect the token's contents. It compares by reference only, so the same rule
 * holds for every conversation kind, and no kind gets a race defense of its own.
 */

/**
 * The identity of the conversation that is open now. Ownership checks compare these values, not the
 * key object.
 *
 * Both axes are kept because checking only one fails silently. Member id alone would let `Alice ->
 * guest -> Alice` send writes over a connection that was closed in between. Conversation alone
 * would let a path that still holds the old object send data into another account's scope after a
 * switch.
 */
export interface ConversationSessionKey {
	/** Scope owner (RowCat member id). `null` for guests or during a switch. */
	viewerId: string | null;
	/**
	 * This conversation's execution identity, as an opaque reference.
	 *
	 * For a local room it is that member's `ChatStore` instance, which changes when the connection
	 * closes and reopens. For a work test it is the replay session object. `null` means no
	 * conversation is writable right now, so no owner is valid.
	 */
	session: object | null;
}

/** Frozen when the generation starts. Later scope changes do not change it. */
export interface GenerationOwner {
	viewerId: string | null;
	/**
	 * The conversation instance at start.
	 *
	 * The member id alone is not enough. For `Alice -> guest -> Alice` the id is the same, but in
	 * between the database connection was closed and reopened. A write aimed at the old instance would
	 * go to the closed connection.
	 */
	session: object;
	/**
	 * The history epoch at start. This is separate from conversation identity.
	 *
	 * The same member and the same conversation can still be a case where this generation must not
	 * write. That happens when the user rewrites history while the response is pending (edit,
	 * regenerate, or delete from here). The generation then holds text built from history that no
	 * longer exists, and attaching it would place an answer exactly where the user just erased
	 * something.
	 *
	 * This value exists because stopping is not enough. `abort()` is only a signal. A request that has
	 * already received the whole body can pass that signal and finish as a normal completion, and its
	 * save then arrives as a success.
	 */
	historyEpoch: number;
}

/**
 * Whether this generation is still inside its own conversation.
 *
 * Both axes are checked. If the member changed, it is not. If the member is the same but the
 * conversation instance differs, it is not either. If the app only created a new object, both
 * values are unchanged and the result is true. The comparison is on the two values inside the key,
 * not on the key object's reference.
 */
export function ownsSession(
	owner: GenerationOwner,
	key: ConversationSessionKey,
): boolean {
	return owner.viewerId === key.viewerId && owner.session === key.session;
}

/**
 * Whether the history is still the one this generation started with.
 *
 * Rewriting the tail raises this epoch, so any generation that began before that operation cannot
 * save, however it ends (success, stop, or partial failure).
 *
 * The epoch must be raised **before** the rewrite commits. If it were raised after, a generation
 * that finished in between would attach its reply to the old history. The rewrite's transaction has
 * already fixed its scope and would not see that reply, so an orphan response would remain under a
 * deleted conversation.
 */
export const ownsHistory = (owner: GenerationOwner, epoch: number): boolean =>
	owner.historyEpoch === epoch;

/**
 * Whether the confirmed save is allowed. **Both axes** are checked.
 *
 * The lifecycle does not inline this check, because a missing condition fails silently. Checking
 * only the conversation identity lets a reply attach to a conversation that was just deleted.
 * Checking only history lets a logged-out account's response reach the next person's database.
 * Neither failure is visible on screen.
 */
export function canPersistGeneration(
	owner: GenerationOwner,
	key: ConversationSessionKey,
	epoch: number,
): boolean {
	return ownsSession(owner, key) && ownsHistory(owner, epoch);
}

/**
 * Releases only the slot this caller holds.
 *
 * If cleanup assigned `ref.current = null` directly, it would also clear the controller that the
 * next generation had already placed there, and the stop button would then be unable to abort
 * anything. The slot is cleared only when the value is still this caller's.
 */
export function releaseOwnSlot<T>(current: T | null, mine: T): T | null {
	return current === mine ? null : current;
}

/**
 * Separates two facts.
 * - The user utterance entered the conversation. This is one local commit, and it is the reason
 *   to clear the input.
 * - The assistant response finished. This is known only after the network call ends, and it is
 *   unrelated to the input.
 *
 * The input used to be cleared right after `onSend()` was called. At that moment nothing had been
 * saved yet (the first save is `appendUserMessage`, below). If that write failed, the user lost
 * their own text from both the screen and the conversation, with no way back. So clearing now
 * happens when the conversation accepts the utterance, which is the signal this section produces.
 */

export interface CommitUserTurnInput {
	/** A turn needs only the append operation, not the whole session. */
	session: Pick<ConversationSession, "appendUserMessage">;
	/** Raw text from the input box. The trimming rule is defined in this one place. */
	text: string;
	/**
	 * Called only after the save has finished. It is the signal for the input box to clear its own
	 * value.
	 *
	 * It is a callback because of the direction of dependency. If the input box knew the store
	 * (ChatStore, Dexie or SQLite), it would need one copy per conversation kind, and the work test's
	 * input could not reuse it. With a callback, the lifecycle only reports that the utterance was
	 * accepted, and the input box knows only its own state.
	 */
	onAccepted?: (() => void) | undefined;
}

/**
 * Appends the user utterance to the conversation. Returns `true` on success.
 *
 * Does not swallow errors. A failure goes up to the caller's failure path, so **no provider request
 * starts**, because that call comes after this `await`. Swallowing here would send a request with
 * context from an utterance that was never saved, and its answer would attach to a conversation
 * missing its own question.
 *
 * An empty input returns `false`. That is the regenerate path: the user turn for that attempt is
 * already in history, so there is nothing to append, and appending again would make the question
 * appear as two lines.
 */
export async function commitUserTurn(
	input: CommitUserTurnInput,
): Promise<boolean> {
	const trimmed = input.text.trim();
	if (!trimmed) return false;

	await input.session.appendUserMessage(trimmed);

	/**
	 * Reaching this point is all that 'durably accepted' means.
	 *
	 * A failure in the callback does not fail the generation. By then the utterance is already saved.
	 * If an exception from clearing the input failed the turn, the user would see an error message
	 * above their own saved utterance.
	 */
	try {
		input.onAccepted?.();
	} catch {
		// The input box's problem. The conversation already holds the utterance.
	}
	return true;
}

/**
 * Whether this turn is waiting for an answer. This is the only basis for showing `Regenerate`
 * (regenerate).
 *
 * - User turn in conversation, assistant saved: not waiting (the turn is finished).
 * - User turn in conversation, assistant not saved: **waiting**.
 * - No user turn: not waiting.
 *
 * The last case is why this function exists. An attempt whose user utterance was never saved did
 * not happen, so it is not an unanswered turn. Marking it as unanswered would show `Regenerate`, but
 * that button would generate from the earlier history. The message the user just typed would appear
 * nowhere, and one more answer would attach to a past conversation.
 */
export function awaitsAnswer(input: {
	/**
	 * Whether this attempt's user utterance is in the conversation, either newly appended or already
	 * there from before.
	 */
	userTurnCommitted: boolean;
	assistantSaved: boolean;
}): boolean {
	return input.userTurnCommitted && !input.assistantSaved;
}

/**
 * The list used to require a full `ChatMessage`. That type carries sync metadata (`dirty`, `rev`,
 * `serverVersion`), tombstones, room identity and usage accounting. The renderer reads none of it,
 * except the id (the virtualizer's key), the role, the speaker, the body and the cut-off marker.
 *
 * Narrowing the type stops rows that are not persisted (streaming responses, work-test rows) from
 * getting invented `dirty`, `rev` or `deletedAt` values just to appear in the list. With no such
 * field in the input, there is nowhere to invent it, and no fake record can later flow toward
 * storage.
 *
 * Stored messages pass through unchanged, because `ChatMessage` is a superset of this shape.
 */
export interface ConversationDisplayMessage {
	/**
	 * Stable list key. Using the index would break every measurement as soon as a page is prepended.
	 */
	id: string;
	role: ChatMessage["role"];
	/**
	 * Speaker name for user utterances. Empty for the assistant, since several characters can appear
	 * together.
	 */
	speaker: string;
	content: string;
	/** A response that did not end normally. The content is left as is; only the marker is added. */
	incomplete?: boolean;
}
