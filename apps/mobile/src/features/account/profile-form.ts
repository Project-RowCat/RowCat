import { BIO_LIMITS, NICKNAME_LIMITS } from "@rowcat/contracts";

/**
 * Pure decisions for the profile form: validation before submit and whether submitting is allowed.
 *
 * Restates the server and SDK rules in Korean (same place as the web `profile-section.tsx`). The
 * contract (`NicknameUpdateDto`, `BioUpdateDto`) is the final verdict and the SDK filters once more
 * before sending, but their sentences are zod talking to developers, so users are answered here.
 * Length numbers use the contract's exported constants; hand-typed, only one side survives the day
 * a limit changes.
 *
 * Pure functions rather than a hook because this app's tests do not render screens; a rule like "an
 * empty nickname is not submitted" inside a component could only be checked by trying it.
 */

/** Verdict on the nickname draft; without `error` the value can be sent. */
export interface NicknameCheck {
	/** The value actually sent. The SDK sends the trimmed value, so drawing the original would make the name move when the response arrives. */
	trimmed: string;
	error: string | null;
	/** Whether it equals the saved value; a round trip saving the same value looks like nothing happened. */
	unchanged: boolean;
}

export function checkNickname(draft: string, saved: string): NicknameCheck {
	const trimmed = draft.trim();
	const error =
		trimmed.length < NICKNAME_LIMITS.min
			? "Please enter a nickname."
			: trimmed.length > NICKNAME_LIMITS.max
				? `Nicknames must be at most ${NICKNAME_LIMITS.max} characters.`
				: null;
	return { trimmed, error, unchanged: trimmed === saved };
}

/** Verdict on the bio draft. */
export interface BioCheck {
	trimmed: string;
	/** Current character count, drawn with the limit. Never silently trimmed (no `maxLength`). */
	count: number;
	/** Over the limit: saving is locked, and the count and sentence state the overflow. */
	tooLong: boolean;
	error: string | null;
	unchanged: boolean;
}

export function checkBio(draft: string, saved: string): BioCheck {
	const trimmed = draft.trim();
	const tooLong = trimmed.length > BIO_LIMITS.max;
	return {
		trimmed,
		count: trimmed.length,
		tooLong,
		error: tooLong
			? `Bios must be at most ${BIO_LIMITS.max} characters.`
			: null,
		unchanged: trimmed === saved,
	};
}

/**
 * The answer to one save: success and failure are one value.
 *
 * Held as separate states, "saved" and a failure sentence could stand together (same judgment as
 * the web `SaveResult`). `null` means nothing has been pressed yet, and starting a save returns
 * here.
 */
export type SaveResult =
	| { kind: "saved" }
	| { kind: "error"; message: string }
	| null;

/**
 * Once editing starts the last `Saved` is false: it claims the field's text is saved, and one changed
 * character makes that untrue. The failure sentence stays: it says why the value just sent was
 * rejected, and if it vanished while fixing, the user could not see what to fix.
 */
export const dropStaleSaved = (current: SaveResult): SaveResult =>
	current?.kind === "saved" ? null : current;
