import type { PushRegistrationDto } from "@rowcat/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPushPreferenceStore,
	type PushPreferenceStorage,
} from "../../lib/push/preference.ts";
import {
	createPushRegistrar,
	type PushRegistrar,
	type PushRegistrarPorts,
} from "./push-registrar.ts";

/**
 * The **order** of registration: what must succeed before what is written.
 *
 * Three things this file locks:
 *
 * ```text
 * 1. A turned-off installation is not revived automatically: not by an app restart, not by token rotation
 * 2. A failure makes no decision: a failed enable is not recorded as on, and the reverse
 * 3. The installation's decision survives an account change: only the uploaded fact is forgotten
 * ```
 *
 * The order can be checked without rendering a screen because it lives in a pure module.
 */

const TOKEN = "ExponentPushToken[first]";
const NEXT_TOKEN = "ExponentPushToken[second]";
const INSTALLATION = "a".repeat(32);

/** Device storage that survives an app restart. */
function deviceStorage(initial: string | null = null) {
	let value = initial;
	const port: PushPreferenceStorage = {
		read: () => value,
		write: async (next) => {
			value = next;
		},
	};
	return {
		port,
		stored: () => value,
	};
}

interface Harness {
	registrar: PushRegistrar;
	register: ReturnType<typeof vi.fn>;
	unregister: ReturnType<typeof vi.fn>;
	readToken: ReturnType<typeof vi.fn>;
	stored: () => string | null;
	/** Equivalent to reopening the app: a new instance on the same storage. */
	restart(): Harness;
}

function harness(
	options: {
		stored?: string | null;
		token?: string | null;
		platform?: PushRegistrarPorts["platform"];
		register?: () => Promise<void>;
		unregister?: () => Promise<void>;
	} = {},
): Harness {
	const storage = deviceStorage(options.stored ?? null);

	const build = (): Harness => {
		const readToken = vi.fn(async () =>
			options.token === undefined ? TOKEN : options.token,
		);
		const register = vi.fn(
			options.register ??
				(async (_registration: PushRegistrationDto): Promise<void> => {}),
		);
		const unregister = vi.fn(options.unregister ?? (async () => {}));
		const registrar = createPushRegistrar({
			preference: createPushPreferenceStore(storage.port),
			platform: options.platform ?? (() => "ios"),
			ensureChannel: async () => {},
			readToken,
			installationId: async () => INSTALLATION,
			register,
			unregister,
		});
		return {
			registrar,
			register,
			unregister,
			readToken,
			stored: storage.stored,
			restart: build,
		};
	};

	return build();
}

describe("automatic refresh", () => {
	it("uploads a device that already has permission", async () => {
		const app = harness();
		expect(await app.registrar.refresh()).toEqual({ kind: "registered" });
		expect(app.register).toHaveBeenCalledWith({
			installationId: INSTALLATION,
			platform: "ios",
			provider: "expo",
			token: TOKEN,
		});
	});

	/**
	 * **Auto-refresh does not make a decision.** Writing it would record an installation the user
	 * never chose as if it had been chosen; that distinction is why this repository has three values.
	 */
	it("doesn't record it as on even on success", async () => {
		const app = harness();
		await app.registrar.refresh();
		expect(app.registrar.preference()).toBe("unset");
		expect(app.stored()).toBeNull();
	});

	it("doesn't upload the same token twice", async () => {
		const app = harness();
		await app.registrar.refresh();
		await app.registrar.refresh();
		expect(app.register).toHaveBeenCalledTimes(1);
	});

	it("does nothing when not native", async () => {
		const app = harness({ platform: () => null });
		expect(await app.registrar.refresh()).toEqual({ kind: "skipped" });
		expect(app.readToken).not.toHaveBeenCalled();
	});

	it("fails with that reason when the token can't be fetched", async () => {
		const app = harness({ token: null });
		expect(await app.registrar.refresh()).toEqual({
			kind: "failed",
			failure: "token",
		});
	});

	it("when the server refuses, the fact of having uploaded doesn't remain", async () => {
		const app = harness({
			register: () => Promise.reject(new Error("offline")),
		});
		expect(await app.registrar.refresh()).toEqual({
			kind: "failed",
			failure: "server",
		});
		expect(app.registrar.registeredToken()).toBeNull();
	});
});

describe("an install explicitly turned off", () => {
	/** **A bug from this slice.** OS permission stays granted, so auto-refresh revived it. */
	it("isn't registered automatically even after reopening the app", async () => {
		const app = harness();
		await app.registrar.enable();
		await app.registrar.disable();
		expect(app.stored()).toBe("disabled");

		const restarted = app.restart();
		expect(restarted.registrar.preference()).toBe("disabled");
		expect(await restarted.registrar.refresh()).toEqual({ kind: "skipped" });
		expect(restarted.register).not.toHaveBeenCalled();
		/** Does not even fetch a token: that call is itself a provider round trip. */
		expect(restarted.readToken).not.toHaveBeenCalled();
	});

	/**
	 * A provider rotating the token is not something the user did. If that event flipped the decision,
	 * the fact of turning off would disappear with no sign.
	 */
	it("isn't re-registered even when the token changes", async () => {
		const app = harness({ stored: "disabled" });
		app.registrar.forget();
		expect(await app.registrar.refresh()).toEqual({ kind: "skipped" });
		expect(app.register).not.toHaveBeenCalled();
	});

	/** Turning back on is not blocked: an explicit operation overwrites the decision. */
	it("registers when the user turns it on again", async () => {
		const app = harness({ stored: "disabled" });
		expect(await app.registrar.enable()).toEqual({ kind: "registered" });
		expect(app.registrar.preference()).toBe("enabled");
		expect(app.stored()).toBe("enabled");
	});
});

describe("turning on — order", () => {
	it("records it as on only after the server accepted", async () => {
		const app = harness();
		expect(await app.registrar.enable()).toEqual({ kind: "registered" });
		expect(app.stored()).toBe("enabled");
	});

	/**
	 * Writing `enabled` after a failure would record the installation as on while it receives nothing.
	 */
	it("doesn't record it as on when the server refuses", async () => {
		const app = harness({
			register: () => Promise.reject(new Error("offline")),
		});
		expect(await app.registrar.enable()).toEqual({
			kind: "failed",
			failure: "server",
		});
		expect(app.registrar.preference()).toBe("unset");
		expect(app.stored()).toBeNull();
	});

	it("doesn't record it as on when the token can't be fetched either", async () => {
		const app = harness({ token: null });
		await app.registrar.enable();
		expect(app.stored()).toBeNull();
	});

	/** If enable fails on an installation that was off, **the fact that it was off remains.** */
	it("when turning on fails on an install that was off, the decision stays", async () => {
		const app = harness({
			stored: "disabled",
			register: () => Promise.reject(new Error("offline")),
		});
		await app.registrar.enable();
		expect(app.registrar.preference()).toBe("disabled");
		expect(app.stored()).toBe("disabled");
	});
});

describe("turning off — order", () => {
	it("records it as off only after the server unregister succeeded", async () => {
		const app = harness();
		await app.registrar.enable();
		expect(await app.registrar.disable()).toEqual({ kind: "disabled" });
		expect(app.unregister).toHaveBeenCalledTimes(1);
		expect(app.stored()).toBe("disabled");
		/** The uploaded fact is cleared too, so re-enabling does not read the same token as already uploaded. */
		expect(app.registrar.registeredToken()).toBeNull();
	});

	/**
	 * Writing `disabled` here would show the screen as off while the server keeps sending.
	 * Auto-refresh does not re-register that installation, so the state **never heals itself.**
	 */
	it("doesn't record it as off when the server unregister fails", async () => {
		const app = harness({
			unregister: () => Promise.reject(new Error("offline")),
		});
		await app.registrar.enable();
		expect(await app.registrar.disable()).toEqual({
			kind: "failed",
			failure: "server",
		});
		expect(app.registrar.preference()).toBe("enabled");
		expect(app.stored()).toBe("enabled");
	});

	it("still receiving after a failed turn-off", async () => {
		const app = harness({
			unregister: () => Promise.reject(new Error("offline")),
		});
		await app.registrar.enable();
		await app.registrar.disable();
		expect(app.registrar.registeredToken()).toBe(TOKEN);
	});
});

describe("what is forgotten and what isn't", () => {
	/**
	 * When the account changes, Bob's session must not reuse Alice's registration. The uploaded fact
	 * must be forgotten so that the next refresh actually reaches the server.
	 */
	it("when the account switches it forgets the upload and uploads again", async () => {
		const app = harness();
		await app.registrar.refresh();
		expect(app.register).toHaveBeenCalledTimes(1);

		app.registrar.forget();
		expect(app.registrar.registeredToken()).toBeNull();

		await app.registrar.refresh();
		expect(app.register).toHaveBeenCalledTimes(2);
	});

	/**
	 * **The decision belongs to the installation, not the account.** Clearing it here would turn one
	 * sign-out back into a candidate for auto-registration for a device that had been turned off.
	 */
	it("this install's decision stays even when the account switches", async () => {
		const app = harness({ stored: "disabled" });
		app.registrar.forget();
		expect(app.registrar.preference()).toBe("disabled");
		expect(app.stored()).toBe("disabled");
	});

	/** On an installation left on, a rotated token must actually upload. */
	it("a changed token on an install that's on is uploaded again", async () => {
		let token = TOKEN;
		const register = vi.fn(
			async (_registration: PushRegistrationDto): Promise<void> => {},
		);
		const storage = deviceStorage("enabled");
		const registrar = createPushRegistrar({
			preference: createPushPreferenceStore(storage.port),
			platform: () => "ios",
			ensureChannel: async () => {},
			readToken: async () => token,
			installationId: async () => INSTALLATION,
			register,
			unregister: async () => {},
		});

		await registrar.refresh();
		token = NEXT_TOKEN;
		registrar.forget();
		await registrar.refresh();

		expect(register).toHaveBeenCalledTimes(2);
		expect(register.mock.calls[1]?.[0]).toMatchObject({ token: NEXT_TOKEN });
	});
});

describe("holds only this install's value", () => {
	/**
	 * If a member id, session id or token got mixed in here, values that must be cleared on account
	 * change would land in installation scope. The type has no slot for them, and this also checks the
	 * stored **string**.
	 */
	it("what's stored is one vocabulary value", async () => {
		const app = harness();
		await app.registrar.enable();
		expect(app.stored()).toBe("enabled");
		await app.registrar.disable();
		expect(app.stored()).toBe("disabled");
	});
});

describe("overlapping operations", () => {
	let app: Harness;
	beforeEach(() => {
		app = harness();
	});

	/** If enable and disable overlap, the screen cannot say which one won. */
	it("a second operation in the same tick folds", async () => {
		const first = app.registrar.enable();
		const second = app.registrar.enable();
		expect(await second).toEqual({ kind: "skipped" });
		await first;
		expect(app.register).toHaveBeenCalledTimes(1);
	});
});
