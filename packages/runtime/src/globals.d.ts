/**
 * Globals of the author's program: declare only what the runtime VM actually sets up. The author's
 * program has no DOM and no Node (lib ES2022), so `console` does not exist unless declared. The VM
 * prelude sets up `console.log`, `warn` and `error` and wires them to the host's `onConsole`
 * (builtins/prelude.ts in @rowcat/runtime-host). Only those three are declared; declaring `info`,
 * `debug`, `table` or `group` would suggest functions that do not exist.
 * - `interface Console` plus `declare var console` matches lib.dom.d.ts and @types/node, so in a
 *   program that loads them too, the interfaces merge and the same-typed var redeclaration is fine.
 *   A `declare const` would be a redeclaration error.
 * - This is a .d.ts because there is nothing to run; the sandbox build skips it
 *   (scripts/lib/sandbox-build.ts).
 */

interface Console {
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

declare var console: Console;
