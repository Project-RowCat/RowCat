/**
 * Local record identity and time, one per tab. Both domains (conversations and authoring) must use
 * the same issuer. With separate issuers, two domains could receive times in the same millisecond,
 * and a later sync that puts both in one transaction could not tell which change happened first.
 * One issuer makes that order total from the start.
 */

/**
 * Issues a local identity. `crypto.randomUUID` is available in secure contexts, including
 * localhost.
 */
export const newLocalId = (): string => crypto.randomUUID();

/**
 * The last issued time. It lives at module scope because switching accounts does not change this
 * tab's clock. Per-store instances could return the same value again right after a switch.
 */
let lastIssuedAt = "";

/**
 * Returns a strictly increasing storage time, not plain `new Date().toISOString()`. Milliseconds do
 * collide: a user message followed immediately by the response, or autosave writing several
 * children in a row, produces equal `createdAt` values. The next sort key, `id` (a UUID), is
 * random, so same-millisecond records would appear in random order.
 *
 * When the same millisecond repeats, the time is advanced by 1 ms. The clock can run a few
 * milliseconds ahead of wall time, which is acceptable because order matters here and
 * sub-millisecond accuracy does not. The legacy store avoided this because its local keys were
 * auto-increment integers. UUIDs were chosen here for future sync, so the time must carry the
 * ordering.
 *
 * If another tab writes in the same millisecond, `id` still decides. It is random but stable, so
 * pagination neither duplicates nor drops records.
 */
export function nowIso(): string {
	const now = new Date().toISOString();
	if (now > lastIssuedAt) {
		lastIssuedAt = now;
		return now;
	}
	lastIssuedAt = new Date(Date.parse(lastIssuedAt) + 1).toISOString();
	return lastIssuedAt;
}

/**
 * Device identifier, issued once per local database. It is the tie-break axis of the revision
 * (`Rev.d`), so it must persist with this database (stored in the `syncState` row) and must not
 * collide with values created elsewhere. A random UUID satisfies both.
 *
 * The member ID is not used because one person uses several devices. The server's `newId()` format
 * is not used because this is not a server identity. An opaque string is enough, and matching the
 * format would invite mixing it with server ids.
 */
export const newDeviceId = (): string => crypto.randomUUID();
