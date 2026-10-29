/**
 * The script a journey gives the generation stream. It is the only vocabulary that both the browser
 * and the stub server read.
 *
 * Carrying it in one header is the point of this file. A control endpoint on the stub ('answer the
 * next request like this') would make state process-global, and two journeys running side by side
 * would overwrite each other's scripts. That failure does not reproduce; it appears only on some
 * runs.
 *
 * Because each request carries its own script, there is no shared state, so parallel runs are not a
 * condition of correctness.
 */

export type GenerationScriptEnding =
	/**
	 * Sends `done`. This is the only basis on which a generation may be recorded as a normal
	 * completion.
	 */
	| { kind: "done" }
	/**
	 * A failure after the stream has started (an `error` event). The status code is already 200, so by
	 * contract the failure goes out as this event, not as the shared error envelope.
	 */
	| { kind: "error"; code: string; message: string }
	/**
	 * Keeps the response open and sends nothing more, waiting.
	 *
	 * The stop journey uses this. If the response ended immediately, the user would have no window in
	 * which to press stop, and that journey would verify 'stopped an already-finished generation',
	 * which is not what it means to check.
	 */
	| { kind: "hang" };

export interface GenerationScript {
	chunks: string[];
	delayMs?: number;
	/**
	 * Delay before the first chunk, in ms. This axis creates the 'stop before the first token' case.
	 */
	leadMs?: number;
	ending: GenerationScriptEnding;
}

/**
 * The header that carries the script.
 *
 * If this header is absent, the stub produces nothing and forwards to the real API. That way
 * journeys unrelated to chat (room management, account isolation) cannot accidentally run on fake
 * generation.
 */
export const GENERATION_SCRIPT_HEADER = "x-e2e-generation";

export const encodeGenerationScript = (script: GenerationScript): string =>
	Buffer.from(JSON.stringify(script), "utf8").toString("base64");

export function decodeGenerationScript(
	value: string | undefined,
): GenerationScript | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, "base64").toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object") return null;
		const script = parsed as GenerationScript;
		return Array.isArray(script.chunks) && script.ending ? script : null;
	} catch {
		return null;
	}
}
