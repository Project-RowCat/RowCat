import type { AdultVerificationStartDto } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { AdultVerificationPhase } from "./adult-verification-state.ts";
import {
	type AdultVerificationPorts,
	createAdultVerificationTurn,
} from "./adult-verification-turn.ts";

/**
 * Ordering and locking of the procedure, checked without rendering a screen.
 *
 * The four mistakes caught here are all silent: pressing twice creates two attempts, folding cancel
 * into completion sends a paid call, a callback after an account switch confirms someone else's
 * verification, and reopening the authority after a reflect failure makes the user verify twice.
 */

const START: AdultVerificationStartDto = {
	handoff: {
		kind: "portone-v2",
		storeId: "store-a",
		channelKey: "channel-a",
		identityVerificationId: "server-attempt-123",
		redirectUrl: "https://web.example/account",
	},
	expiresAt: "2026-08-29T10:00:00.000Z",
};

/** The server-settled viewer; the point is who made it, not its shape. */
const VERIFIED_VIEWER = {
	id: "alice",
	verified: true,
	adult: true,
	showAdult: false,
} as unknown as Viewer;

interface Harness {
	ports: AdultVerificationPorts;
	phases: AdultVerificationPhase[];
	calls: { begin: number; complete: number; browser: string[] };
	completeArgs: unknown[][];
	setViewer: (id: string | null) => void;
	failBegin: (error: unknown) => void;
	failComplete: (error: unknown) => void;
	nextStart: (start: AdultVerificationStartDto) => void;
}

function harness(viewerId: string | null = "alice"): Harness {
	let currentViewer = viewerId;
	let beginError: unknown = null;
	let completeError: unknown = null;
	let start = START;
	const phases: AdultVerificationPhase[] = [];
	const calls = { begin: 0, complete: 0, browser: [] as string[] };
	const completeArgs: unknown[][] = [];

	return {
		phases,
		calls,
		completeArgs,
		setViewer: (id) => {
			currentViewer = id;
		},
		failBegin: (error) => {
			beginError = error;
		},
		failComplete: (error) => {
			completeError = error;
		},
		nextStart: (next) => {
			start = next;
		},
		ports: {
			begin: async () => {
				calls.begin += 1;
				if (beginError) throw beginError;
				return start;
			},
			complete: async (...args: unknown[]) => {
				calls.complete += 1;
				completeArgs.push(args);
				if (completeError) throw completeError;
				return VERIFIED_VIEWER;
			},
			openBrowser: async (url) => {
				calls.browser.push(url);
			},
			viewerId: () => currentViewer,
			emit: (phase) => {
				phases.push(phase);
			},
		},
	};
}

const apiError = (code: string) =>
	new RowCatApiError({ status: 409, code, message: "nope" });

describe("start", () => {
	it("when the server creates an attempt, it goes to the authority surface", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		expect(await turn.start()).toBe("started");
		expect(h.calls.begin).toBe(1);
		/** Starting alone sends no server confirmation. */
		expect(h.calls.complete).toBe(0);
		expect(h.phases.at(-1)).toEqual({
			kind: "provider",
			plan: {
				kind: "portone",
				request: {
					storeId: "store-a",
					channelKey: "channel-a",
					identityVerificationId: "server-attempt-123",
				},
			},
		});
	});

	/**
	 * A same-tick second press folds away. React's `isPending` is true only after a render, so two
	 * fingers in one frame see false twice; the second run would create another attempt and the server
	 * replaces the first, killing the window already open.
	 */
	it("a second start in the same tick folds", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		const [first, second] = await Promise.all([turn.start(), turn.start()]);
		expect([first, second].sort()).toEqual(["skipped", "started"]);
		expect(h.calls.begin).toBe(1);
	});

	it("a failed start ends at that stage", async () => {
		const h = harness();
		h.failBegin(apiError("identity_verification_unavailable"));
		const turn = createAdultVerificationTurn(h.ports);
		expect(await turn.start()).toBe("failed");
		expect(h.calls.complete).toBe(0);
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("begin_failed");
		expect(last.failure?.message).toBeTruthy();
	});

	/** The client is fail-closed too: no window opens for an unknown method. */
	it("doesn't proceed with an unknown handoff mode", async () => {
		const h = harness();
		h.nextStart({
			...START,
			handoff: {
				kind: "future",
			} as unknown as AdultVerificationStartDto["handoff"],
		});
		const turn = createAdultVerificationTurn(h.ports);
		expect(await turn.start()).toBe("failed");
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("unsupported_handoff");
		expect(h.calls.complete).toBe(0);
	});
});

describe("the authority's success isn't eligibility", () => {
	/**
	 * The authority's "success" is a value inside that webview. Viewer must not change at this step;
	 * what follows must be one request that re-asks the server.
	 */
	it("the success callback leads to the server confirmation", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		expect(await turn.providerCompleted()).toBe("verified");
		expect(h.calls.complete).toBe(1);
		/**
		 * Nothing rides on the completion request: passing a verification identifier would make the
		 * server look at the attempt the client pointed at, and anyone can create such a verification.
		 */
		expect(h.completeArgs).toEqual([[]]);
		const kinds = h.phases.map((phase) => phase.kind);
		expect(kinds).toEqual(["beginning", "provider", "completing", "idle"]);
		expect(h.phases.at(-1)).toEqual({
			kind: "idle",
			failure: null,
			settled: true,
		});
	});

	/**
	 * The webview may call both `onComplete` and `onError`, and the user may close the window in
	 * between; one verification must not become two server confirmations.
	 */
	it("two callbacks still make one server confirmation", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		const [a, b] = await Promise.all([
			turn.providerCompleted(),
			turn.providerCompleted(),
		]);
		expect([a, b].sort()).toEqual(["skipped", "verified"]);
		expect(h.calls.complete).toBe(1);
	});

	it("an error callback arriving after success does nothing", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		await turn.providerCompleted();
		const settled = h.phases.length;
		turn.providerRejected();
		turn.providerDismissed();
		turn.providerCrashed();
		expect(h.phases.length).toBe(settled);
		expect(h.calls.complete).toBe(1);
	});
});

describe("the authority can't claim eligibility", () => {
	/**
	 * The authority's response does not enter this module. The caller judges success with
	 * `providerReportedSuccess`, so what reaches the procedure is only which method to call, and an
	 * `adult: true` in the response has nowhere to be read.
	 *
	 * Checked by value, not type: there is no argument to pass a fabricated response, and eligibility
	 * comes only from the viewer the server answered with.
	 */
	it("the success callback has no slot for a result", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		/** The signature takes no argument, so a malicious response cannot be passed at all. */
		expect(turn.providerCompleted.length).toBe(0);
		await turn.providerCompleted();
		/** A claim of changed eligibility comes from the server response alone. */
		expect(h.calls.complete).toBe(1);
	});

	/** No step in this folder produces `verified`, `adult` or `showAdult`. */
	it("no stage carries an eligibility axis", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		await turn.providerCompleted();
		const serialized = JSON.stringify(h.phases);
		expect(serialized).not.toMatch(/"adult"|"showAdult"/);
	});
});

describe("cancellation isn't failure", () => {
	/** Nothing goes to the server and no error sentence is drawn. */
	it("closing the window sends no server confirmation", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		turn.providerDismissed();
		expect(h.calls.complete).toBe(0);
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("provider_cancelled");
		expect(last.failure?.message).toBeNull();
	});

	it("when the authority refuses, no server confirmation goes out", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		turn.providerRejected();
		expect(h.calls.complete).toBe(0);
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("provider_failed");
	});

	/** After cancel the user can start over; the lock must not linger. */
	it("it can start again after cancelling", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		turn.providerDismissed();
		expect(await turn.start()).toBe("started");
		expect(h.calls.begin).toBe(2);
	});
});

describe("a failure to apply the result doesn't make you verify again", () => {
	/**
	 * The costliest distinction in this slice: if the line drops right after verification, only the
	 * server confirmation fails, and reopening the authority makes the user verify again.
	 */
	it("only the server confirmation runs again", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		h.failComplete(new Error("network"));
		expect(await turn.providerCompleted()).toBe("failed");
		const failed = h.phases.at(-1);
		expect(failed?.kind).toBe("completion_failed");

		h.failComplete(null);
		expect(await turn.retryCompletion()).toBe("verified");

		expect(h.calls.begin).toBe(1);
		expect(h.calls.complete).toBe(2);
	});

	/**
	 * If the server says the attempt is missing, expired or replaced, asking again gets the same
	 * answer; start over instead, since a re-check button would give the same failure forever.
	 */
	it("once the attempt has ended it starts over rather than rechecking", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		h.failComplete(apiError("identity_verification_expired"));
		expect(await turn.providerCompleted()).toBe("failed");
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("attempt_expired");
		/** Not in that phase, so re-check does nothing. */
		expect(await turn.retryCompletion()).toBe("skipped");
		expect(h.calls.complete).toBe(1);
	});
});

describe("switching accounts doesn't make it someone else's verification", () => {
	/** The account changed while the attempt was created; that window is not shown to the current one. */
	it("switching during start doesn't go to the authority surface", async () => {
		const h = harness("alice");
		const turn = createAdultVerificationTurn(h.ports);
		const pending = turn.start();
		h.setViewer("bob");
		expect(await pending).toBe("skipped");
		expect(h.phases.some((phase) => phase.kind === "provider")).toBe(false);
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("stale_account");
	});

	/**
	 * Alice's callback must not confirm Bob's account. The server re-decides by session, but without
	 * this guard the request still goes out and the screen draws someone else's procedure.
	 */
	it("a callback arriving after a switch doesn't go to the server", async () => {
		const h = harness("alice");
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		h.setViewer("bob");
		expect(await turn.providerCompleted()).toBe("skipped");
		expect(h.calls.complete).toBe(0);
		const last = h.phases.at(-1);
		if (last?.kind !== "idle") throw new Error("must be idle");
		expect(last.failure?.kind).toBe("stale_account");
		expect(last.failure?.message).toBeNull();
	});

	it("doesn't draw success when it changes while the response is in flight", async () => {
		const h = harness("alice");
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		const pending = turn.providerCompleted();
		h.setViewer("bob");
		expect(await pending).toBe("skipped");
		expect(
			h.phases.some((phase) => phase.kind === "idle" && phase.settled),
		).toBe(false);
	});

	/** Signed out: no procedure to start, nothing goes to the server. */
	it("doesn't start without a viewer", async () => {
		const h = harness(null);
		const turn = createAdultVerificationTurn(h.ports);
		expect(await turn.start()).toBe("skipped");
		expect(h.calls.begin).toBe(0);
		expect(h.phases).toEqual([]);
	});
});

describe("after the screen is gone", () => {
	/** A late callback touches neither state nor server. */
	it("a callback after unmount does nothing", async () => {
		const h = harness();
		const turn = createAdultVerificationTurn(h.ports);
		await turn.start();
		const settled = h.phases.length;
		turn.dispose();
		expect(await turn.providerCompleted()).toBe("skipped");
		expect(h.calls.complete).toBe(0);
		expect(h.phases.length).toBe(settled);
	});
});

describe("the redirect-mode round trip", () => {
	/**
	 * The browser closing does not claim success; what follows is always the server re-asking.
	 */
	it("opens the browser, then asks the server", async () => {
		const h = harness();
		h.nextStart({
			...START,
			handoff: {
				kind: "redirect",
				redirectUrl: "https://web.example/account?verification=done",
			},
		});
		const turn = createAdultVerificationTurn(h.ports);
		expect(await turn.start()).toBe("verified");
		expect(h.calls.browser).toEqual([
			"https://web.example/account?verification=done",
		]);
		expect(h.calls.complete).toBe(1);
	});
});
