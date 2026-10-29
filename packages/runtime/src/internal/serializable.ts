/**
 * Canonical vocabulary and predicates for serializable values, shared by state.ts and
 * internal/story-state.ts. Defining it here avoids an import cycle. A cycle would surface as
 * functions being called before their module finishes initializing, since the VM evaluates a static
 * ESM graph in order. `undefined` is excluded on purpose: JSON has no undefined, so `{ a: undefined
 * }` comes back as `{}` after a save and load. Absent values are written as `null`, as the RowCat
 * domain rule does.
 */

export type Serializable =
	| null
	| boolean
	| number
	| string
	| readonly Serializable[]
	| { readonly [key: string]: Serializable };

/**
 * Whether a type is serializable, while still accepting interfaces. `T extends Serializable` would
 * reject interfaces: TypeScript gives interfaces no implicit index signature, so an interface is
 * not assignable to an index-signature type (a type alias would pass). The resulting error names
 * the index signature, which hides the real cause. The mapped type instead rebuilds the structure.
 * If the rebuilt type is assignable to T, the value passes. Values that cannot be moved, such as
 * functions or Date, become `never` and are rejected.
 */
export type SerializableShape<T> = T extends null | boolean | number | string
	? T
	: T extends readonly (infer U)[]
		? readonly SerializableShape<U>[]
		: T extends (...args: never[]) => unknown
			? never
			: T extends object
				? { readonly [K in keyof T]: SerializableShape<T[K]> }
				: never;

/**
 * Checks a value for serializability. Cycles are detected with a visited set, not a depth limit. A
 * depth cap would reject ordinary deep values, and the author would have no way to learn why.
 */
export function isSerializable(value: unknown): value is Serializable {
	return check(value, new Set());
}

function check(value: unknown, seen: Set<object>): boolean {
	if (value === null) return true;
	const type = typeof value;
	if (type === "string" || type === "boolean") return true;
	/**
	 * NaN and Infinity are written as null by JSON, so saving and reloading would change the value.
	 * Only finite numbers pass.
	 */
	if (type === "number") return Number.isFinite(value);
	if (type !== "object") return false;

	const object = value as object;
	if (seen.has(object)) return false;
	seen.add(object);

	if (Array.isArray(object)) return object.every((entry) => check(entry, seen));

	/** Only plain objects pass. Date, Map, and class instances lose their shape when serialized. */
	const prototype = Object.getPrototypeOf(object) as unknown;
	if (prototype !== Object.prototype && prototype !== null) return false;

	return Object.values(object as Record<string, unknown>).every((entry) =>
		check(entry, seen),
	);
}

/**
 * Storage size is measured as serialized length, not item count or depth, because the serialized
 * length is the real cost of storing and transmitting the value. Unserializable values never reach
 * this function; callers reject them first.
 */
export function serializedLength(value: Serializable): number {
	return JSON.stringify(value).length;
}
