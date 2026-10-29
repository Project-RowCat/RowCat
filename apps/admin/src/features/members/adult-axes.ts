/**
 * The draft of the two adult axes narrows the combinations the screen can build.
 *
 * The server and contract already reject adult without verification; the screen prevents it too so
 * an operator never gets a 400 that does not say what they did wrong. This is not enforcement (the
 * server decides on the locked row, including the child refusal) — it lives in pure functions so it
 * can be checked by value without rendering.
 */

export interface AdultAxes {
	verified: boolean;
	/** Whether the person is 19 or older — a judgment attached to that verification. */
	adult: boolean;
}

/**
 * Turning `verified` off also turns `adult` off, and turning `adult` on also turns `verified` on.
 * The other two directions leave the other axis alone: a verified account under 19 is a normal
 * state, and revoking only adult entitlement is a real operator action.
 */
export function applyAdultAxis(
	draft: AdultAxes,
	axis: keyof AdultAxes,
	next: boolean,
): AdultAxes {
	if (axis === "verified")
		return { verified: next, adult: next ? draft.adult : false };
	return { verified: next ? true : draft.verified, adult: next };
}

export function adultAxesDirty(current: AdultAxes, draft: AdultAxes): boolean {
	return current.verified !== draft.verified || current.adult !== draft.adult;
}

/**
 * Whether the draft grants entitlement to a child account. The server re-decides on the locked row
 * and is the authority; the screen only avoids starting an operation that will be refused. Turning
 * axes off stays open — there is no reason to block reducing entitlement.
 */
export function adultGrantBlockedForChild(
	ageStatus: string,
	draft: AdultAxes,
): boolean {
	return ageStatus === "child" && (draft.verified || draft.adult);
}
