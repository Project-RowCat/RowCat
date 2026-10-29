/**
 * Runtime value identity is a symbol, not a name. The reconciler recognizes `<Stack>` by symbol
 * key, never by function name or source text. Three reasons:
 * - Bundlers mangle function names. A reconciler that checks `type.name === 'Stack'` would treat
 *   every element as unknown once minification is enabled.
 * - The VM's ABI must not depend on JavaScript names. A future WASM VM receives these values and
 *   tells the host what to draw. If the protocol used function names, a rename would break it.
 * - Names are easy to forge. Creator code defining `function Stack() {}` would be read as a host
 *   element. Identity is therefore a stable string (RuntimeHostKind) attached to a symbol key, and
 *   that string is the protocol vocabulary. Function names are read nowhere. `Symbol.for` is not
 *   used. The global registry returns the same symbol across realms, so two copies of this package
 *   would silently coexist, and a tree mixing their elements would pass as valid. Duplicate copies
 *   should be visible.
 */

export const RUNTIME_ELEMENT: unique symbol = Symbol("rowcat.runtime.element");

/** Host component marker. A value carrying this key is one of our primitives. */
export const RUNTIME_HOST: unique symbol = Symbol("rowcat.runtime.host");

export const RUNTIME_STORY_STATE: unique symbol = Symbol(
	"rowcat.runtime.storyState",
);

/**
 * Marker for persistent state definitions. It must differ from the story-state symbol. If both
 * shared one brand, `useStoryState(persistentDefinition)` would type-check and silently read the
 * other lifetime's value. The bug would surface only when a playthrough reset erases that value,
 * which can mean months of progress.
 */
export const RUNTIME_PERSISTENT_STATE: unique symbol = Symbol(
	"rowcat.runtime.persistentState",
);

/**
 * Marker for asset references. Creator code cannot name this key: the module is outside the import
 * allowlist (RUNTIME_BUILTIN_SPECIFIERS), so no syntax can write it. The contents of a reference
 * are not public API. `AssetRef` is an opaque type rather than a string alias, because creators
 * would otherwise concatenate and slice references, and a future host would receive shapes it never
 * issued.
 */
export const RUNTIME_ASSET: unique symbol = Symbol("rowcat.runtime.asset");

/**
 * Marker for color values. A brand is required because TypeScript cannot express this format in a
 * type (see the header of color.ts). Without a brand, `RuntimeColor` would be a plain string, and
 * unvalidated values could sit in that slot.
 */
export const RUNTIME_COLOR: unique symbol = Symbol("rowcat.runtime.color");

/**
 * Marker for host controllers, the values returned by `useScrollController()` and
 * `useTextEntryController()`. Like `AssetRef`, the contents are not expressible in creator code:
 * the module is outside the import allowlist, and there is no syntax for `controller.nodeId`. The
 * host issues an integer inside the controller, and that opacity is the slice's main security
 * property. A plain wrapped number could be forged, turning the API into a channel that sends
 * commands to any host node.
 */
export const RUNTIME_CONTROL: unique symbol = Symbol("rowcat.runtime.control");
