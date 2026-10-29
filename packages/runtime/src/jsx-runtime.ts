import { RUNTIME_ELEMENT } from "./internal/symbols.ts";
import type { RuntimeElement, RuntimeNode } from "./node.ts";

/**
 * Landing module for the automatic JSX transform (`jsx: react-jsx` with `jsxImportSource:
 * @rowcat/runtime`).
 * The 'react' in the option name describes the transform's shape, not a dependency on React. This
 * module owns the JSX namespace. TypeScript resolves JSX types from the namespace exported here, so
 * it defines the language's syntax rules. React DOM's JSX types, even when present in the program,
 * are not visible to creator code.
 */

/**
 * Fragment is a symbol, identified like host primitives and not by name. Unlike primitives it need
 * not be callable: JSX syntax does not use it as a tag, and the compiler inserts it directly.
 */
export const Fragment: unique symbol = Symbol("rowcat.runtime.fragment");

export function jsx(
	type: unknown,
	props: Record<string, unknown>,
	key?: string | number,
): RuntimeElement {
	return element(type, props, key);
}

/**
 * Element with several children. `jsxs` has the same implementation as `jsx` but a separate name,
 * because the compiler distinguishes the two. That signal (whether children are statically an
 * array) lets the reconciler skip key checks later. Merging the two would lose the signal
 * permanently.
 */
export function jsxs(
	type: unknown,
	props: Record<string, unknown>,
	key?: string | number,
): RuntimeElement {
	return element(type, props, key);
}

function element(
	type: unknown,
	props: Record<string, unknown>,
	key?: string | number,
): RuntimeElement {
	/**
	 * Props are frozen when stored. The compiler passes an object owned by the caller, and creator
	 * code could mutate it while the reconciler still holds it, making the tree and the screen
	 * diverge. A shallow freeze closes that window one level deep. A deep freeze costs too much, so
	 * the VM boundary covers the rest.
	 */
	return Object.freeze({
		$$typeof: RUNTIME_ELEMENT,
		type,
		props: Object.freeze({ ...props }),
		key: key === undefined ? null : key,
	});
}

/**
 * The JSX rules of this language.
 * - `IntrinsicElements` is empty. That absence is the only thing blocking `<div />`. Lowercase
 *   tags are looked up in this table, so with an empty table no lowercase tag exists. Capitalized
 *   imported values are primitives for the same reason: `<Stack>` is a value reference and never
 *   reaches this table.
 * - `ElementType` exists because without it TypeScript checks that a component's return type is
 *   `JSX.Element`. That would reject a component returning a string, which is valid here because
 *   `RuntimeNode` includes strings. `ElementType` moves the check to tag eligibility instead.
 * - The `never` parameter uses contravariance: any component accepting some props type is
 *   assignable to this type, so a function accepting any props and returning a runtime node can be
 *   written without `any`.
 */
export namespace JSX {
	export type ElementType = (props: never) => RuntimeNode;
	export type Element = RuntimeElement;
	export interface ElementChildrenAttribute {
		children: Record<never, never>;
	}
	/**
	 * Attribute accepted by every element: `key`. Without it, `<Text key={i}>` fails with 'key does
	 * not exist on TextProps'. `key` is reconciler metadata rather than a prop, so it is not in
	 * component prop types. The compiler also does not put it in `props` (it is the third argument of
	 * `jsx(type, props, key)`), so a component cannot read `props.key`. That is intended.
	 */
	export interface IntrinsicAttributes {
		key?: string | number | null;
	}
	/**
	 * Intentionally empty. The absence is what blocks `<div />`. `Record<never, never>` is used
	 * because it is an empty object type the linter permits; it means the same as `{}`.
	 */
	export type IntrinsicElements = Record<never, never>;
}
