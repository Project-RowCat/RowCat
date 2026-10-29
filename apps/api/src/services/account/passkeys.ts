import type { AccountPasskeyDto } from "@rowcat/contracts";
import { findAuthUser } from "../../auth/auth-user.ts";
import { auth } from "../../auth/index.ts";
import { badRequest, notFound, unauthorized } from "../../lib/errors.ts";
import { sendTransactionalMail } from "../mail/index.ts";

/**
 * Passkeys are read and changed through Better Auth, not drizzle. The `passkey` table sharing our
 * Postgres is no reason to query it: the schema is the plugin's detail, and ownership is decided in
 * the library middleware (`requireResourceOwnership`), so a direct query would be a second
 * imitation, and the one that drifts deletes someone else's credential. Same judgment as
 * `services/account/index.ts`.
 *
 * Why our own routes wrap the plugin's HTTP endpoints anyway:
 * - list: the plugin response is the credential rows as-is (publicKey, credentialID, counter); a
 *   browser calling it would seat them in the query cache, devtools and error reporter, the same
 *   axis as keeping session tokens off the wire.
 * - delete: this is the only place the server observes success, which is where the security
 *   notice goes.
 *
 * Rename sends no notice but uses the same channel, so the screen knows one response shape and gets
 * the updated list back instead of patching rows by hand.
 *
 * Registration is not here: the WebAuthn ceremony runs between the browser and the plugin, with the
 * challenge cookie bound to that round trip, and relaying it would mean rebuilding the challenge
 * lifecycle. The registration notice is sent by the auth layer's response hook (`hooks.after` in
 * `auth/index.ts`).
 */

/** The fields of the library's passkey row that we read; the rest is not even named. */
interface AuthPasskeyRow {
	id: string;
	name?: string | null | undefined;
	createdAt: Date;
}

/**
 * Credential row to contract vocabulary, the place cryptographic material stops. It does not pick
 * fields out (`const { publicKey, ...rest } = row`): that blocks only fields known today and would
 * leak any column the plugin adds, the same reason the public profile and session projections are
 * allowlists.
 */
function toAccountPasskey(row: AuthPasskeyRow): AccountPasskeyDto {
	return {
		id: row.id,
		/**
		 * No empty-string label. The plugin leaves `undefined` for unnamed passkeys, but a client may
		 * send whitespace; folded here so the screen never draws a row that "has a name but shows none".
		 */
		name: row.name?.trim() || null,
		createdAt: new Date(row.createdAt).toISOString(),
	};
}

/**
 * Stable order, newest registration first. DB order is not guaranteed, and a reshuffling list moves
 * the delete button. The id is the last axis because two rows created in the same millisecond have
 * no order (consecutive registrations do hit this).
 */
function sortPasskeys(rows: AccountPasskeyDto[]): AccountPasskeyDto[] {
	return rows.sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
		return a.id < b.id ? -1 : 1;
	});
}

/** The caller's passkeys; there is no slot to name an account. */
export async function listAccountPasskeys(
	headers: Headers,
): Promise<AccountPasskeyDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();
	const rows = await auth.api.listPasskeys({ headers });
	return sortPasskeys(rows.map(toAccountPasskey));
}

/**
 * Finds the target within this session's own list; absent is a 404.
 *
 * Ownership is in the predicate, not a separate check: the list belongs to the session's member, so
 * someone else's id is simply not found, the same way session revocation traces opaque references
 * (`revokeAccountSession` in `services/account/index.ts`).
 *
 * The library's `requireResourceOwnership` stands one layer behind. We look first because its
 * rejection vocabulary differs per endpoint (rename throws a named error, delete throws code-less
 * `UNAUTHORIZED`); following that in our mapper would turn into a 500 on one side when the library
 * adjusts, unrelated to what happened ("no such passkey").
 *
 * A missing passkey and someone else's are not distinguished, or the response becomes an existence
 * detector.
 */
async function requireOwnPasskey(
	headers: Headers,
	id: string,
): Promise<{ known: AccountPasskeyDto[]; target: AccountPasskeyDto }> {
	const known = await listAccountPasskeys(headers);
	const target = known.find((row) => row.id === id);
	if (!target) throw notFound("Passkey not found.", "passkey_not_found");
	return { known, target };
}

/**
 * Rename, returning the list after the change. The response must be the list so the screen does not
 * patch rows by hand, which would never show a passkey registered on another device at the same
 * moment.
 */
export async function renameAccountPasskey(
	headers: Headers,
	id: string,
	name: string,
): Promise<AccountPasskeyDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();
	await requireOwnPasskey(headers, id);
	try {
		await auth.api.updatePasskey({ headers, body: { id, name } });
	} catch (error) {
		translatePasskeyError(error);
	}
	return listAccountPasskeys(headers);
}

/**
 * Delete; the notice is sent only after success.
 *
 * The label is read first because after deleting there is nothing to name, and "a passkey was
 * deleted" leaves someone with several unable to tell which. That read doubles as the ownership
 * check (`requireOwnPasskey`).
 *
 * A notice failure does not undo the deletion: it cannot be undone (credentials do not come back),
 * and mail reduces delay rather than guaranteeing correctness, the same call the registration
 * notice made.
 */
export async function deleteAccountPasskey(
	headers: Headers,
	id: string,
): Promise<AccountPasskeyDto[]> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) throw unauthorized();

	const { target } = await requireOwnPasskey(headers, id);

	try {
		await auth.api.deletePasskey({ headers, body: { id } });
	} catch (error) {
		translatePasskeyError(error);
	}

	const owner = await findAuthUser(session.user.id);
	if (owner)
		await sendTransactionalMail({
			kind: "passkey-removed",
			to: { email: owner.email, name: owner.name },
			label: target.name,
		}).catch(() => {
			/** A notice failure does not undo the deletion (see above). */
		});

	return listAccountPasskeys(headers);
}

/**
 * Library error to RowCat error, reading the code and never the message. Same rule as
 * `translateAuthError` in `services/account/index.ts` with a different vocabulary; unknown codes
 * are rethrown so new failure kinds get named eventually.
 */
function translatePasskeyError(error: unknown): never {
	const code = (error as { body?: { code?: unknown } } | null)?.body?.code;
	switch (typeof code === "string" ? code : "") {
		/** A missing passkey and someone else's arrive as the same code; that is existence hiding, so we do not split them either. */
		case "PASSKEY_NOT_FOUND":
		case "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY":
			throw notFound("Passkey not found.", "passkey_not_found");
		case "FAILED_TO_UPDATE_PASSKEY":
			throw badRequest(
				"Couldn't rename the passkey. Please try again in a moment.",
				"passkey_update_failed",
			);
		case "UNAUTHORIZED":
			throw unauthorized();
		default:
			throw error;
	}
}
