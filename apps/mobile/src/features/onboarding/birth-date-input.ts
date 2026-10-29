/**
 * The separator for the birth-date input. No age judgment lives here.
 *
 * ## Why it exists
 *
 * The web uses `<input type="date">`, which always yields `YYYY-MM-DD` whatever the browser's own
 * picker looks like. React Native has no such control, and `@rowcat/ui-native` has no date control
 * either. Adding a native date-picker dependency for this one screen would be a build-pipeline
 * change, not a component addition. So the screen shows a numeric keypad for eight digits, and this
 * function inserts the hyphens.
 *
 * ## It does not alter the value
 *
 * This function only places separators. It does not normalize the date (Feb 30 passes through),
 * fill in a year, or compare with today. Validity is decided by the server in the product timezone
 * (`declareAge` in `@rowcat/domain`). A client judging with its own clock would split decisions
 * across timezones, and that split would show up only as "under 14 but allowed through".
 *
 * ## Deleting must work
 *
 * If the hyphen were inserted as soon as four digits were typed, deleting it would just put it
 * back, and the user could never delete the last digit of the year. So a hyphen is inserted only
 * when more digits follow.
 */

/** Digit count of `YYYY-MM-DD`. The cap keeps a long pasted string from overflowing the field. */
const DIGITS = 8;

export function formatBirthDateInput(raw: string): string {
	const digits = raw.replace(/\D/g, "").slice(0, DIGITS);
	if (digits.length <= 4) return digits;
	if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
	return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
