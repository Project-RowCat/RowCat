import { jsx } from "./jsx-runtime.ts";
import type { RuntimeElement } from "./node.ts";

/**
 * Landing module for the development transform (the react-jsxdev setting). The compiler passes
 * source location along, which is the only difference from the production transform. This module
 * exists now for two reasons: without it, editors and tools configured for the dev transform fail
 * with 'module not found', and later runtime errors can be traced to creator source lines using
 * that location. Location is not stored on elements. A location string would travel through the
 * tree across the VM boundary and remain in the shipped artifact, growing the production payload.
 */

/**
 * The JSX namespace is defined in one place only. Redeclaring it here would give the development
 * and production transform modes different syntax rules, and the mismatch would appear only in
 * deployments where the editor and the compiler use different modes.
 */
export type { JSX } from "./jsx-runtime.ts";
export { Fragment } from "./jsx-runtime.ts";

export function jsxDEV(
	type: unknown,
	props: Record<string, unknown>,
	key?: string | number,
	_isStaticChildren?: boolean,
	_source?: unknown,
	_self?: unknown,
): RuntimeElement {
	return jsx(type, props, key);
}
