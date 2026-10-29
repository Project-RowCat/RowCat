import type { DeviceKeyStore } from "@rowcat/sync";
import type { LocalDb } from "#/lib/local-data/db.ts";
import {
	type RememberedDeviceKey,
	SYNC_STATE_KEY,
} from "#/lib/local-data/sync-state.ts";

/**
 * The web implementation of 'trust this device'. No plaintext DEK is ever written to disk.
 *
 * This is the only method, and it is the best available, not a guarantee of safety. The stored
 * record is { wrapKey (the CryptoKey object itself), iv, ct = AES-GCM(wrapKey, DEK) }, where
 * wrapKey is generateKey(AES-GCM, extractable: false).
 *
 * IndexedDB can store a CryptoKey by structured clone, and a non-extractable key comes back without
 * its bytes ever being exposed. So no plaintext DEK sits on disk. Other origins, other profiles,
 * and offline disk analysis cannot extract a raw key.
 *
 * What this does not stop, stated plainly: a script on the same origin can call decrypt with that
 * CryptoKey. Non-extractable only blocks exportKey. Conversation and draft plaintext already sits
 * in the same IndexedDB, so encrypted sync neither raises nor lowers XSS exposure. What it guards
 * against is the server side: database dumps, backup theft, and a malicious operator.
 *
 * Keeping the wrapper inside the per-member local DB is also a decision. In a separate IndexedDB,
 * 'erase this device's data' would not revoke trust and would leave a stale unlock. The legacy code
 * hit exactly that bug and carried it over. Here, deleting the database with one line also clears
 * conversations, drafts, cursors, and trust.
 */
export function createDeviceKeyStore(db: LocalDb): DeviceKeyStore {
	/**
	 * Reads and rewrites the state row in one transaction. Splitting the read and the write would let
	 * another write to the same row (revision issuance) slip in between and roll the clock state back.
	 * Two copies would then receive the same revision.
	 */
	const patch = (next: RememberedDeviceKey | null): Promise<void> =>
		db.transaction("rw", [db.syncState], async () => {
			const state = await db.syncState.get(SYNC_STATE_KEY);
			if (!state) return;
			await db.syncState.put({ ...state, deviceKey: next });
		});

	return {
		async remember(dek) {
			/**
			 * The wrapping key is generated fresh every time. Reusing it would let 'revoke, then trust
			 * again' return to the same key, and an old ct left somewhere would open again.
			 */
			const wrapKey = await crypto.subtle.generateKey(
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			);
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const ct = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: "AES-GCM", iv: iv as unknown as BufferSource },
					wrapKey,
					dek as unknown as BufferSource,
				),
			);
			await patch({ wrapKey, iv, ct });
		},

		async recall() {
			const state = await db.syncState.get(SYNC_STATE_KEY);
			const remembered = state?.deviceKey ?? null;
			if (!remembered) return null;
			try {
				return new Uint8Array(
					await crypto.subtle.decrypt(
						{ name: "AES-GCM", iv: remembered.iv as unknown as BufferSource },
						remembered.wrapKey,
						remembered.ct as unknown as BufferSource,
					),
				);
			} catch {
				/**
				 * A corrupt wrapper counts as absent. Throwing would fail the entire screen entry, and the user
				 * would never get a chance to enter the recovery code. Returning null sends the controller to
				 * the locked state and opens the normal unlock path.
				 */
				return null;
			}
		},

		/** Revokes trust. Local only: nothing on the server is touched. */
		forget: () => patch(null),
	};
}
