import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import type {
	RuntimePersistentRecord,
	RuntimePlaythroughRecord,
	RuntimeSaveSlot,
} from "./model.ts";

/**
 * Platform-neutral save port. Dexie on web and SQLite on mobile fill the same contract. This file
 * contains no Dexie or SQLite and must not. The port's value is that both adapters pass the same
 * behavior suite (store-contract.ts). Without the suite, 'works on web, progress vanishes only on
 * the phone' would be invisible in review.
 * - put takes a write, not a record. The revision must be issued inside the store's transaction
 *   (hlc.ts). If the caller issued it, issuing and storing would split apart. A crash between them
 *   would leave a saved record with an unchanged clock, and the next write could reissue the same
 *   revision, making two different versions indistinguishable.
 * - The adapter decides identity, revision, dirty, and serverVersion inside its own transaction.
 *   The coordinator passes only the snapshot and a timestamp.
 * - Reset is not a separate method. deletePlaythrough() would delete locally without propagating,
 *   and a device holding old progress would restore it on the next sync. The absence of a delete on
 *   this port encodes that rule.
 */

export interface RuntimeSaveWrite<S> {
	storyId: string;
	snapshot: S;
	/** ISO 8601. The coordinator's clock port creates it. The store does not read Date.now(). */
	updatedAt: string;
}

export interface RuntimePlaythroughWrite
	extends RuntimeSaveWrite<RuntimeStoryStateSnapshot> {
	slot?: RuntimeSaveSlot;
}

export type RuntimePersistentWrite =
	RuntimeSaveWrite<RuntimePersistentStateSnapshot>;

export interface RuntimeSaveStore {
	/**
	 * The progress this device knows for the story, or null if there is none. A tombstone is not null.
	 * The contract returns the deleted record as it is. Folding 'absent' and 'deleted' into null would
	 * remove the only way to answer where the difference matters, such as propagating a reset.
	 */
	getPlaythrough(
		storyId: string,
		slot?: RuntimeSaveSlot,
	): Promise<RuntimePlaythroughRecord | null>;
	putPlaythrough(
		write: RuntimePlaythroughWrite,
	): Promise<RuntimePlaythroughRecord>;
	getPersistent(storyId: string): Promise<RuntimePersistentRecord | null>;
	putPersistent(
		write: RuntimePersistentWrite,
	): Promise<RuntimePersistentRecord>;
	/**
	 * Whether this device is still waiting for synced data. false means keep waiting. On a freshly
	 * paired device, a missing local row means 'not known yet', not 'new game'. Folding the two would
	 * start a new game on an account with months of progress (§55).
	 *
	 * The question is broader than its name, and that difference blocked the product. The method was
	 * originally backed by the initialSyncDone bootstrap flag alone. An account that never set up sync
	 * kept that flag false forever, because no first sync would ever finish. Trusting the value there
	 * left the play screen stuck on `Syncing`, and no one could open a story. Phase 7's
	 * browser journey caught it first. So the adapter must answer 'is there anything to wait for', not
	 * 'has bootstrap finished'. If the device holds no sync key, it has nothing to receive, and
	 * waiting would never end.
	 *
	 * Accepted gap: on an account with sync set up, a device that is locked alone looks locally the
	 * same as an account that never set up sync (only the missing key is visible). This returns true,
	 * and a new playthrough starts. The gap is accepted because the alternative is worse: a locked
	 * device cannot read the arriving save (it is ciphertext), so waiting would last forever. Closing
	 * the gap needs the server-side fact 'does this account have a keyring', which this port
	 * deliberately does not know. When it is closed, the play surface receives that value and passes
	 * it in.
	 */
	initialSyncDone(): Promise<boolean>;
}
