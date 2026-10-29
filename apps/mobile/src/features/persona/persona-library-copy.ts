import { PERSONA_DELETE_NOTICE } from "./persona-form.ts";

/**
 * The **copy** of the library screen. The rules live in `@rowcat/chat`; the form copy lives in
 * `persona-form.ts`.
 *
 * This file holds only the lines that exist on this screen alone (the guest note in the empty
 * state, the row action names, the delete confirmation). Validation copy is not repeated here, or
 * the same limit would be explained in two sentences.
 */

export const PERSONA_ADD_LABEL = "New persona";

/**
 * Names of the row actions — **say which persona each one is for.**
 *
 * The same icon appears once per row, so without a name a screen reader would read "edit button"
 * over and over with no way to tell which is which.
 */
export const personaRowActionsLabel = (
	name: string,
	action: "edit" | "delete",
): string => `${action === "edit" ? "Edit" : "Delete"} ${name}`;

export const PERSONA_DELETE_TITLE = "Delete this persona?";
export const PERSONA_DELETE_CONFIRM_LABEL = "Delete";

/**
 * Delete confirmation — says **what disappears and what remains**.
 *
 * The second sentence is this dialog's value (`PERSONA_DELETE_NOTICE`, the **same sentence** the
 * form uses). Deleting from the library does nothing to conversations already started, and without
 * saying so the user will not delete for fear that their conversation's speaker disappears.
 * Conversely, saying "it disappears everywhere" would be false: rooms hold their own copy of the
 * value.
 */
export const personaDeleteDescription = (name: string): string =>
	`The ${name} persona disappears from your library. ${PERSONA_DELETE_NOTICE}`;

/** Guest: explains why the list cannot be seen, before any sign-in redirect. */
export const PERSONA_GUEST_NOTE =
	"Personas are stored on your account and this device. Sign in to see the roles you saved.";

/** **Not signed out**: the stored session is unchanged; we simply could not ask the server. */
export const PERSONA_UNAVAILABLE_NOTE =
	"Couldn't check your session. Please try again in a moment.";

export const PERSONA_LIBRARY_STORAGE_ERROR =
	"Couldn't open this device's data. Personas can't be loaded.";

export const PERSONA_LIBRARY_READ_ERROR =
	"Couldn't load personas. Please try again in a moment.";
