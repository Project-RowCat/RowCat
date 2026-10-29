import { useFonts } from "expo-font";

/**
 * Loads the product fonts. The names belong to `@rowcat/design`; the files live here.
 *
 * The web fetches one variable font from a CDN through `@import` (`ui-web/src/styles/globals.css`).
 * Here each weight is bundled as a separate file and registered under its name. React Native has no
 * variable axes, so choosing a weight is in effect choosing a **family**.
 *
 * ## Loading is not awaited
 *
 * `loaded` is not read to block the screen. Blocking would leave a blank screen on the launch path
 * for as long as the font files take to load, which is longer on devices with large font files. The
 * web makes the same choice with `font-display: swap` (text shows first, the font swaps in later).
 * The hook re-renders when loading completes, so the swap happens automatically.
 *
 * ## A failure does not stop the app
 *
 * An unregistered `fontFamily` is not an error but a **fallback**: it draws with the system font.
 * So a failure in this hook does not break the screen. The reason `typeface()` also passes
 * `fontWeight` applies to that window: the hierarchy between titles and body text survives in the
 * fallback.
 *
 * ## License
 *
 * Pretendard is under the SIL Open Font License 1.1. A copy is included at `assets/fonts/OFL.txt`.
 */
export const PRODUCT_FONTS = {
	"Pretendard-Regular": require("../../assets/fonts/Pretendard-Regular.otf"),
	"Pretendard-Medium": require("../../assets/fonts/Pretendard-Medium.otf"),
	"Pretendard-SemiBold": require("../../assets/fonts/Pretendard-SemiBold.otf"),
	"Pretendard-Bold": require("../../assets/fonts/Pretendard-Bold.otf"),
	"Pretendard-Black": require("../../assets/fonts/Pretendard-Black.otf"),
} as const;

export function useProductFonts(): boolean {
	const [loaded] = useFonts(PRODUCT_FONTS);
	return loaded;
}
