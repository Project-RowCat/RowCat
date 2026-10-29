import type { SecureKeyStorage } from "../local-sync/device-key.ts";
import { openMobileDatabase, viewerDatabaseName } from "./database.ts";
import type { DraftCoverFiles } from "./draft-cover-store.ts";
import type { MobileDatabase, SqliteDriver } from "./sqlite.ts";
import {
	createMobileLocalDataStores,
	type MobileLocalStores,
} from "./stores.ts";

/**
 * The lifetime of a local scope: one member owns one connection and one set of stores.
 *
 * This file does not know React on purpose. Activation and release rules live here, so they are
 * verified without a simulator (`activation.test.ts`). The React wiring only wraps this controller
 * (`scope.tsx`).
 *
 * No connection or member is kept at module scope. A `let db` / `let currentViewer` layout would
 * keep a signed-out member's connection alive for the life of the process, and no one could tell
 * which file a late write during an account switch would reach. The controller instance owns the
 * scope, and the app root owns that instance's lifetime.
 */
export interface MobileLocalScope {
	readonly viewerId: string;
	readonly db: MobileDatabase;
	readonly stores: MobileLocalStores;
	close(): Promise<void>;
}

export type ScopeOpener = (viewerId: string) => Promise<MobileLocalScope>;

/**
 * Builds the function that opens a scope from a driver and secure storage.
 *
 * The device passes expo-sqlite + Keychain; tests pass node:sqlite + an in-memory implementation.
 * Between them, **the file naming rule and store assembly are one thing** — two copies would let
 * the isolation tests verify something different from what the device actually gets.
 */
export const openScopeWith =
	(
		openDriver: (name: string) => Promise<SqliteDriver>,
		secureStorage: SecureKeyStorage,
		draftCoverFiles: DraftCoverFiles,
	): ScopeOpener =>
	async (viewerId: string): Promise<MobileLocalScope> => {
		const driver = await openDriver(viewerDatabaseName(viewerId));
		const db = await openMobileDatabase(driver);
		return {
			viewerId,
			db,
			stores: createMobileLocalDataStores(
				db,
				viewerId,
				secureStorage,
				draftCoverFiles,
			),
			close: () => db.close(),
		};
	};

/**
 * The current state of a scope. This is the axis the screen uses to separate "authenticated" from
 * "usable".
 *
 * Drawing local features as soon as the member is confirmed shows an empty conversation list on a
 * device whose file has not opened yet, which reads to the user as lost data. The judgment lives in
 * `lib/session-state.ts`; this file holds only its vocabulary, so the judgment can be verified
 * without React.
 */
export type MobileLocalScopeStatus = "idle" | "opening" | "ready" | "error";

export interface LocalScopeController {
	/** The scope that is open right now, or null. */
	current(): MobileLocalScope | null;
	/**
	 * Opens this member's scope. For the same member this returns **the same instance**.
	 *
	 * A different member closes the current scope first. Avoiding any window where two connections
	 * overlap is the whole point of this method: during such a window a screen holding a store would
	 * still point at the previous member's file, and a write at that moment would go to someone else's
	 * database.
	 */
	activate(viewerId: string): Promise<MobileLocalScope>;
	/** Closes the current scope (sign-out). Does nothing if there is none. */
	release(): Promise<void>;
	/**
	 * Discards the scope of a member who has withdrawn, and **prevents this controller from reopening
	 * that member.**
	 *
	 * It differs from `release()` in two ways. Both exist for an irreversible deletion:
	 *
	 * 1. **Ownership is revoked synchronously.** `current()` is already `null` before the first
	 *    `await` of this call returns. That makes in-flight autosave, sync, and generation fall out of
	 *    the `ownsScope` check on the spot, and no new write can start while the files are removed
	 *    below.
	 * 2. **Reactivation is blocked.** If a late callback calls `activate` (or `ensureScope`) during
	 *    the physical deletion, the database of the member just deleted would be recreated empty
	 *    unless blocked. That file would be a ghost of a deleted account with no server resource
	 *    attached. Reactivating the same member id is rejected for the controller's whole lifetime
	 *    (the account is deleted, so there is no path to authenticate again with that id).
	 *
	 * If a different member is named, the current scope is left alone and only the block list is
	 * updated. Closing someone else's connection by mistake is the worse outcome.
	 */
	abandon(viewerId: string): Promise<void>;
	/**
	 * Erases this member's local data — **and the same member can open again immediately.**
	 *
	 * It targets the same member as `abandon()` but with the opposite meaning. There the account is
	 * gone and reactivation is blocked **permanently**; here the account still exists. Right after the
	 * wipe this member's new scope must open, and if it does not, the user is locked out of their own
	 * account (a state that only clears after the app restarts).
	 *
	 * So `abandon` is not made reversible with a boolean argument. Its finality is what protects the
	 * files that account deletion removes, and a reset that wrongly passes a boolean and locks the
	 * user out is much more expensive.
	 *
	 * ## The deletion itself is an **argument** — that is the point of this signature
	 *
	 * The physical deletion has to happen **inside** this controller's serial queue. Deleting outside
	 * it lets an `activate()` already queued run first and recreate the file about to be deleted; that
	 * empty file would then open on the next run. The race does not reproduce. The controller does not
	 * know what gets deleted (the file name and the key name belong to `purge.ts`); it knows only
	 * **when** that must happen.
	 *
	 * ## Order
	 *
	 * ```text
	 * 1  revoke ownership (sync)    `current()` is already null before this call returns —
	 *                               in-flight autosave, sync, and generation fall away right there
	 * 2  reactivation lock          a late `activate` cannot revive the file while it is erased
	 * 3  close connection           erasing while open leaves the file handle behind
	 * 4  erase()                    the actual deletion, passed in by the caller
	 * 5  unlock                     **the same member opens again** — this is where it differs from abandon
	 * ```
	 *
	 * Step 5 runs even if `erase()` fails. Leaving the lock in place would also lock out a person
	 * whose erase failed, taking away access to their conversations too (the data is still there but
	 * unopenable).
	 */
	resetViewer(viewerId: string, erase: () => Promise<void>): Promise<void>;
}

export function createLocalScopeController(
	open: ScopeOpener,
): LocalScopeController {
	let scope: MobileLocalScope | null = null;
	/**
	 * Generation of activation requests. Needed because a late-finishing open may belong to **a member
	 * who has already passed**: sign in → sign out immediately → the file finally opens. Without
	 * comparing generations, that connection would stay open with no owner.
	 */
	let generation = 0;
	let pending: Promise<unknown> = Promise.resolve();
	/** Members who can no longer be reopened — the block list that guards physical deletion after withdrawal is confirmed. */
	const abandoned = new Set<string>();
	/**
	 * Members **being erased right now** — unlike the set above, this one is temporary.
	 *
	 * The two sets are not merged, and that is the core of this file's new rules: with one set, the
	 * reset would have to remove the member from the list when it ends, and that removal would also
	 * loosen withdrawal's finality — the deleted account's database could then be revived by one late
	 * activation.
	 */
	const resetting = new Set<string>();

	const serialize = <T>(task: () => Promise<T>): Promise<T> => {
		const next = pending.then(task, task);
		pending = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};

	return {
		current: () => scope,

		activate: (viewerId) =>
			serialize(async () => {
				/**
				 * An abandoned member is not reopened. This cuts off the path where a late activation racing
				 * the deletion revives the deleted file as an empty database.
				 */
				if (abandoned.has(viewerId))
					throw new Error("a deleted member's scope can't be opened again");
				/**
				 * No opening while being erased. This queue is serial, so an activation reaching here comes
				 * after the deletion **finishes**; but while the deletion itself runs inside this queue, a
				 * request queued in front of it may still exist — if that request passes, the file about to be
				 * erased is opened first.
				 */
				if (resetting.has(viewerId))
					throw new Error("a scope can't be opened for a member being reset");
				if (scope?.viewerId === viewerId) return scope;
				const mine = ++generation;
				if (scope) {
					const previous = scope;
					scope = null;
					await previous.close();
				}
				const opened = await open(viewerId);
				/**
				 * The member may have been abandoned while the open was in progress. The check above reads the
				 * value from when this run started, so check again here. Missing it lets the deletion that
				 * erases the file race the open that recreates it.
				 */
				if (
					mine !== generation ||
					abandoned.has(viewerId) ||
					resetting.has(viewerId)
				) {
					await opened.close();
					throw new Error("scope activation was cancelled");
				}
				scope = opened;
				return opened;
			}),

		release: () =>
			serialize(async () => {
				generation++;
				const previous = scope;
				scope = null;
				if (previous) await previous.close();
			}),

		abandon: (viewerId) => {
			/**
			 * The block and the ownership revocation are **synchronous** — they finish before this
			 * function's first `await`. Doing them inside `serialize` lets an activation already queued run
			 * first, so during the window before revocation a late write passes.
			 */
			abandoned.add(viewerId);
			const target = scope?.viewerId === viewerId ? scope : null;
			if (target) {
				scope = null;
				generation++;
			}
			return serialize(async () => {
				if (target) await target.close();
			});
		},

		resetViewer: (viewerId, erase) => {
			/**
			 * Revocation and the lock are **synchronous**, for the same reason and at the same place as
			 * `abandon`. Inside the queue, an activation queued in front would run first, and a late write
			 * would pass during the window before revocation.
			 */
			resetting.add(viewerId);
			const target = scope?.viewerId === viewerId ? scope : null;
			if (target) {
				scope = null;
				generation++;
			}
			return serialize(async () => {
				try {
					if (target) await target.close();
					await erase();
				} finally {
					/**
					 * **Unlocks even on failure.** Leaving it locked also blocks the person whose erase failed
					 * from opening their own conversations, and that state only clears after the app is restarted
					 * — the opposite of what this operation was meant to do: the data is unchanged but access is
					 * lost.
					 */
					resetting.delete(viewerId);
				}
			});
		},
	};
}
