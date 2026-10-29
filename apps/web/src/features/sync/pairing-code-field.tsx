import { maskPairingCodeInput } from "@rowcat/sync";
import { Input } from "@rowcat/ui-web/components/input";
import {
	type ComponentProps,
	type KeyboardEvent,
	useLayoutEffect,
	useRef,
} from "react";

/**
 * Input field for the pairing code. As the user types, it becomes uppercase and takes the shape
 * `XXXX-XXXX-XXXX-XXXX`.
 *
 * Normalization would accept any formatting anyway. The field exists because the screen must show
 * the result before approval. A user can only confirm by eye that the copied value matches the code
 * on the other screen if both are drawn the same way. Sixteen unformatted lowercase characters are
 * correct but hard to read.
 *
 * The folding rules (case, hyphens, Crockford look-alike letters such as `O→0`) belong to
 * `@rowcat/sync`, and this file only calls that function. If the screen folded characters itself,
 * the displayed characters and the characters used for derivation could diverge, and the failure
 * would look like 'the code was wrong'.
 *
 * This file handles only the caret. When the mask rewrites the value, browsers move the caret to
 * the end. In a sixteen-character field, the most common edit is correcting one character in the
 * middle.
 */
export function PairingCodeField({
	value,
	onValueChange,
	onKeyDown,
	...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
	value: string;
	/** The value passed here has always been through the mask. Callers do not clean it up again. */
	onValueChange: (next: string) => void;
}) {
	const ref = useRef<HTMLInputElement>(null);
	/**
	 * The caret position to apply on the next render. The value is stored alongside it because this
	 * effect also runs on renders for other reasons, such as an error message appearing. Applying a
	 * stale position then would make a caret the user moved jump back to where they last typed.
	 */
	const pending = useRef<{ caret: number; value: string } | null>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		const next = pending.current;
		pending.current = null;
		if (!element || !next || element.value !== next.value) return;
		element.setSelectionRange(next.caret, next.caret);
	});

	const apply = (next: string, codeCharsBefore: number): void => {
		pending.current = { caret: caretAfter(next, codeCharsBefore), value: next };
		onValueChange(next);
	};

	return (
		<Input
			{...props}
			ref={ref}
			value={value}
			onChange={(event) => {
				const element = event.currentTarget;
				const raw = element.value;
				const caret = element.selectionStart ?? raw.length;
				apply(maskPairingCodeInput(raw), codeCharsIn(raw.slice(0, caret)));
			}}
			onKeyDown={(event) => {
				handleBackspaceOverSeparator(event, value, apply);
				onKeyDown?.(event);
			}}
			// Normalization absorbs case and hyphens anyway. This hint is for mobile keyboards.
			autoCapitalize="characters"
			autoComplete="off"
			autoCorrect="off"
			spellCheck={false}
			inputMode="text"
		/>
	);
}

/**
 * Backspace right after a hyphen deletes the code character before it, not just the hyphen. If that
 * were not prevented, the browser would delete only the hyphen and the mask would restore it at
 * once. Nothing would visibly change, and users would learn that backspace must be pressed twice to
 * delete one character.
 */
function handleBackspaceOverSeparator(
	event: KeyboardEvent<HTMLInputElement>,
	value: string,
	apply: (next: string, codeCharsBefore: number) => void,
): void {
	if (event.key !== "Backspace" || event.defaultPrevented) return;
	const element = event.currentTarget;
	const caret = element.selectionStart;
	// A range selection is left to the browser, since what to delete is already determined.
	if (caret === null || caret !== element.selectionEnd || caret < 2) return;
	if (value[caret - 1] !== "-") return;
	event.preventDefault();
	const kept = value.slice(0, caret - 2);
	apply(maskPairingCodeInput(kept + value.slice(caret)), codeCharsIn(kept));
}

/**
 * Counts the code characters that survive, using the mask. Using the mask is the point: repeating
 * the character class here would create a second copy of the folding table, and that copy would go
 * stale silently when the alphabet changes.
 */
const codeCharsIn = (text: string): number =>
	maskPairingCodeInput(text).replace(/-/g, "").length;

function caretAfter(masked: string, count: number): number {
	if (count <= 0) return 0;
	let seen = 0;
	for (let index = 0; index < masked.length; index += 1) {
		if (masked[index] === "-") continue;
		seen += 1;
		if (seen === count) return index + 1;
	}
	return masked.length;
}
