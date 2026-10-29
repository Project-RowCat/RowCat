/**
 * Cache keys: one versioned namespace, with every segment built by us.
 *
 * ```text
 * cache:1:gallery:guest:all:any:recent:all:1:24
 * |     | |       |
 * prefix version namespace  normalized axes
 * ```
 *
 * - The version exists because when a cached value's shape changes, new code can read what an old
 *   deployment wrote during a rolling deploy. The TTL (30s) closes that window on its own, but new
 *   code still meets an unknown shape meanwhile. Bumping the version makes the window
 *   unrepresentable: nobody reads the old keys and the TTL clears them. It is the storage version
 *   (`cache:2:...`), bumped by the commit that changes a value's shape, not per release.
 * - Secrets, cookies, auth headers, session ids, member ids and search terms must not enter a
 *   segment. This file does not enforce that (the caller's axis list does; the first consumer is
 *   `services/story/gallery-cache.ts`); it only folds the axes into one deterministic string.
 * - The delimiter is enforced here: a `:` in a segment would make different axis combinations
 *   collide (`["a:b", "c"]` vs `["a", "b:c"]`), and the symptom is one filter drawing another's
 *   result with no error.
 */

/** Version of the stored value's shape; bump when its meaning changes. */
export const CACHE_KEY_VERSION = 1;

/** Prefix for every cache key; keeps this apart from other consumers (rate limiting). */
const CACHE_KEY_PREFIX = "cache";

/**
 * Narrow on purpose: accepting objects would let callers pass a whole filter object
 * (`JSON.stringify(filters)`), tying the key to field order and future fields. `null` means
 * "unspecified" and has its own notation, distinct from an empty string.
 */
export type CacheKeyPart = string | number | boolean | null;

const segment = (part: CacheKeyPart): string => {
	if (part === null) return "-";
	const text = String(part);
	// Throwing is right: this is not user input but a caller putting a free string in the axis list
	// (search terms are the first candidate), and continuing would make two filters share a slot
	// silently.
	if (text.includes(":"))
		throw new Error("[cache] a key segment can't contain the separator (:)");
	return text;
};

/** Deterministic: same axes always give the same string, and any differing axis gives a different one (the delimiter check protects the second property). */
export function cacheKey(
	namespace: string,
	parts: readonly CacheKeyPart[],
): string {
	return [
		CACHE_KEY_PREFIX,
		CACHE_KEY_VERSION,
		segment(namespace),
		...parts.map(segment),
	].join(":");
}
