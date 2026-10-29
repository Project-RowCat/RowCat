/**
 * The geometry of the runtime play canvas. The placeholder and the real screen read the same
 * values.
 * - Does not inherit the chat room's reading width (`CHAT_COLUMN`, 50rem). That width comes from
 *   prose typography (about 46 Korean characters per line). Creator canvases are not prose: they
 *   may be a narrow messenger, two split panes, or a phone shown beside a scene. The 60rem of the
 *   old play screen is kept, since six templates were verified at that width.
 * - Side padding matches chat's. The two screens sit on the same edges within the same shell, so
 *   they read as one product.
 * - The box border marks a boundary, not decoration. Inside is the creator's screen and outside
 *   is RowCat's. That boundary has to be visible so trusted lines and creator text never blend.
 */
export const RUNTIME_CANVAS_COLUMN =
	"mx-auto flex min-h-0 w-full max-w-[60rem] flex-1 flex-col px-5 pb-4 md:px-8";

export const RUNTIME_CANVAS_FRAME =
	"relative flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-background";
