import type { AppPlatform, PushRegistrationDto } from "@rowcat/contracts";
import type {
	PushPreference,
	PushPreferenceStore,
} from "../../lib/push/preference.ts";
import { type PushFailureReason, pushTokenChanged } from "./push-state.ts";

/**
 * The **order** of registration: what is written, and when.
 *
 * It lives here rather than in the wiring (`push-provider.tsx`) because what is easy to get wrong
 * in this slice is the order, not the conditions. The order can be checked without a screen; this
 * app's tests start neither React nor native modules.
 *
 * ```text
 * enable    permission (the wiring takes it first) → token → server registration → write enabled **only after success**
 * disable   server unregister → write disabled **only after success** → forget the uploaded fact
 * refresh   if disabled, do nothing → token → (if changed) server registration · write nothing
 * ```
 *
 * ## A failure does not make a decision
 *
 * If server registration fails and `enabled` is written, the installation is recorded as on while
 * receiving nothing. If unregistration fails and `disabled` is written, the server keeps sending
 * while the screen and auto-refresh believe it is off. The latter is worse: auto-refresh does not
 * re-register that installation, so the state never heals itself.
 *
 * ## Auto-refresh does not make a decision either
 *
 * Even when `refresh()` succeeds it does not write `enabled`. That is not a fact the user chose; we
 * did it with permission that already existed. Writing it would record an installation the user
 * never explicitly chose as chosen. This distinction is why the preference has three values.
 *
 * ## Permission is not asked here
 *
 * The function that shows the system prompt is called by one explicit wiring action, and this file
 * runs only **after** that result arrives. That separation is the substance of "the app never asks
 * on its own", which is why the port list contains no permission at all.
 */

export interface PushRegistrarPorts {
	preference: PushPreferenceStore;
	/** The platform. `null` off native, where registration does not exist. */
	platform(): AppPlatform | null;
	/** Must run **before** fetching a token (the Android channel). */
	ensureChannel(): Promise<void>;
	/** Provider token. Goes over the network, so it can throw. */
	readToken(): Promise<string | null>;
	installationId(): Promise<string>;
	register(registration: PushRegistrationDto): Promise<void>;
	unregister(): Promise<void>;
}

export type PushRegisterOutcome =
	| { kind: "registered" }
	/** Nothing to do (not native, turned off, or already running). */
	| { kind: "skipped" }
	| { kind: "failed"; failure: PushFailureReason };

export type PushDisableOutcome =
	| { kind: "disabled" }
	| { kind: "skipped" }
	| { kind: "failed"; failure: PushFailureReason };

export interface PushRegistrar {
	/** This installation's decision. The local store's value, not the server's. */
	preference(): PushPreference;
	/** The token last **uploaded to the server**. Gate for auto-refresh. */
	registeredToken(): string | null;
	/** Auto-refresh for devices already allowed. Makes no decision. */
	refresh(): Promise<PushRegisterOutcome>;
	/** User turned it on. Writes `enabled` only after success. */
	enable(): Promise<PushRegisterOutcome>;
	/** User turned it off. Writes `disabled` only after success. */
	disable(): Promise<PushDisableOutcome>;
	/**
	 * Forgets the uploaded fact. **The decision is not forgotten.**
	 *
	 * Two callers: when the provider rotates the token (comparing against the old value would say
	 * "same", and the new token would never upload), and when the account changes (Bob's session must
	 * not reuse Alice's registration). Both are on a different axis from this installation's decision;
	 * clearing the preference here too would turn one sign-out into re-enrolling an installation the
	 * user had turned off.
	 */
	forget(): void;
}

export function createPushRegistrar(ports: PushRegistrarPorts): PushRegistrar {
	let token: string | null = null;
	let preference: PushPreference = ports.preference.read();
	/** Collapses a second operation in the same tick, so enable and disable never overlap. */
	let running = false;

	/**
	 * Fetches the token and uploads it. **Writes no decision**; that is the caller's intent.
	 *
	 * Separates a token that could not be fetched (`null`) from a thrown error. The first means this
	 * device has no notification address (no EAS configuration, or offline). The second cannot say
	 * where it failed, so it folds to the same outcome as the first (retry), since the user's next
	 * step is the same.
	 */
	const upload = async (): Promise<PushRegisterOutcome> => {
		const platform = ports.platform();
		if (!platform) return { kind: "skipped" };
		try {
			await ports.ensureChannel();
			const next = await ports.readToken();
			if (!next) return { kind: "failed", failure: "token" };
			/** Same value: do not upload. The server is already idempotent; this only saves a round trip. */
			if (!pushTokenChanged(token, next)) return { kind: "registered" };
			await ports.register({
				installationId: await ports.installationId(),
				platform,
				provider: "expo",
				token: next,
			});
			token = next;
			return { kind: "registered" };
		} catch {
			return { kind: "failed", failure: "server" };
		}
	};

	/** The store does not throw (that file's contract). The in-memory copy is always current. */
	const remember = async (value: "enabled" | "disabled"): Promise<void> => {
		preference = value;
		await ports.preference.write(value);
	};

	return {
		preference: () => preference,
		registeredToken: () => token,

		async refresh() {
			/**
			 * **A turned-off installation is never revived automatically.** The wiring gate
			 * (`shouldRegisterPush`) already checks the same fact, but it is repeated here because there are
			 * three callers: the first refresh, token rotation, and `Try again`.
			 */
			if (preference === "disabled") return { kind: "skipped" };
			if (running) return { kind: "skipped" };
			running = true;
			try {
				return await upload();
			} finally {
				running = false;
			}
		},

		async enable() {
			if (running) return { kind: "skipped" };
			running = true;
			try {
				const outcome = await upload();
				// Order: write `enabled` only after the server accepts.
				if (outcome.kind === "registered") await remember("enabled");
				return outcome;
			} finally {
				running = false;
			}
		},

		async disable() {
			if (running) return { kind: "skipped" };
			running = true;
			try {
				await ports.unregister();
			} catch {
				/**
				 * Honestly leave the failure as-is: the server can still send, so **write nothing**. Writing
				 * `disabled` here would show the device as off while banners keep arriving.
				 */
				return { kind: "failed", failure: "server" };
			} finally {
				running = false;
			}
			await remember("disabled");
			token = null;
			return { kind: "disabled" };
		},

		forget() {
			token = null;
		},
	};
}
