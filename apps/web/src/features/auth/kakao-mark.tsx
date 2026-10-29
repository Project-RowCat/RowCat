/**
 * Kakao brand mark.
 *
 * lucide has no brand icons, so the mark is kept here (same reason as `google-mark.tsx` and
 * `apple-mark.tsx`). A generic icon would leave the destination only in the label; the logo signals
 * that the button leaves the app for Kakao.
 *
 * Colour follows the Apple mark: `currentColor`, so the theme decides contrast. Google is the only
 * mark with literal brand colours, because there the colours are the identity.
 *
 * ## Not drawn as a yellow button, and that is an open decision
 *
 * Kakao's button guidelines call for a yellow background (#FEE500) with a black symbol. This screen
 * does not follow them because of the existing decision that the three sign-in buttons share one
 * rank (`auth-page.tsx`). Filling one button with colour would read as the recommended method,
 * while all three reach the same result.
 *
 * The two genuinely conflict and this is not a silent pick. Following the brand guideline changes
 * this screen's visual hierarchy, so it is a design decision that has to arrive together with that
 * decision. For now the cost is guideline compliance, and the gain is neutrality between methods.
 *
 * Carries no size. Button sizes an svg without a `size-` class to its own, so setting width or
 * height here would misalign buttons of different sizes.
 */
export function KakaoMark() {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 3C6.477 3 2 6.463 2 10.735c0 2.764 1.875 5.187 4.69 6.556-.155.53-.998 3.44-1.03 3.67 0 0-.02.17.09.235.11.065.24.014.24.014.31-.043 3.59-2.35 4.157-2.75.6.086 1.22.13 1.853.13 5.523 0 10-3.463 10-7.735S17.523 3 12 3z" />
		</svg>
	);
}
