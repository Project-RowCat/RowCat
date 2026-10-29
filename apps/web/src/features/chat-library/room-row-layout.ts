/**
 * Geometry of a conversation list row. The live list and the placeholder read the same constants.
 *
 * They live in their own module because the placeholder is the only body the server renders for
 * this route (`routes/(app)/chats/index.tsx`), so it is bundled for the server. The real list
 * screen is deliberately lazy-loaded out of that graph, so Dexie and room titles never reach the
 * server. If the placeholder imported constants from the screen file, that isolation would break.
 * Both read this value-only module instead.
 *
 * Two hand-written copies would drift. The mismatch would not be an error but a whole-screen
 * re-layout the moment the real values arrive, which is what happened when the four-card
 * placeholder turned into a row list.
 */

/**
 * The list surface.
 *
 * Rows are not boxed individually. Users scan the rows, and what makes them readable is one shared
 * divider rather than a border per row: titles and times stay on the same x-coordinate from row to
 * row, the convention the draft and published-work lists and the notification list already use.
 *
 * The list draws its own top and bottom rules because there is no column header. A header row over
 * a title and time column would become the first thing read on this screen, and the conversation
 * name must be read first.
 */
export const ROOM_LIST_CLASS = "divide-y border-y";

/**
 * The inside of one row: two stacked lines on narrow screens, two columns from `sm`.
 *
 * ```text
 * narrow screen          sm and up
 * Night Library   ⋯     Night Library            3 min ago   ⋯
 * 3 min ago
 * ```
 *
 * One markup tree serves every width. Separate trees per breakpoint would eventually drop a row's
 * `title` on one width only, and that difference would show up only there. Only the grid differs.
 *
 * The right padding is reserved for the management trigger below, so a long title never runs under
 * that button.
 *
 * The activity-time column has a fixed width on purpose. With `auto`, the boundary between a row
 * reading `just now` and one reading `3 days ago` would shift, and the eye would have to find that value again
 * on every row.
 */
export const ROOM_ROW_CLASS =
	"grid gap-y-0.5 py-3 pr-12 pl-3 sm:grid-cols-[minmax(0,1fr)_6rem] sm:items-baseline sm:gap-x-4 sm:gap-y-0 sm:py-2.5 sm:pr-11";

/**
 * The activity time.
 *
 * Quieter than the title. The eye should land on the conversation name first, and this value is
 * only needed when checking which conversation was touched most recently. It is right-aligned from
 * `sm` to pair with the fixed-width column above; left-aligned, the right edge would wobble with
 * the length of each value.
 */
export const ROOM_ROW_TIME_CLASS =
	"truncate text-xs text-muted-foreground sm:text-right";

/**
 * Position of the management trigger, floating **over the link**.
 *
 * It is absolutely positioned because two things must hold at once. The whole row is one link, so a
 * press anywhere goes to that conversation and the hover background covers the whole row. And the
 * button must be a **sibling** of the link, since a `<button>` inside an `<a>` is invalid markup
 * (`features/chat/room/row-markup.test.ts`). The sidebar row has the same shape for the same
 * reason.
 *
 * The placeholder reuses this value too. The button's dimensions belong to `RoomActionsMenu`, so
 * the placeholder is the only other place that has to match them.
 */
export const ROOM_ROW_MENU_CLASS = "absolute top-1/2 right-1 -translate-y-1/2";
