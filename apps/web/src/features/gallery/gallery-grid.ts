/**
 * Column layout for the card grid. The placeholder and the real list must share this value, or the
 * layout jumps when data arrives; two hand-written copies would drift unnoticed.
 *
 * At the app width (max-w-6xl), 4 columns keep cards large enough to read cover and title. 4
 * columns start at xl, not lg, because of the fixed sidebar: at 1024px the canvas keeps 784px,
 * leaving 736px for the grid, where 4 columns would shrink cards to 170px. 3 columns gives 234px,
 * the same card width as the old 4 columns at lg without the sidebar. 4 columns return at 1280px
 * (236px cards in a 992px grid).
 *
 * The content width is fixed rather than collapsing the sidebar to an icon rail: the narrowing is
 * of usable content width, and responsive layout exists to react to exactly that.
 */
export const GALLERY_GRID_CLASS =
	"grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4";
