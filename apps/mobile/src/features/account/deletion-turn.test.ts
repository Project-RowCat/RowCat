import { describe, expect, it } from "vitest";
import type { AuthErrorLike } from "../../lib/auth-error.ts";
import {
	type AccountDeletionPhase,
	createAccountDeletionTurn,
	type DeletionTurnPorts,
} from "./deletion-turn.ts";

/**
 * Pins the irreversible boundary of the deletion turn by value. A slip here sends the delete
 * request twice, wipes local data for an unconfirmed deletion, or sends a second deletion for an
 * already-deleted account; none of those can be undone.
 */

interface Harness {
	turn: ReturnType<typeof createAccountDeletionTurn>;
	phases: AccountDeletionPhase[];
	deleteCalls: Array<string | undefined>;
	purgeCalls: string[];
}

function harness(options?: {
	deleteResult?: AuthErrorLike | null;
	deleteImpl?: () => Promise<AuthErrorLike | null>;
	purgeImpl?: () => Promise<void>;
}): Harness {
	const phases: AccountDeletionPhase[] = [];
	const deleteCalls: Array<string | undefined> = [];
	const purgeCalls: string[] = [];
	const ports: DeletionTurnPorts = {
		deleteAccount: (password) => {
			deleteCalls.push(password);
			return options?.deleteImpl
				? options.deleteImpl()
				: Promise.resolve(options?.deleteResult ?? null);
		},
		purge: (viewerId) => {
			purgeCalls.push(viewerId);
			return options?.purgeImpl ? options.purgeImpl() : Promise.resolve();
		},
		onPhase: (phase) => phases.push(phase),
	};
	return {
		turn: createAccountDeletionTurn(ports),
		phases,
		deleteCalls,
		purgeCalls,
	};
}

describe("lock", () => {
	it("a second confirmation in the same tick creates only one delete request", async () => {
		const h = harness();
		/** Does not wait for a render; both calls go out in the same tick (a fast double press). */
		const [first, second] = await Promise.all([
			h.turn.run({ viewerId: "alice", password: "pw" }),
			h.turn.run({ viewerId: "alice", password: "pw" }),
		]);
		expect(h.deleteCalls).toHaveLength(1);
		expect(h.purgeCalls).toHaveLength(1);
		const kinds = [first.kind, second.kind].sort();
		expect(kinds).toEqual(["deleted", "skipped"]);
	});

	it("doesn't send without knowing the viewer — it doesn't invent a name to delete", async () => {
		const h = harness();
		const result = await h.turn.run({ viewerId: null });
		expect(result).toEqual({ kind: "skipped", why: "no-viewer" });
		expect(h.deleteCalls).toHaveLength(0);
	});
});

describe("a deletion the server refused", () => {
	it("nothing is deleted and it returns to idle", async () => {
		const h = harness({
			deleteResult: { code: "INVALID_PASSWORD", status: 400 },
		});
		const result = await h.turn.run({ viewerId: "alice", password: "wrong" });
		expect(result.kind).toBe("refused");
		expect(h.purgeCalls).toHaveLength(0);
		expect(h.phases).toEqual(["deleting", "idle"]);
	});

	it("it can be retried after a refusal", async () => {
		let attempt = 0;
		const h = harness({
			deleteImpl: async () =>
				++attempt === 1 ? { code: "INVALID_PASSWORD", status: 400 } : null,
		});
		await h.turn.run({ viewerId: "alice", password: "wrong" });
		const second = await h.turn.run({ viewerId: "alice", password: "right" });
		expect(second.kind).toBe("deleted");
		expect(h.purgeCalls).toEqual(["alice"]);
	});

	/**
	 * A failure with no response (empty object) is not confirmation. The server may have deleted
	 * already, yet local data is still kept: treating an unconfirmed deletion as final would, when the
	 * server actually refused, leave a live account with this device's conversations and drafts gone.
	 */
	it("a send failure doesn't start local cleanup", async () => {
		const h = harness({ deleteResult: {} });
		const result = await h.turn.run({ viewerId: "alice" });
		expect(result).toEqual({ kind: "refused", failure: {} });
		expect(h.purgeCalls).toHaveLength(0);
		/** It does not claim deletion either, so it never enters the terminal phase. */
		expect(h.phases).toEqual(["deleting", "idle"]);
	});
});

describe("the irreversible line", () => {
	it("terminal as soon as the server succeeds, and a second delete request can't be expressed", async () => {
		const h = harness();
		const first = await h.turn.run({ viewerId: "alice" });
		expect(first).toEqual({ kind: "deleted", cleanup: "done" });
		expect(h.phases).toEqual(["deleting", "purging", "done"]);

		const again = await h.turn.run({ viewerId: "alice" });
		expect(again).toEqual({ kind: "skipped", why: "terminal" });
		expect(h.deleteCalls).toHaveLength(1);
	});

	it("a cleanup failure isn't a deletion failure — it ends as cleanup-failed", async () => {
		const h = harness({
			purgeImpl: () => Promise.reject(new Error("sqlite busy")),
		});
		const result = await h.turn.run({ viewerId: "alice" });
		expect(result).toEqual({ kind: "deleted", cleanup: "failed" });
		expect(h.phases).toEqual(["deleting", "purging", "cleanup-failed"]);
		/** No return to idle; there is no account to return to. */
		expect(h.phases).not.toContain("idle");
	});
});

describe("cleanup retry", () => {
	it("runs only with the member id held, without auth — it doesn't call the server deletion again", async () => {
		let purgeAttempt = 0;
		const h = harness({
			purgeImpl: () =>
				++purgeAttempt === 1
					? Promise.reject(new Error("busy"))
					: Promise.resolve(),
		});
		await h.turn.run({ viewerId: "alice" });
		const retry = await h.turn.retryCleanup();
		expect(retry).toEqual({ kind: "cleaned" });
		expect(h.purgeCalls).toEqual(["alice", "alice"]);
		expect(h.deleteCalls).toHaveLength(1);
		expect(h.phases.at(-1)).toBe("done");
	});

	it("nothing to retry before the terminal state", async () => {
		const h = harness();
		expect(await h.turn.retryCleanup()).toEqual({
			kind: "skipped",
			why: "no-target",
		});
	});
});
