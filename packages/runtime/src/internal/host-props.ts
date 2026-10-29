import { isAssetRef, runtimeAssetPath } from "../asset.ts";
import type { RuntimeHostKind } from "../component.ts";
import {
	checkRuntimeScale,
	checkRuntimeTranslate,
	classifyRuntimeTransition,
} from "../transition.ts";
import {
	isRuntimeControl,
	type RuntimeControlKind,
	runtimeControlRef,
} from "./control.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";

/**
 * Host primitive props are normalized before they cross the boundary. Values that do not fold into
 * this vocabulary are rejected.
 *
 * A best-effort conversion would render something other than what the creator wrote, with no error.
 *
 * - null, boolean, number, string: passed through.
 * - Plain objects and arrays: recursed. Style values have this shape.
 * - AssetRef: an object with the `$asset` key. The asset kind is derived from the value.
 * - Controller: an object with the `$control` key. Allowed only in the `controller` prop, and
 *   only when the kind matches.
 * - Function: a handler. Replaced by a `$handler` id at commit time.
 * - undefined: same as a missing key.
 * - Anything else (symbol, element, class instance, cycle): runtime_invalid_host_prop.
 */

export type HostValue =
	| null
	| boolean
	| number
	| string
	| HostValue[]
	| { [key: string]: HostValue };

type Handler = (...args: unknown[]) => unknown;

export interface NormalizedHostProps {
	readonly values: Record<string, HostValue>;
	/** Function props. The commit obtains their numbers from the handler registry. */
	readonly handlers: Record<string, Handler>;
}

/**
 * Nesting limit for prop values. Style objects never go deeper than 2 levels; the limit is set
 * generously.
 */
const MAX_PROP_DEPTH = 8;

const objectPrototype = Object.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const keysOf = Object.keys;
const isFiniteNumber = Number.isFinite;

const invalid = (name: string, why: string): RuntimeError =>
	new RuntimeError(
		RUNTIME_ERROR_CODE.invalidHostProp,
		`The prop "${name}" has a value that can't be sent to the host: ${why}`,
	);

function normalizeValue(
	name: string,
	value: unknown,
	depth: number,
	stack: object[],
): HostValue {
	if (value === null) return null;
	switch (typeof value) {
		case "boolean":
			return value;
		case "number":
			if (!isFiniteNumber(value))
				throw invalid(name, "It is not a finite number.");
			return value;
		case "string":
			return value;
		case "object":
			break;
		default:
			throw invalid(name, `${typeof value} values can't be sent.`);
	}
	const object = value as object;
	if (isAssetRef(object)) return { $asset: runtimeAssetPath(object) };
	/**
	 * A controller is a value only in the `controller` prop slot. normalizeHostProps handles that slot
	 * separately. Inside a style or an array, a controller would fold to a plain object (`{}`) and
	 * vanish silently. So it is rejected at that position.
	 */
	if (isRuntimeControl(object))
		throw invalid(name, "A controller can go only in the controller prop.");
	if (depth > MAX_PROP_DEPTH) throw invalid(name, "It is nested too deeply.");
	for (let index = 0; index < stack.length; index += 1)
		if (stack[index] === object)
			throw invalid(name, "It is a circular reference.");
	stack.push(object);
	try {
		if (isArray(object)) {
			const out: HostValue[] = [];
			for (let index = 0; index < object.length; index += 1)
				out.push(normalizeValue(name, object[index], depth + 1, stack));
			return out;
		}
		const prototype = getPrototypeOf(object);
		if (prototype !== objectPrototype && prototype !== null)
			throw invalid(name, "It is not a plain object.");
		const out: { [key: string]: HostValue } = {};
		for (const key of keysOf(object)) {
			const entry = (object as Record<string, unknown>)[key];
			if (entry === undefined) continue;
			out[key] = normalizeValue(name, entry, depth + 1, stack);
		}
		return out;
	} finally {
		stack.pop();
	}
}

/**
 * Kinds that hold no children. The reconciler rejects children for these kinds using this set.
 *
 * The type (`children?: never`) already blocks this, but the type is not a boundary. Nodes built by
 * computation and values passed through `as` bypass it. Silently dropping the children would lose
 * the creator's text without a word.
 */
export const CHILDLESS_HOST_KINDS: ReadonlySet<RuntimeHostKind> = new Set([
	"audio",
] as const);

/**
 * Value-range check for one prop. One table per kind, one hand-written check per name.
 *
 * Only values the type cannot exclude belong here. `volume?: number` accepts 5 and NaN, and each
 * platform would then coerce them differently: web throws a RangeError, native clamps silently.
 *
 * Rejecting in the VM gives the creator an error for their own code. runtime_invalid_host_prop is
 * creator-grade, so the previous screen stays. It also keeps the verdict identical on every
 * platform.
 */
type ValueCheck = (value: HostValue) => string | null;

const unitInterval: ValueCheck = (value) =>
	typeof value === "number" && value >= 0 && value <= 1
		? null
		: "It must be a number between 0 and 1.";

const restartKey: ValueCheck = (value) =>
	typeof value === "string" || typeof value === "number"
		? null
		: "It must be a string or a number.";

/**
 * One transition. The verdict is made by `classifyRuntimeTransition` alone.
 *
 * The range is not written again here, because both renderers and the server pass through the same
 * function. A copy would let one side accept `{ duration: -1 }`, which would freeze the screen only
 * on that platform.
 */
const transition: ValueCheck = (value) => {
	const verdict = classifyRuntimeTransition(value);
	return verdict.ok ? null : verdict.reason;
};

/**
 * Moving axes inside a box style. A type-valid wrong value really lives here: `translateX?: number`
 * accepts Infinity and NaN.
 *
 * Only the range of the three axes is checked. Unknown keys and the other style axes (length,
 * color, alignment) are still checked by name in the renderer tables.
 */
const boxStyleMotion: ValueCheck = (value) => {
	if (value === null) return null;
	if (typeof value !== "object" || isArray(value))
		return "It must be a plain object.";
	const record = value as { [key: string]: HostValue };
	for (const axis of ["translateX", "translateY"] as const) {
		if (!Object.hasOwn(record, axis)) continue;
		const why = checkRuntimeTranslate(record[axis]);
		if (why !== null) return `${axis}: ${why}`;
	}
	if (Object.hasOwn(record, "scale")) {
		const why = checkRuntimeScale(record.scale);
		if (why !== null) return `scale: ${why}`;
	}
	return null;
};

/**
 * Kinds that accept transitions and transforms: exactly the kinds that accept `style?:
 * RuntimeStyle`.
 *
 * Text, button, progress and screen are excluded, matching how `RuntimeTransitionable` is defined
 * in component.ts. The type already blocks this, but the type is not a boundary. A prop that passes
 * here silently would be missing from the renderer table, and that fails the whole batch.
 */
const TRANSITIONABLE_CHECKS: Readonly<Record<string, ValueCheck>> = {
	transition,
	style: boxStyleMotion,
};

const VALUE_CHECKS: Partial<
	Readonly<Record<RuntimeHostKind, Readonly<Record<string, ValueCheck>>>>
> = {
	audio: { volume: unitInterval, restartKey },
	view: TRANSITIONABLE_CHECKS,
	stack: TRANSITIONABLE_CHECKS,
	row: TRANSITIONABLE_CHECKS,
	scroll: TRANSITIONABLE_CHECKS,
	image: TRANSITIONABLE_CHECKS,
	pressable: TRANSITIONABLE_CHECKS,
	"text-input": TRANSITIONABLE_CHECKS,
	"text-area": TRANSITIONABLE_CHECKS,
};

/**
 * Maps a kind to the controller kind it accepts. Kinds absent from this table accept no controller.
 *
 * The type (`ScrollViewProps.controller`) already blocks this, but the type is not a boundary. An
 * element built by computation or a value passed through `as` bypasses it. Silently dropping the
 * controller would leave the creator no way to learn why it does nothing.
 */
export const CONTROL_KIND_FOR_HOST: Partial<
	Readonly<Record<RuntimeHostKind, RuntimeControlKind>>
> = Object.freeze({
	scroll: "scroll",
	"text-input": "text-entry",
	"text-area": "text-entry",
});

/** There is one prop name. The design does not allow several controllers to attach to one node. */
export const CONTROL_PROP_NAME = "controller";

export const controlIdOf = (value: HostValue): number | null =>
	typeof value === "object" &&
	value !== null &&
	!isArray(value) &&
	typeof (value as { $control?: unknown }).$control === "number"
		? ((value as { $control: number }).$control as number)
		: null;

/**
 * Maps an element's props to host values and handlers. `children` and `key` are never passed in.
 */
export function normalizeHostProps(
	props: Record<string, unknown>,
	kind: RuntimeHostKind,
): NormalizedHostProps {
	const values: Record<string, HostValue> = {};
	const handlers: Record<string, Handler> = {};
	const checks = VALUE_CHECKS[kind];
	for (const name of keysOf(props)) {
		if (name === "children") continue;
		const value = props[name];
		if (value === undefined) continue;
		if (typeof value === "function") {
			handlers[name] = value as Handler;
			continue;
		}
		if (isRuntimeControl(value)) {
			/**
			 * A controller reaching this point means the creator wrote it as a prop. Two questions remain:
			 * which prop name it sits under, and whether this primitive accepts that kind.
			 *
			 * Rejecting is correct for both. Dropping it silently leaves no place where the reason a command
			 * never goes out can be read.
			 */
			const ref = runtimeControlRef(value);
			const expected = CONTROL_KIND_FOR_HOST[kind];
			if (name !== CONTROL_PROP_NAME || ref === null || expected === undefined)
				throw new RuntimeError(
					RUNTIME_ERROR_CODE.hostControlWrongKind,
					`<${kind}> does not take a controller in the "${name}" prop.`,
				);
			if (ref.kind !== expected)
				throw new RuntimeError(
					RUNTIME_ERROR_CODE.hostControlWrongKind,
					`<${kind}> takes a ${expected} controller (a ${ref.kind} controller arrived).`,
				);
			values[name] = { $control: ref.id };
			continue;
		}
		if (name === CONTROL_PROP_NAME)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.hostControlWrongKind,
				`The "${CONTROL_PROP_NAME}" prop accepts only values made by a controller hook.`,
			);
		const normal = normalizeValue(name, value, 1, []);
		const check = checks === undefined ? undefined : checks[name];
		if (check !== undefined) {
			const why = check(normal);
			if (why !== null) throw invalid(name, why);
		}
		values[name] = normal;
	}
	return { values, handlers };
}

/** Whether two host values have the same shape. This compares serialized values, not identity. */
export function equalHostValue(left: HostValue, right: HostValue): boolean {
	if (Object.is(left, right)) return true;
	if (
		typeof left !== "object" ||
		typeof right !== "object" ||
		left === null ||
		right === null
	)
		return false;
	if (isArray(left) || isArray(right)) {
		if (!isArray(left) || !isArray(right) || left.length !== right.length)
			return false;
		for (let index = 0; index < left.length; index += 1)
			if (!equalHostValue(left[index] as HostValue, right[index] as HostValue))
				return false;
		return true;
	}
	const leftKeys = keysOf(left);
	const rightKeys = keysOf(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (!Object.hasOwn(right, key)) return false;
		if (!equalHostValue(left[key] as HostValue, right[key] as HostValue))
			return false;
	}
	return true;
}
