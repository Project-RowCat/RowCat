import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import { DEFAULT_MANAGED_MODEL } from "@rowcat/contracts/chat";
import type { GenerationTarget } from "./generation-preference.ts";
import {
	buildMemoryMaintenanceRequest,
	parseMaintenanceResult,
} from "./maintenance-prompt.ts";
import type { ChatMemory } from "./memory.ts";
import {
	type ChatMaintenancePlan,
	type MaintenanceMessage,
	planMemoryMaintenance,
	selectMaintenanceBatch,
} from "./memory-maintenance.ts";
import type { ChatSummary } from "./summary.ts";

/**
 * Lifecycle of automatic maintenance, and everything the apps need to know about it. It lives in
 * the pure package for the same reason as conversation.ts. There are two consumers (web and
 * mobile), and every mistake here is silent: a stretch processed twice, a result committed after an
 * account switch, or a failed call that advances the frontier so a stretch is never summarized.
 * Per-app copies would reproduce a bug on only one platform. Not here: React or hooks (wiring
 * belongs to each app); transport, provider, or SDK (the port's requestMaintenance is the boundary,
 * and if this file knew transport, BYO could not share the runner); storage (everything comes
 * through the port); screen copy (maintenance never reports failures).
 */

/**
 * Maps the turn's generation target to the target maintenance uses. Summaries never use the
 * roleplay model.
 * - Managed stays managed and BYO stays BYO. If a BYO user's summary passed through the RowCat
 *   server, that server would receive a conversation the user chose not to send there, and the
 *   billed party would change silently. The reverse cannot happen.
 * - The product picks the model. Managed always uses the product default, since a summary needs
 *   accuracy, not style. BYO uses the same model as the turn: which model is cheap on a given
 *   provider is not known here (catalogs change), and an invented model name would fail the
 *   request. No separate utility-model setting exists. Such a screen would ask users to trade
 *   summary quality against cost, but it would show neither how often summaries run nor what they
 *   cost.
 */
export function resolveUtilityTarget(
	target: GenerationTarget,
): GenerationTarget {
	if (target.provider === "rowcat")
		return { provider: "rowcat", model: DEFAULT_MANAGED_MODEL };
	return target;
}

export interface MemoryMaintenancePort {
	/** All live messages of this room in ascending order. Batch selection runs over this list. */
	loadMessages(): Promise<MaintenanceMessage[]>;
	loadSummary(): Promise<ChatSummary | null>;
	/**
	 * Live memories of this room. Duplicate suppression and operation validation read this snapshot.
	 */
	loadMemories(): Promise<ChatMemory[]>;
	/**
	 * Sends the request to the utility model and receives the full response body. Not streaming, on
	 * purpose. The response is never shown on screen; it is parsed once as JSON, and exposing deltas
	 * would make every caller build its own collector. Throws on failure. The runner catches it.
	 */
	requestMaintenance(
		request: ChatGenerationRequest,
		signal: AbortSignal,
	): Promise<string>;
	/**
	 * Commits the validated plan in one transaction: summary, frontier, and memory operations
	 * together. The optimistic-concurrency check (maintenanceStillApplies) must run inside that
	 * transaction. Checking outside and writing inside leaves a window, and history rewrites can enter
	 * it. If the condition no longer holds, nothing is written and the result is false.
	 */
	commit(plan: ChatMaintenancePlan): Promise<boolean>;
	/**
	 * Whether this maintenance is still inside its own conversation. Storage cannot answer this.
	 * Storage does not know whether the account changed, the scope closed, or the screen moved to
	 * another room. This is the same check as generation ownership (ownsSession), for the same reason.
	 * The cost of error is higher here: the result would store memories drawn from another account's
	 * data.
	 */
	isValid(): boolean;
}

/**
 * Why a maintenance run ended. Diagnostic only; never shown on screen. Maintenance is not something
 * the user started, so failures are not reported to them. The value exists for tests, which must be
 * able to confirm that a failure leaves the frontier where it was.
 */
export type MaintenanceOutcome =
	/** No stretch to process. This is normal and is where most turns end up. */
	| { status: "skipped"; reason: "not-due" | "invalid" }
	/** Blocked by the request, parsing, ownership, or commit. The frontier does not move. */
	| { status: "failed"; reason: "request" | "malformed" | "stale" }
	| { status: "applied"; plan: ChatMaintenancePlan };

export interface RunMemoryMaintenanceOptions {
	signal?: AbortSignal;
}

/**
 * Runs one maintenance pass. It never throws, and that is part of the contract. It is called after
 * the assistant response is stored. An exception escaping here would turn a completed turn into a
 * failure, showing the answer next to an error unrelated to the user's action. Order matters:
 * 1. Ownership check, before starting, so no paid call goes out for a conversation the user has
 *    left.
 * 2. Batch selection. If nothing is due, end silently.
 * 3. Snapshot read: summary and memories are read once and fixed.
 * 4. Utility call, the only network step.
 * 5. Parse and validate. If the shape is wrong, commit nothing.
 * 6. Ownership recheck. Step 4 may have taken seconds, during which the account may have
 *    changed.
 * 7. Commit. Storage checks the history again under optimistic concurrency. Steps 6 and 7 both
 *    exist because they answer different questions. Step 6 asks whether this conversation is still
 *    the user's (storage cannot know). Step 7 asks whether the history is unchanged (the app cannot
 *    check that atomically). Keeping only one silently opens the other path. Both steps check state
 *    rather than the abort signal, because a request whose body has arrived ignores the signal.
 */
export async function runMemoryMaintenance(
	port: MemoryMaintenancePort,
	options: RunMemoryMaintenanceOptions = {},
): Promise<MaintenanceOutcome> {
	try {
		if (!port.isValid()) return { status: "skipped", reason: "invalid" };

		const [messages, summary] = await Promise.all([
			port.loadMessages(),
			port.loadSummary(),
		]);

		const batch = selectMaintenanceBatch({
			messages,
			frontier: summary?.frontier ?? null,
		});
		if (!batch) return { status: "skipped", reason: "not-due" };

		const memories = await port.loadMemories();

		const request = buildMemoryMaintenanceRequest({
			batch: batch.messages,
			summary,
			memories,
		});

		let text: string;
		try {
			text = await port.requestMaintenance(
				request,
				options.signal ?? neverAborted(),
			);
		} catch {
			/**
			 * Network, provider, and balance failures all produce the same result: nothing changes. The
			 * reasons are not split because nothing displays them. The next maintenance point retries on its
			 * own, since the stretch is still unprocessed.
			 */
			return { status: "failed", reason: "request" };
		}

		const result = parseMaintenanceResult(text);
		if (!result) return { status: "failed", reason: "malformed" };

		const plan = planMemoryMaintenance({
			memories,
			summary,
			result,
			through: batch.through,
		});

		if (!port.isValid()) return { status: "failed", reason: "stale" };

		const applied = await port.commit(plan);
		return applied
			? { status: "applied", plan }
			: { status: "failed", reason: "stale" };
	} catch {
		/**
		 * Storage failure also stops here. If the commit throws, its transaction rolled back, so the
		 * frontier did not move and the summary and memories are unchanged. That is why this catch is
		 * safe.
		 */
		return { status: "failed", reason: "request" };
	}
}

/**
 * A real AbortController signal for calls that have none. It is created rather than faked, because
 * the port requires an AbortSignal.
 */
const neverAborted = (): AbortSignal => new AbortController().signal;

/**
 * At most one maintenance run per room at a time. Without this guard: Turn A ends, maintenance A
 * starts, and reads frontier M20. Turn B ends, maintenance B starts, and reads the same frontier
 * M20. Both summarize the same stretch and extract the same facts. The commit's optimistic
 * concurrency blocks the later one, but by then two paid calls have gone out. This gate prevents
 * that waste up front. Correctness still rests on the commit; this gate only saves cost. Each room
 * is independent. Other rooms run while one is busy, since two tabs on different conversations is
 * normal use and a global lock would make one lag for no reason. No coordination across devices.
 * Two devices may maintain the same room at once; the loser is blocked at commit and restarts later
 * from the updated frontier. A server-side lock would cross the product boundary, since the server
 * does not know the room exists.
 */
export class MemoryMaintenanceScheduler {
	private readonly inFlight = new Map<string, Promise<MaintenanceOutcome>>();

	/**
	 * Starts maintenance for this room. If one is already running, returns that same promise. Not
	 * queued, on purpose. Queued requests would keep the runner busy in fast conversations, and most
	 * would end at "no stretch to process" after a storage scan. A missed trigger is recreated by the
	 * next assistant response.
	 */
	run(
		roomId: string,
		start: () => Promise<MaintenanceOutcome>,
	): Promise<MaintenanceOutcome> {
		const running = this.inFlight.get(roomId);
		if (running) return running;

		const promise = start().finally(() => {
			/**
			 * Removes only the entry this call placed. If the next run has already taken the slot during
			 * cleanup, that entry must stay. Otherwise a third run would start alongside the second (same
			 * rule as releaseOwnSlot).
			 */
			if (this.inFlight.get(roomId) === promise) this.inFlight.delete(roomId);
		});
		this.inFlight.set(roomId, promise);
		return promise;
	}

	isRunning(roomId: string): boolean {
		return this.inFlight.has(roomId);
	}
}
