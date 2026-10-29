/**
 * Sets up Monaco for tests by filling globals that jsdom does not provide. Web tests run in Node by
 * default; only the few files that need it opt into `@vitest-environment jsdom`.
 *
 * Syntax highlighting can only be checked with Monaco's tokenizer, which runs only on the standard
 * service graph. Without these globals, service creation throws before the grammar loads:
 * - CSS.escape, called by the icon stylesheet when building class names
 * - window.matchMedia, called by the theme service for the high-contrast preference
 * - document.queryCommandSupported, called by the paste contribution at load time
 *
 * The stub values do not change what is measured, which is the tokens.
 */

interface MediaQueryLike {
	matches: boolean;
	media: string;
	onchange: null;
	addEventListener(): void;
	removeEventListener(): void;
	addListener(): void;
	removeListener(): void;
	dispatchEvent(): boolean;
}

const mediaQuery = (media: string): MediaQueryLike => ({
	matches: false,
	media,
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
});

/** Idempotent. Called from each file, and it may run twice in the same process. */
export function installMonacoDomShims(): void {
	const target = globalThis as unknown as Record<string, unknown>;
	target.CSS ??= { escape: (value: string) => value };
	target.matchMedia ??= mediaQuery;
	if (typeof window !== "undefined") {
		const view = window as unknown as Record<string, unknown>;
		view.CSS ??= target.CSS;
		view.matchMedia ??= target.matchMedia;
	}
	if (typeof document !== "undefined") {
		const doc = document as unknown as Record<string, unknown>;
		doc.queryCommandSupported ??= () => false;
	}
}

/**
 * Waits until the grammar is actually set up. Monaco's tokenizer registration is asynchronous:
 * getOrCreate only starts it, while editor.tokenize reads synchronously. Measuring without waiting
 * returns one empty token per line, which looks the same as 'no colors at all', so the wait is what
 * makes the measurement meaningful.
 */
export async function waitForTokenizer(
	tokenize: (text: string, language: string) => { type: string }[][],
	language: string,
): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (tokenize("const a = 1;", language)[0]?.some((token) => token.type))
			return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`the tokenizer did not start: ${language}`);
}
