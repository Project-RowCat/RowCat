/**
 * Installation identity: **one opaque random number that points at this app installation.**
 *
 * ## Not a fingerprint
 *
 * It is not derived from the device name, serial number, advertising id or member id. Deriving it
 * from any of those would make the string a value that links a person across devices, and once it
 * reached the server it would be data we chose not to collect. This is random; reinstalling the app
 * yields a different value.
 *
 * ## Not synced
 *
 * It lives in **device storage**, not the member database (alongside appearance preferences and
 * read notices). It must be the same whether or not anyone is signed in, survive an account switch,
 * and not be erased by a member's local-data reset. Those three are this store's tests.
 *
 * ## Not a token
 *
 * The push token is issued by the provider and changes from time to time. This value says the
 * installation is *the same one even when that token changes*; merging the two would create a new
 * server registration on every token refresh.
 */

/** Key name in device storage. The `rowcat.` prefix is this repository's convention. */
export const PUSH_INSTALLATION_KEY = "rowcat.push.installationId";

/** The same predicate the server contract accepts: 32 lowercase hex characters. */
const INSTALLATION_PATTERN = /^[0-9a-f]{32}$/;

export interface PushInstallationStorage {
	/** Never throws; failure reads as `null`. */
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface PushInstallationStore {
	/**
	 * This installation's id. If absent, create one, store it, and return it.
	 *
	 * **A failed write does not discard the value.** If the save fails, this run still uses the value
	 * and the next run creates another. The server then holds one extra registration, a cost far
	 * smaller than a device that receives nothing.
	 */
	resolve(): Promise<string>;
}

const isValid = (value: string | null | undefined): value is string =>
	typeof value === "string" && INSTALLATION_PATTERN.test(value);

/**
 * A 32-character hex random value.
 *
 * The randomness source is an argument so tests can check the value's shape against the contract; a
 * pure module calling `crypto` directly would remove any way to verify the format by value (the
 * same judgement as the palette generator).
 */
export function newPushInstallationId(
	randomBytes: (length: number) => Uint8Array,
): string {
	return Array.from(randomBytes(16), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function createPushInstallationStore(
	storage: PushInstallationStorage,
	randomBytes: (length: number) => Uint8Array,
): PushInstallationStore {
	let cached: string | null = null;
	return {
		async resolve() {
			if (cached) return cached;
			let stored: string | null = null;
			try {
				stored = storage.read();
			} catch {
				stored = null;
			}
			if (isValid(stored)) {
				cached = stored;
				return stored;
			}
			const created = newPushInstallationId(randomBytes);
			cached = created;
			try {
				await storage.write(created);
			} catch {
				// A failed write still uses the value for this run (see `resolve`).
			}
			return created;
		},
	};
}
