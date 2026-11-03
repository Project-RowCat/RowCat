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
import { deferredGroup, translator } from "../../lib/i18n/instance.ts";

/**
 * The **copy** of the persona form. The rules live in `@rowcat/chat`.
 *
 * The rule side (`planPersonaSave`, `checkPersonaName`, `chatTextLength`) sits in the pure package
 * for the same reason as memory and rename: it has two consumers (the web dialog and the mobile
 * settings surface), and when any of the three is wrong the failure is silent. The save button does
 * nothing, or a role the user did not change is saved and sent to other devices, or the two apps
 * disagree on what "a name that is too long" means.
 *
 * This file moved out of `features/chat/` as the first change of the settings slice. While room
 * settings' picker was the only consumer, that location was right. Once the library's home became
 * `/settings/personas`, the settings screen imported a file from the conversation folder. That
 * import direction says "the library is a child of conversation", but this value is the opposite
 * (`@rowcat/chat`'s `persona.ts`: the library is an **account asset**, not a child of any
 * conversation). That is why it moved to a neutral folder instead of being copied twice; web has a
 * folder with the same name too.
 *
 * Web has **a file with the same name and the same sentences** (`apps/web/src/features/persona/`).
 * The copy is intentional: the apps do not import each other, and moving the copy into a shared
 * package would tie pure rules to a locale. Only the sentences can diverge; the rules stay in one
 * place.
 *
 * What stays here is the Korean text and **which field is wrong**. The field comes with the copy
 * because of focus: if the form recomputed that answer, the judgement would exist in two places and
 * drift apart.
 */

export type PersonaFormField = "name" | "description";

export type PersonaPlan =
	/** A value that cannot be saved: attach the reason to that field and move focus there. */
	| { kind: "invalid"; field: PersonaFormField; message: string }
	/** Nothing changed: **close without writing** (an edit issues a revision). */
	| { kind: "unchanged" }
	| { kind: "save"; name: string; description: string };

const nameCopy = (reason: ChatPersonaNameRejection): string =>
	reason === "empty"
		? translator("persona")("nameEmpty")
		: translator("persona")("nameTooLong", {
				max: CHAT_PERSONA_NAME_MAX_LENGTH,
			});

const descriptionCopy = (_reason: ChatPersonaDescriptionRejection): string =>
	translator("persona")("descriptionTooLong", {
		max: CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	});

/** With no `current`, this is **a create**, so `unchanged` is never returned. */
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
 * The persona sentences, read in the drawn language (`persona.copy`). One table, because the room
 * settings and the story start dialog draw the same words the library does. What they decide, and a
 * translation keeps:
 *
 * - Failures are one sentence a person can read (`saveFailed`, `deleteFailed`, `applyFailed`), never
 *   the raw storage message, and the cases are not split — each leaves the same next step. Deleting
 *   also counts as applying on the room side, so `applyFailed` is one sentence.
 * - `deleteNotice` states what deleting does **not** do: conversations already started keep their own
 *   copy of the role. Unsaid, people would not delete for fear of losing the speaker, or would read an
 *   intact conversation as a failed delete.
 * - `storyDefault` says **the story's** default, not a bare "default" (which reads as RowCat's);
 *   `none` is a state, not a choice; `storyDefaultHint` describes what will happen, because before
 *   start the proposed role's name is not known yet — writing `Not set` there would be a wrong value.
 * - `emptyTitle`/`emptyBody`: an empty library says first what the feature is for.
 */
export const PERSONA_COPY = deferredGroup("persona", "copy");

/**
 * Whether to **show** the character count: only when the limit is near.
 *
 * If it were always visible, the number would follow the user while they type, and in most cases it
 * says nothing (the same rule as rename and memory).
 */
export const PERSONA_NAME_COUNTER_THRESHOLD = CHAT_PERSONA_NAME_MAX_LENGTH - 20;
export const PERSONA_DESCRIPTION_COUNTER_THRESHOLD =
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH - 400;

/** Length the screen counts; must use the same unit as the store (code points). */
export const personaTextLength = chatTextLength;

/**
 * **One line** drawn by the persona row on the settings home.
 *
 * The three cases are not folded into one sentence. A role the user chose and a role the work
 * proposed cannot be told apart by name alone, and without that distinction the user cannot answer
 * "did I pick this?". The judgement belongs to the shared predicate (`chatPersonaOrigin`); this
 * function only picks the sentence.
 */
export function personaRowSummary(source: ChatPersonaSource): string {
	const origin = chatPersonaOrigin(source);
	if (origin === "default") return PERSONA_COPY.none;
	const name = effectiveChatPersona(source)?.name ?? "";
	return origin === "story"
		? translator("persona")("storySummary", {
				name,
				label: PERSONA_COPY.storyDefault,
			})
		: name;
}
