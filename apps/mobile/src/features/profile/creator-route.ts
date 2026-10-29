/**
 * The **address** of a creator profile — the only place in this app that knows its shape.
 *
 * Four callers use it (the byline on work detail, the byline on discover cards, the comment author,
 * and the profile screen itself passing a return path to login). If each concatenated a string, one
 * would eventually forget encoding, and that one place's symptom would appear only in accounts
 * whose member id contains special characters.
 *
 * ## The identity is the member id, not the nickname
 *
 * A display name is neither unique nor fixed, so it cannot be an address (see `PublicProfile.id`).
 * Renaming must not break links others have saved, and there is no way to decide which of two
 * people with the same name owns that address. So both functions here take **only the id**.
 *
 * ## Why navigation and the return path are split
 *
 * expo-router navigates by route pattern plus parameters (`CREATOR_ROUTE`), while the place login
 * returns to must be a **finished string** (its shape is what `safeMobileReturnPath` checks).
 * Folding the two into one function would make one side imitate the other's format, and on the day
 * they diverge, login would succeed but only the return destination would become the first screen.
 */

/** The route pattern used for navigation. It must be **the same string** as in `app/creators/[creatorId].tsx`. */
export const CREATOR_ROUTE = "/creators/[creatorId]" as const;

/**
 * This profile's in-app path — used as is for the place authentication returns to.
 *
 * Encoding is all of this function's remaining work. Member ids are currently hex without hyphens,
 * so encoding changes nothing. But relying on that means the day the id rule changes, the built
 * string becomes a **different path** — and the symptom is `safeMobileReturnPath` rejecting the
 * value, so that "after login you go to the first screen" (`discoverReturnPath` on the discover
 * screen does the same for the same reason).
 */
export const creatorProfilePath = (creatorId: string): string =>
	`/creators/${encodeURIComponent(creatorId)}`;
