import { HOME_INSTANCE, type LocalInstance } from "../local-scope.ts";
import { normalizeInstanceOrigin } from "./instance-origin.ts";

/**
 * The servers this device knows, and which one is active (`docs/mobile/INSTANCES.md` §격리 · §하위 호환).
 *
 * It is a fact of **this device**, so it lives in the device store (`rowcat_device.db`), not in any
 * member's database and not in sync: which servers a phone talks to is not something another device
 * should learn. Restart and offline read the last value synchronously, so the app opens on the instance it
 * was on.
 *
 * ```text
 * stored     { version: 1, instances: [{ origin, addedAt }], active: origin | null }    null = home
 * home       the build's API origin — never stored, never removable, never addable as "other"
 * ```
 *
 * Four rules, each of which fails quietly if broken:
 *
 * - **The home origin cannot be added as another instance.** It would open a second scope — a second
 *   database and key set — for the same server, and the member would see an empty app on it.
 * - **Only a registered origin can be activated**, and removing the active one returns to home.
 * - **With selection off in this build, the registry is home and nothing else** — reads ignore whatever a
 *   previous build stored, and writes refuse. A value left on the device by a build with the flag on must
 *   not quietly point a build without it at another server.
 * - **A stored value that does not read is the empty registry** (home), never a throw: this is read before
 *   the first frame, and an app that does not start is worse than one that forgot its servers.
 *
 * Validation that an origin is a RowCat server is not here (`instance-check.ts`); the screen adds an
 * origin only after that check. This file only refuses what is not an origin at all.
 */

export interface RegisteredInstance {
	readonly origin: string;
	readonly addedAt: string;
}

export interface InstanceRegistryStorage {
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface InstanceRegistry {
	readonly enabled: boolean;
	/** Instances other than home, in the order they were added. */
	list(): readonly RegisteredInstance[];
	active(): LocalInstance;
	add(origin: string): Promise<RegisteredInstance>;
	remove(origin: string): Promise<void>;
	activate(instance: LocalInstance): Promise<void>;
}

interface Stored {
	version: 1;
	instances: RegisteredInstance[];
	active: string | null;
}

const EMPTY: Stored = { version: 1, instances: [], active: null };

function parse(raw: string | null): Stored {
	if (!raw) return EMPTY;
	try {
		const value = JSON.parse(raw) as Partial<Stored>;
		if (value.version !== 1 || !Array.isArray(value.instances)) return EMPTY;
		const instances = value.instances.filter(
			(entry): entry is RegisteredInstance =>
				typeof entry?.origin === "string" && typeof entry?.addedAt === "string",
		);
		const active =
			typeof value.active === "string" &&
			instances.some((entry) => entry.origin === value.active)
				? value.active
				: null;
		return { version: 1, instances, active };
	} catch {
		return EMPTY;
	}
}

export class InstanceRegistryError extends Error {
	constructor(
		readonly reason: "disabled" | "home" | "not_origin" | "unknown",
		message: string,
	) {
		super(message);
		this.name = "InstanceRegistryError";
	}
}

export function createInstanceRegistry(input: {
	storage: InstanceRegistryStorage;
	enabled: boolean;
	homeOrigin: string;
	/** Development builds accept http and local hosts (`instance-origin.ts`). */
	allowInsecure: boolean;
	now?: () => Date;
}): InstanceRegistry {
	const now = input.now ?? (() => new Date());
	const home = normalizeInstanceOrigin(input.homeOrigin, {
		allowInsecure: true,
	});
	const homeOrigin = home.ok ? home.origin : input.homeOrigin;

	const read = (): Stored =>
		input.enabled ? parse(input.storage.read()) : EMPTY;
	const save = (value: Stored) => input.storage.write(JSON.stringify(value));
	const writable = () => {
		if (!input.enabled)
			throw new InstanceRegistryError(
				"disabled",
				"This build connects to one server only.",
			);
	};

	return {
		enabled: input.enabled,
		list: () => read().instances,
		active: () => {
			const { active } = read();
			return active ? { kind: "other", origin: active } : HOME_INSTANCE;
		},
		async add(raw) {
			writable();
			const normalized = normalizeInstanceOrigin(raw, {
				allowInsecure: input.allowInsecure,
			});
			if (!normalized.ok)
				throw new InstanceRegistryError(
					"not_origin",
					"That isn't a server address.",
				);
			if (normalized.origin === homeOrigin)
				throw new InstanceRegistryError(
					"home",
					"That server is already this app's own.",
				);
			const stored = read();
			const existing = stored.instances.find(
				(entry) => entry.origin === normalized.origin,
			);
			if (existing) return existing;
			const entry = { origin: normalized.origin, addedAt: now().toISOString() };
			await save({ ...stored, instances: [...stored.instances, entry] });
			return entry;
		},
		async remove(origin) {
			writable();
			const stored = read();
			await save({
				...stored,
				instances: stored.instances.filter((entry) => entry.origin !== origin),
				active: stored.active === origin ? null : stored.active,
			});
		},
		async activate(instance) {
			writable();
			const stored = read();
			if (instance.kind === "home") {
				await save({ ...stored, active: null });
				return;
			}
			if (!stored.instances.some((entry) => entry.origin === instance.origin))
				throw new InstanceRegistryError(
					"unknown",
					"That server isn't on this device.",
				);
			await save({ ...stored, active: instance.origin });
		},
	};
}
