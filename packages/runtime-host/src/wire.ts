/**
 * Wire values: the only shape that crosses between the VM and the host.
 *
 * Only what JSON represents is accepted: null, booleans, finite numbers, strings, arrays, and plain
 * objects. `undefined`, functions, symbols, BigInt, Map, Set, Date, Error, Promise, cyclic
 * references, host objects, and VM handles are all rejected deterministically. The adapter does not
 * rely on the engine's best-effort conversion, which silently drops `undefined` and turns `Date`
 * into a string. That leniency is exactly where the two realms would read the same value
 * differently.
 *
 * Limits are here: depth, string length, entry count, and total size. Production values are not
 * decided yet. `DEFAULT_WIRE_LIMITS` holds conservative PoC values, and tests may change them. The
 * existence of limits is structural, though: without them, one line of creator code could claim
 * arbitrary host memory.
 *
 * The same check exists inside the VM. The trusted prelude (`builtins/prelude.ts`) serializes
 * values under the same rules. There are two copies because each side of the boundary distrusts the
 * other. The VM-side check reduces the bytes sent to the host. The host-side check is the final
 * authority, because VM-side code still runs inside the VM, which is the creator's domain.
 */

export type RuntimeWireValue =
	| null
	| boolean
	| number
	| string
	| readonly RuntimeWireValue[]
	| { readonly [key: string]: RuntimeWireValue };

export interface RuntimeWireLimits {
	/** Maximum nesting depth. The root is depth 1. */
	maxDepth: number;
	/** Maximum length of one string, in UTF-16 code units. */
	maxStringLength: number;
	/** Maximum combined count of array items and object keys. */
	maxEntries: number;
	maxSerializedLength: number;
}

export const DEFAULT_WIRE_LIMITS: RuntimeWireLimits = Object.freeze({
	maxDepth: 32,
	maxStringLength: 262_144,
	maxEntries: 20_000,
	maxSerializedLength: 1_048_576,
});

export type WireCheck =
	| { ok: true }
	| { ok: false; reason: string; path: string };

const objectPrototype = Object.prototype;
/**
 * Names that cannot be keys on either side. `__proto__` becomes an own property through
 * `JSON.parse` and passes the prototype check. The other two are the same class of
 * prototype-pollution path. The prelude serializer keeps the same list. If the lists diverge, the
 * same value passes on only one side.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

/**
 * Whether a value can cross the wire. This does not use `instanceof`, because an array from another
 * realm does not inherit this realm's `Array`. It checks `Array.isArray` and whether the prototype
 * is `Object.prototype` or `null`. That condition rejects `Map`, `Date`, class instances, and
 * `Error` in one line.
 */
export function checkWireValue(
	value: unknown,
	limits: RuntimeWireLimits = DEFAULT_WIRE_LIMITS,
): WireCheck {
	const stack: unknown[] = [];
	let entries = 0;

	const visit = (node: unknown, depth: number, path: string): WireCheck => {
		if (depth > limits.maxDepth)
			return { ok: false, reason: "depth exceeded", path };
		if (node === null) return { ok: true };
		switch (typeof node) {
			case "boolean":
				return { ok: true };
			case "number":
				return Number.isFinite(node)
					? { ok: true }
					: { ok: false, reason: "non-finite number", path };
			case "string":
				return node.length <= limits.maxStringLength
					? { ok: true }
					: { ok: false, reason: "string too long", path };
			case "object":
				break;
			default:
				return { ok: false, reason: `unsupported type ${typeof node}`, path };
		}
		if (stack.includes(node)) return { ok: false, reason: "cycle", path };
		stack.push(node);
		try {
			if (Array.isArray(node)) {
				for (let index = 0; index < node.length; index += 1) {
					if (++entries > limits.maxEntries)
						return { ok: false, reason: "too many entries", path };
					const result = visit(node[index], depth + 1, `${path}[${index}]`);
					if (!result.ok) return result;
				}
				return { ok: true };
			}
			const prototype = Object.getPrototypeOf(node);
			if (prototype !== objectPrototype && prototype !== null)
				return { ok: false, reason: "not a plain object", path };
			for (const key of Object.keys(node as object)) {
				/**
				 * `JSON.parse` makes `__proto__` an own data property, which passes the prototype check above.
				 * If that key reached a handler, a single `Object.assign` or key copy would pollute prototypes.
				 * The VM-side serializer silently drops the same key (its setter catches it), so the two sides
				 * could diverge. Both sides reject it.
				 */
				if (FORBIDDEN_KEYS.has(key))
					return { ok: false, reason: "forbidden key", path: `${path}.${key}` };
				if (++entries > limits.maxEntries)
					return { ok: false, reason: "too many entries", path };
				const result = visit(
					(node as Record<string, unknown>)[key],
					depth + 1,
					`${path}.${key}`,
				);
				if (!result.ok) return result;
			}
			return { ok: true };
		} finally {
			stack.pop();
		}
	};

	return visit(value, 1, "$");
}

export type WireDecode =
	| { ok: true; value: RuntimeWireValue }
	| { ok: false; reason: string };

/** Host to wire. Only values that pass the check become strings. */
export function encodeWireValue(
	value: unknown,
	limits: RuntimeWireLimits = DEFAULT_WIRE_LIMITS,
): { ok: true; json: string } | { ok: false; reason: string } {
	const check = checkWireValue(value, limits);
	if (!check.ok)
		return { ok: false, reason: `${check.reason} at ${check.path}` };
	const json = JSON.stringify(value);
	if (json.length > limits.maxSerializedLength)
		return { ok: false, reason: "serialized value too large" };
	return { ok: true, json };
}

/**
 * Wire to host. The VM's string is not trusted. Its size is checked first, then it is parsed and
 * walked again. `JSON.parse` yields only plain objects and arrays, so the prototype check passes in
 * form, but depth and entry count are known only after parsing.
 */
export function decodeWireValue(
	json: string,
	limits: RuntimeWireLimits = DEFAULT_WIRE_LIMITS,
): WireDecode {
	if (json.length > limits.maxSerializedLength)
		return { ok: false, reason: "serialized value too large" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, reason: "malformed json" };
	}
	const check = checkWireValue(parsed, limits);
	if (!check.ok)
		return { ok: false, reason: `${check.reason} at ${check.path}` };
	return { ok: true, value: parsed as RuntimeWireValue };
}
