import type {
	ChatPersonaDescriptionRejection,
	ChatPersonaNameRejection,
	ChatPersonaSavePlan,
	ChatPersonaSnapshot,
	ChatPersonaSource,
} from "@rowcat/chat";
import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
	chatPersonaOrigin,
	chatTextLength,
	effectiveChatPersona,
	planPersonaSave as planPersonaSaveRule,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Wording for the persona form. The rules live in @rowcat/chat.
 * - The rules (planPersonaSave, checkPersonaName, chatTextLength) sit in the pure package because
 *   two consumers (web dialog, mobile settings) must not diverge. A silent mismatch would show a
 *   save button that does nothing, or save an unfixed role that syncs to other devices.
 * - What remains here is the Korean text and which field is wrong. The field travels with the
 *   reason so focus can move; recomputing it in the form would create a second verdict.
 */

export type PersonaFormField = "name" | "description";

export type PersonaPlan =
	/** A value that cannot be saved. The reason is attached to that field, and focus moves to it. */
	| { kind: "invalid"; field: PersonaFormField; message: string }
	/** Nothing changed. The dialog closes without writing, because an edit issues a new revision. */
	| { kind: "unchanged" }
	| { kind: "save"; name: string; description: string };

const nameCopy = (reason: ChatPersonaNameRejection): string => {
	const t = translator("persona");
	return reason === "empty"
		? t("nameEmpty")
		: t("nameTooLong", { max: CHAT_PERSONA_NAME_MAX_LENGTH });
};

const descriptionCopy = (_reason: ChatPersonaDescriptionRejection): string =>
	translator("persona")("descriptionTooLong", {
		max: CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	});

/** When `current` is absent this creates a new persona, so `unchanged` is never returned. */
export function planPersonaSave(
	input: { name: string; description: string },
	current?: ChatPersonaSnapshot | null,
): PersonaPlan {
	const plan: ChatPersonaSavePlan = planPersonaSaveRule(input, current);
	if (plan.kind !== "invalid") return plan;
	return plan.field === "name"
		? { kind: "invalid", field: "name", message: nameCopy(plan.reason) }
		: {
				kind: "invalid",
				field: "description",
				message: descriptionCopy(plan.reason),
			};
}

/**
 * Turns a failure into one human-readable sentence. The raw Dexie error is not shown: it does not
 * say what the user can do, and it exposes internal structure. The failure kinds are deliberately
 * not split: whether it was quota or a connection closed during an account switch, the user's next
 * step is the same.
 */
export const personaSaveFailureMessage = (): string =>
	translator("persona")("saveFailed");

export const personaDeleteFailureMessage = (): string =>
	translator("persona")("deleteFailed");

/**
 * Failure for applying a persona to a room. Deleting also counts as applying, so there is one
 * sentence.
 */
export const personaApplyFailureMessage = (): string =>
	translator("persona")("applyFailed");

/**
 * The delete confirmation also states what deleting does not do. Deleting from the library does
 * nothing to conversations already started with the persona; the room holds a copy of the value.
 * Without this, users avoid deleting for fear their conversation's speaker disappears, and users
 * who did delete read a working conversation as a failed delete.
 */
export const personaDeleteNotice = (): string =>
	translator("persona")("deleteNotice");

/**
 * Show the character count only when the limit is near. An always-visible counter follows the user
 * while typing and mostly says nothing. Same rule as rename and memory.
 */
export const PERSONA_NAME_COUNTER_THRESHOLD = CHAT_PERSONA_NAME_MAX_LENGTH - 20;
export const PERSONA_DESCRIPTION_COUNTER_THRESHOLD =
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH - 400;

/** The screen must count length in the same unit storage uses (code points). */
export const personaTextLength = chatTextLength;

/**
 * The label `Story's default persona` is deliberate. A plain `Default` would be read as RowCat's
 * default setting, but this role is chosen by the story's creator; other stories put a different
 * name in this slot.
 */
export const personaStoryDefaultLabel = (): string =>
	translator("persona")("storyDefault");

/** The story also suggests no role. This is a status to show, not an option the user picks. */
export const personaNoneLabel = (): string => translator("persona")("none");

/**
 * One-line hint shown before a name is known; the chat-start picker uses it. The story's suggested
 * role name lives in the replay snapshot, which arrives only after the user presses start, so the
 * name cannot be shown there. Writing `Not set` here would say no role exists when the story
 * suggests one. A wrong value is worse than a missing one, so the hint states what will happen
 * instead.
 */
export const personaStoryDefaultHint = (): string =>
	translator("persona")("storyDefaultHint");

/**
 * One line for the persona row on the settings home. The three states are not folded into one
 * sentence: a user-chosen role and a story-suggested role cannot be told apart by name alone. The
 * origin decision belongs to the shared predicate (chatPersonaOrigin); this function only selects
 * the sentence.
 */
export function personaRowSummary(source: ChatPersonaSource): string {
	const origin = chatPersonaOrigin(source);
	if (origin === "default") return personaNoneLabel();
	const name = effectiveChatPersona(source)?.name ?? "";
	return origin === "story" ? `${name} · ${personaStoryDefaultLabel()}` : name;
}

/** The empty library says what the feature is for before anything else, not a bare 'none' line. */
export const personaEmptyTitle = (): string =>
	translator("persona")("emptyTitle");
export const personaEmptyBody = (): string =>
	translator("persona")("emptyBody");
