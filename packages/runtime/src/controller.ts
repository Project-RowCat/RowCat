import {
	allocateRuntimeControl,
	type RuntimeControlRef,
	submitRuntimeCommand,
} from "./internal/control.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";
import { RUNTIME_CONTROL } from "./internal/symbols.ts";

/**
 * The public vocabulary of controllers. Authors hold only two kinds: a scroll controller and a
 * text-entry controller.
 *
 * - Neither is a DOM element, RN view, or native handle. There is no `current`, no reading of
 *   size, position, style, children or parent, and no way to name the integer inside. The listed
 *   methods are the whole capability.
 * - A controller binds to one live target. Binding the same controller to two nodes rejects that
 *   render (`runtime_host_control_already_bound`). 'Last rendered wins' would silently move the
 *   target when list order changes in an ordinary commit, with no error.
 * - A command sent to an unbound controller (node not yet drawn, or already gone) is dropped with
 *   a warning (`runtime_host_control_unbound`) and does not throw. That is a normal part of a
 *   lifetime: an input rendered conditionally is not bound while it is absent.
 * - `scrollToEnd()` takes effect after the preceding commit has reached the screen.
 */

/** Argument of `scrollTo()`. It is an object so later axes have a place to go. */
export interface RuntimeScrollTo {
	/**
	 * Distance from the start of the content, in the same unit as style lengths (CSS pixels on web,
	 * points on native). The axis is set by the ScrollView's `horizontal`: top-down for vertical,
	 * start edge for horizontal. Values beyond the content end are clamped by the platform, not by
	 * this package.
	 */
	offset: number;
}

/**
 * Controls one scroll view. It attaches only through `ScrollView`'s `controller` prop.
 *
 * No animation. Time and easing are not part of this runtime's vocabulary yet (there is no
 * Transition or delay). Opening an axis for smooth scrolling is not a decision of this slice: an
 * exact immediate API is preferred over one that moves differently on each platform.
 */
export interface RuntimeScrollController {
	scrollToStart(): void;
	/**
	 * Scroll to the end of the content. If the list has just grown, this is the end after the growth.
	 */
	scrollToEnd(): void;
	scrollTo(options: RuntimeScrollTo): void;
}

/**
 * Controls the focus of one text input. It attaches only to `TextInput` and `TextArea`.
 *
 * Selection, caret position, keyboard type and IME are not here. This surface answers only 'let me
 * write here' and 'stop'. Showing the keyboard is not promised: focus is moved by this package, but
 * whether the on-screen keyboard appears is the OS's policy, and promising otherwise would be a
 * promise that cannot be kept.
 */
export interface RuntimeTextEntryController {
	/** Gives focus here. Does nothing for an inactive input. */
	focus(): void;
	/** Removes focus. Does nothing if focus is already elsewhere. */
	blur(): void;
}

/**
 * Must be a finite number of 0 or more. The type cannot express this, so the call site checks it.
 */
function checkOffset(offset: unknown): number {
	if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.scrollInvalidOffset,
			"The offset in scrollTo({ offset }) must be a finite number of at least 0.",
		);
	return offset;
}

/**
 * Defines the symbol key as non-enumerable, so it does not leak through JSON.stringify or
 * spreading.
 */
function brand<T extends object>(target: T, ref: RuntimeControlRef): T {
	Object.defineProperty(target, RUNTIME_CONTROL, {
		value: ref,
		enumerable: false,
		writable: false,
		configurable: false,
	});
	return Object.freeze(target);
}

export function createScrollController(): RuntimeScrollController {
	const ref = allocateRuntimeControl("scroll");
	return brand(
		{
			scrollToStart(): void {
				submitRuntimeCommand(ref, {
					op: "scroll",
					control: ref.id,
					to: "start",
				});
			},
			scrollToEnd(): void {
				submitRuntimeCommand(ref, { op: "scroll", control: ref.id, to: "end" });
			},
			scrollTo(options: RuntimeScrollTo): void {
				const offset = checkOffset(
					options === null || options === undefined
						? undefined
						: options.offset,
				);
				submitRuntimeCommand(ref, {
					op: "scroll",
					control: ref.id,
					to: "offset",
					offset,
				});
			},
		},
		ref,
	);
}

export function createTextEntryController(): RuntimeTextEntryController {
	const ref = allocateRuntimeControl("text-entry");
	return brand(
		{
			focus(): void {
				submitRuntimeCommand(ref, { op: "focus", control: ref.id });
			},
			blur(): void {
				submitRuntimeCommand(ref, { op: "blur", control: ref.id });
			},
		},
		ref,
	);
}
