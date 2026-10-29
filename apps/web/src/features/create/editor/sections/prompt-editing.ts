import { translator } from "#/lib/i18n/current.ts";
/**
 * Geometry and copy for the prompt field, and the caret rule for moving between inline and
 * fullscreen editing.
 *
 * The values live outside the component because the cap is a decision, not an arbitrary number. The
 * field once had `rows={20}` and no vertical cap (`field-sizing-content`), so a long prompt grew to
 * many times the document height. Returning to the title that was just edited meant scrolling
 * thousands of pixels, and the publish section was pushed far below.
 *
 * The fix is not to split the screen. Splitting the field would revert the save model to v1
 * (`AUTHORING_SCHEMA_VERSION` in `@rowcat/authoring`). Collapsing sections or adding jump buttons
 * would add a control on top of the symptom and leave the cause in place. Growing to a cap and then
 * scrolling inside the box keeps the problem from arising.
 */

/**
 * Minimum height, expressed as `rows` rather than `min-h-*`. With `field-sizing: content`, `rows`
 * is the floor when content is short, so the number scales with line height, font size, and device
 * scaling. In pixels, people who enlarged their text would get fewer rows than twelve.
 *
 * Lowered from 20 to 12. Before the cap existed, the number meant 'generously large from the
 * start'. Now the range between minimum and cap is the growing zone. If the minimum sat at the cap,
 * that zone would vanish, and short prompts would grow only an empty box.
 */
export const PROMPT_FIELD_ROWS = 12;

/**
 * Vertical cap for auto-growth, proportional to the viewport.
 * - Default `50dvh`: narrow screens and laptops. One field never takes more than half the screen.
 * - From `lg` up, `60dvh`: wider layouts usually have more height, so the field gets more room.
 *
 * `dvh`, not `vh`, is the most important character in this string. The app runs with
 * `interactive-widget=resizes-content` (`routes/__root.tsx`), so on mobile the soft keyboard
 * shrinks the layout viewport itself. `vh` ignores that, and a cap measured to the area under the
 * keyboard leaves the caret below it.
 *
 * `overflow-y-auto` is its pair. A cap without scrolling clips overflow with no way to reach it.
 * Scrolling without a cap never needs to scroll, since the box keeps growing. The two classes share
 * one constant with the dialog's vertical bounds (`lib/dialog-geometry.ts`).
 */
export const PROMPT_FIELD_GROWTH =
	"max-h-[50dvh] overflow-y-auto lg:max-h-[60dvh]";

/**
 * Field inside the dialog: it fills the space it is given instead of growing. `field-sizing-fixed`
 * reverts the inline field's `field-sizing-content`. Without it, this field would also grow with
 * its content, and the same problem would recur inside the window, which would then overflow and
 * scroll. `min-h-0` is its pair: a flex child's default minimum height is its content, so `flex-1`
 * cannot shrink until that is released.
 */
export const PROMPT_DIALOG_FIELD =
	"min-h-0 flex-1 resize-none field-sizing-fixed overflow-y-auto";

/**
 * Why the fullscreen labels are neither `Enlarge` nor `Focus mode`: each promises
 * something this does not do. The first implies text gets bigger, which it does not. The second
 * implies distractions are turned off, but autosave and the save indicator keep running. What
 * actually differs is one placement.
 *
 * The label is `Done`, not `Save`. This window has no save action, and closing confirms
 * nothing. `Save` would imply unsaved work is lost unless closed, a promise this editor never made.
 */
export const promptExpand = () => {
	const t = translator("create");
	return {
		open: t("promptExpand.open"),
		title: t("promptExpand.title"),
		description: t("promptExpand.description"),
		close: t("promptExpand.close"),
	} as const;
};

/**
 * The caret position must be passed between the two fields, because the inline and window fields
 * are different DOM nodes. Without that, each open and close would reset the caret to the start or
 * end, and someone editing the middle of a long manuscript would have to find their place again.
 */
export interface TextSelection {
	start: number;
	end: number;
}

/**
 * Clamps a caret position to this value. Returns `null` if there is no position to pass. Clamping
 * is needed because the value can change while off-screen (edits in another tab, sync;
 * `edited-value.ts`). If the text became shorter in between, the saved position points past the
 * end. `setSelectionRange` folds that to the end rather than erroring, but that end is not where
 * the user was.
 *
 * A reversed range is left as is. In a selection dragged backward, its direction is the user's
 * anchor. Normalizing would move the anchor of someone still extending it. The DOM tracks that
 * direction separately as `selectionDirection`.
 */
export function clampTextSelection(
	selection: TextSelection | null | undefined,
	length: number,
): TextSelection | null {
	if (!selection) return null;
	const within = (at: number): number =>
		Math.min(Math.max(Math.round(Number.isFinite(at) ? at : 0), 0), length);
	return { start: within(selection.start), end: within(selection.end) };
}

/**
 * End of text. Used as the default when no position was passed, such as on the window's first open.
 */
export function caretAtEnd(text: string): TextSelection {
	return { start: text.length, end: text.length };
}

/**
 * Lock copy for the prompt field in a runtime-enabled draft: a notice in place of editing. Its
 * three sentences carry three different facts. First, this work's execution model is code, not a
 * prompt. Second, AI requests are built inside runtime code. Third, the value is not gone and
 * returns when runtime is turned off. Without the last sentence, creators would read their text as
 * erased, and only turning runtime off clears that belief.
 *
 * The API name `useGeneration()` is not written here. The screen only needs to say the request is
 * built in code. The name belongs to the studio and the docs.
 */
export const promptRuntimeLock = () => {
	const t = translator("create");
	return {
		title: t("promptRuntimeLock.title"),
		body: t("promptRuntimeLock.body"),
	} as const;
};

/**
 * Shown while the runtime project is still loading. The field stays closed meanwhile
 * (`resolveConversationAuthoringMode`). The name omits `PROMPT` on purpose. Two sections pass the
 * same decision (prompt and starting scene) and wait for the same fact. Per-section copy would show
 * two different placeholder messages in the same frame.
 */
export const runtimePendingLabel = (): string =>
	translator("create")("runtimePending");
