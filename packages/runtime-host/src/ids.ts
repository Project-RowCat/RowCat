/**
 * Identity of a host call: an integer that increases monotonically within a session.
 *
 * No random values. The only property needed is non-collision, and counting provides that within
 * one session. Randomness would hide how many calls were made. The value never leaves the session,
 * so guessability does not matter. A call's authorization is decided by the session, not by its id.
 */
export interface CallIdAllocator {
	next(): number;
	/** Number issued so far. The limit check and diagnostics read this. */
	issued(): number;
}

export function createCallIdAllocator(): CallIdAllocator {
	let last = 0;
	return {
		next: () => {
			last += 1;
			return last;
		},
		issued: () => last,
	};
}
