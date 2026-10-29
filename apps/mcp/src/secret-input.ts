import { StringDecoder } from "node:string_decoder";

/**
 * No-echo single-line input, where passwords and recovery codes pass.
 *
 * - `resume()` is the first line on purpose: `ask()` closes readline, which explicitly pauses
 *   stdin, and a `data` listener added afterwards does not restart a paused stream. With nothing
 *   left on the event loop Node exited 0 at the password prompt and `login`/`setup` never sent a
 *   request. `secret-input.test.ts` catches this by calling it with a paused stream.
 * - Collects characters, not bytes: joining `String.fromCharCode` per byte turns one UTF-8
 *   character into several Latin ones, so a Korean password would be sent as a different string
 *   than the server stored. The decoder rejoins characters split at chunk boundaries, and backspace
 *   removes the last character, not the last byte.
 * - End of input ends the read: if the pipe closes without a newline, the value collected so far
 *   is returned instead of waiting.
 */

export interface SecretInput {
	isTTY?: boolean;
	setRawMode?: (mode: boolean) => unknown;
	on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
	on(event: "end", listener: () => void): unknown;
	off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
	off(event: "end", listener: () => void): unknown;
	resume(): unknown;
	pause(): unknown;
}

export type SecretOutcome =
	| { readonly kind: "value"; readonly value: string }
	| { readonly kind: "interrupted" };

const CTRL_C = "";
const BACKSPACE = new Set(["", "\b"]);

export function readSecret(input: SecretInput): Promise<SecretOutcome> {
	const raw = input.isTTY === true;
	if (raw) input.setRawMode?.(true);
	const decoder = new StringDecoder("utf8");
	let chars: string[] = [];

	return new Promise<SecretOutcome>((resolve) => {
		const finish = (outcome: SecretOutcome): void => {
			input.off("data", onData);
			input.off("end", onEnd);
			if (raw) input.setRawMode?.(false);
			input.pause();
			resolve(outcome);
		};
		const onData = (chunk: Buffer | string): void => {
			const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
			for (const char of text) {
				if (char === "\r" || char === "\n") {
					finish({ kind: "value", value: chars.join("") });
					return;
				}
				if (char === CTRL_C) {
					finish({ kind: "interrupted" });
					return;
				}
				if (BACKSPACE.has(char)) {
					chars = chars.slice(0, -1);
					continue;
				}
				chars.push(char);
			}
		};
		const onEnd = (): void => {
			chars.push(...decoder.end());
			finish({ kind: "value", value: chars.join("") });
		};
		input.on("data", onData);
		input.on("end", onEnd);
		input.resume();
	});
}
