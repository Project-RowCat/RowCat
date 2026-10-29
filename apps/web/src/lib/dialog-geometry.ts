/**
 * Vertical bound for centered dialogs.
 *
 * `DialogContent` is `position: fixed`, so page scroll does not reach its overflow. If the content
 * is taller than the screen, the overflow is unreachable: it stays cut off at top and bottom, and
 * what gets cut is usually the confirm button.
 *
 * Measured in the browser:
 * - Account deletion, 320x568: box 591px, top -11, bottom 579. Title and cancel both cut off.
 * - Change email address, 390x380 (keyboard up): box 395px. Submit button off screen.
 * - Change password, 390x380 (keyboard up): box 397px. Same as above.
 * - Report a work, 320x300 (height reached after tapping the description field): box 397px.
 *
 * The 380px height is not made up. The app opens with `interactive-widget=resizes-content`
 * (routes/__root.tsx), so when the soft keyboard appears the layout viewport itself shrinks. A
 * dialog with an input field meets that height every time the user types.
 *
 * Do not add a box that sets only a horizontal bound and leaves the vertical one empty. This string
 * does two things: it keeps the box inside the screen (`max-h`), and it scrolls by itself when
 * content overflows (`overflow-y-auto`).
 *
 * Do not use it on bottom-anchored sheets. Those bound their own height (`max-h-[85dvh]`) and carry
 * their own scroll region; an outer layer would make two scroll containers.
 * `dialog-geometry.test.ts` enforces this exception list against the value.
 *
 * `2rem` equals the horizontal margin of `DialogContent` (`max-w-[calc(100%-2rem)]`). A box that
 * never touches the screen edge should look the same on both axes.
 */
export const DIALOG_VIEWPORT_BOUND =
	"max-h-[calc(100dvh-2rem)] overflow-y-auto";
