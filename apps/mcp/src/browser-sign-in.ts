import { formatDeviceUserCode } from "@rowcat/contracts";
import { pollDeviceSession, requestDeviceCode } from "./auth.ts";

/**
 * Sign-in by approval: this process asks the server for a sign-in request, a person approves it in a
 * browser where they are already signed in, and the session arrives at the next poll.
 *
 * ```text
 * this process                                   a browser (this computer, a phone, the laptop next to the SSH session)
 * prints the address and the code
 * opens a browser if this computer has one ────► the approval page — signed in already, or signs in first
 *                                                compares the code, presses Approve
 * the next poll answers with the session   ◄──── (the server mints it for the approving account)
 * ```
 *
 * - **No password passes through this process**, so every way an account signs in works here —
 *   email, Google, Apple, Kakao, passkeys, two-factor — and so does an account with no password at
 *   all (the one-computer installer's local owner). The email and password prompt this replaced
 *   reached only accounts with a password and no second factor.
 * - **The address is always printed**, even when a browser is opened: the browser that opens is this
 *   computer's, and over SSH or in a container the person's browser is somewhere else.
 * - **Ctrl+C is not intercepted.** Unlike pairing (`pairing.ts`), nothing on the server needs
 *   closing: the request expires on its own, and the code the server would answer to dies with this
 *   process, so an approval that arrives later signs nobody in.
 *
 * Everything (clock, sleep, network, the opener) is an argument for the reason `pairing.ts` gives:
 * most endings need a person to wait minutes, and this way each is checked by value.
 */

export interface BrowserSignInOptions {
	readonly baseUrl: string;
	/** Lines left for the human. */
	readonly out: (line: string) => void;
	/** A line that gets erased, for the remaining time. */
	readonly status?: (line: string) => void;
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	/**
	 * Opens the address for the person at this computer; `false` when this computer has no browser for
	 * them (`open-browser.ts` decides).
	 */
	readonly openBrowser: (address: string) => boolean;
	readonly fetch?: typeof fetch;
}

export type BrowserSignInOutcome =
	| { readonly status: "signed_in"; readonly cookie: string }
	| { readonly status: "expired" }
	| { readonly status: "denied" }
	/** Carries the next step as a sentence; no raw status or exception text lands here. */
	| { readonly status: "failed"; readonly message: string };

/** RFC 8628 §3.5: each `slow_down` adds five seconds to the interval, for the rest of the attempt. */
const SLOW_DOWN_STEP_MS = 5_000;

/**
 * Consecutive unanswered or unreadable polls before giving up. The address answered a moment ago
 * (the request was issued), so a few misses are a blip; ten minutes of them is not.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

const REMAINING = (ms: number): string => {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Issuance failure to next step. Neither raw text nor status codes reach the screen. */
function startFailureMessage(status: number | null): string {
	if (status === 429)
		return "Too many sign-in requests from this address. Wait a minute, then try again.";
	if (status === 404)
		return "This RowCat API doesn't offer browser sign-in. Check the API address (through …/v2), or update the server.";
	return "Couldn't start the sign-in. Check the API address and the connection.";
}

/**
 * One sign-in attempt. Returns one of its endings and never throws, for the reason `pairDevice` gives:
 * every failure is a "do this next" sentence, and a rethrow would make the caller rebuild it from raw
 * text.
 */
export async function signInWithBrowser(
	options: BrowserSignInOptions,
): Promise<BrowserSignInOutcome> {
	const { baseUrl, out, status, now, sleep, openBrowser } = options;
	const issued = await requestDeviceCode(baseUrl, options.fetch);
	if (!issued.ok)
		return { status: "failed", message: startFailureMessage(issued.status) };
	const { request } = issued;
	const deadline = now() + request.expires_in * 1000;
	let interval = request.interval * 1000;

	out("Approve this sign-in in a browser where you're signed in to RowCat:");
	out(`  ${request.verification_uri_complete}`);
	out("");
	out(`Code: ${formatDeviceUserCode(request.user_code)}`);
	out("  Approve only if the page shows this same code.");
	out("");
	out(
		openBrowser(request.verification_uri_complete)
			? "Opening your browser… If it didn't open, open the address above yourself."
			: "Open the address above in a browser — on this computer or another device.",
	);
	out("");
	out("Waiting for approval…");

	let failures = 0;
	for (;;) {
		const remaining = deadline - now();
		if (remaining <= 0) return { status: "expired" };
		status?.(`Waiting for approval… (${REMAINING(remaining)} left)`);

		await sleep(interval);
		/**
		 * Judge expiry again after waiting: the server would answer an expired request too, but stopping
		 * here keeps the ending from depending on whether that last poll got through.
		 */
		if (deadline - now() <= 0) return { status: "expired" };

		const poll = await pollDeviceSession(
			baseUrl,
			request.device_code,
			options.fetch,
		);
		switch (poll.kind) {
			case "session":
				return { status: "signed_in", cookie: poll.cookie };
			case "pending":
				failures = 0;
				continue;
			case "slow_down":
				failures = 0;
				interval += SLOW_DOWN_STEP_MS;
				continue;
			case "denied":
				return { status: "denied" };
			case "expired":
				return { status: "expired" };
			case "no_session":
				return {
					status: "failed",
					message:
						"The sign-in was approved, but no session came back. If a proxy stands in front of the API, check that it passes Set-Cookie through.",
				};
			case "unknown":
				failures += 1;
				if (failures >= MAX_CONSECUTIVE_FAILURES)
					return {
						status: "failed",
						message:
							"Couldn't confirm the sign-in. Please check the network and try again.",
					};
				continue;
		}
	}
}
