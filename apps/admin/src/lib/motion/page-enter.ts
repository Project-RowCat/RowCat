/**
 * Page-entry policy as plain values, separate from `page-transition.tsx` so it knows neither Motion
 * nor React and can be checked without rendering.
 *
 * Shorter than the `apps/web` counterpart: that one has `pageEnterInitialFor(hydrating)` because
 * server HTML is already final. This app has no SSR (`vite.config.ts` header), so keeping that
 * branch would be dead code.
 */

/**
 * 4px. The page is the largest surface, so visible travel turns the transition into a show that
 * gets in the way — especially in a console operators flip through during incidents.
 */
export const PAGE_ENTER_Y = 4;

export const pageEnterInitial = { opacity: 0, y: PAGE_ENTER_Y } as const;

export const pageEnterAnimate = { opacity: 1, y: 0 } as const;
