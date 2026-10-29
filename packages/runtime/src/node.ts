import { RUNTIME_ELEMENT } from "./internal/symbols.ts";

/**
 * Vocabulary of the runtime tree, deliberately not borrowed from React. Importing `ReactNode`,
 * `ReactElement`, or `JSX.Element` would tie the package to React's type contract:
 * - Creators would read the rest of React as present (`useContext`, `forwardRef`, `Suspense`),
 *   and none of those exist in this runtime.
 * - React's releases would change this VM's contract. React 19 added `Promise` to `ReactNode`, a
 *   shape this VM would then have to handle.
 * - DOM types come along. `@types/react` puts every HTML element into `JSX.IntrinsicElements`, so
 *   a creator's `<div />` would type-check. For that reason this file imports nothing except one
 *   symbol.
 */

/**
 * `undefined` is here as a consequence of syntax, not leniency. A component with `if (!open)
 * return;` has return type `undefined`, and an optional child is `undefined`. Leaving it out would
 * make both normal patterns type errors. `boolean` is accepted because `{open && <Text />}` yields
 * `false`. The reconciler treats it as nothing and does not draw the letters 'false'.
 */
export type RuntimePrimitive = string | number | boolean | null | undefined;

/**
 * A runtime element, the only shape `jsx()` creates. The symbol `$$typeof` is the whole forgery
 * defense: JSON cannot carry symbols, so a plain object from the network or storage cannot pass
 * this check.
 */
export interface RuntimeElement<TType = unknown, TProps = unknown> {
	readonly $$typeof: typeof RUNTIME_ELEMENT;
	readonly type: TType;
	readonly props: TProps;
	readonly key: string | number | null;
}

/**
 * Children arrays are readonly so creator code cannot change an array the reconciler is still
 * holding. This is only a type-level promise. The VM does the actual freezing.
 */
export type RuntimeNode =
	| RuntimePrimitive
	| RuntimeElement
	| readonly RuntimeNode[];

export interface RuntimeChildren {
	children?: RuntimeNode;
}

/**
 * The type of components creators write. The return type is `RuntimeNode`, not `RuntimeElement`, so
 * a component returning a string, or nothing under some conditions, is valid. That leniency holds
 * because `JSX.ElementType` decides separately which tags are eligible (see jsx-runtime.ts).
 */
export type RuntimeComponent<TProps = Record<never, never>> = (
	props: TProps,
) => RuntimeNode;

/**
 * The root of the app. The compiler identifies the program's root by requiring the entry file's
 * default export to have this type, so `export default 123` is caught as a type error.
 */
export type RuntimeApp = RuntimeComponent<Record<never, never>>;

/**
 * Whether a value is a runtime element. The reconciler and the tests both rely on this one
 * predicate.
 */
export function isRuntimeElement(value: unknown): value is RuntimeElement {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { $$typeof?: unknown }).$$typeof === RUNTIME_ELEMENT
	);
}
