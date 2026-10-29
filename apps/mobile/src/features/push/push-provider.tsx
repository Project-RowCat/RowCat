import { refreshNotifications } from "@rowcat/query";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { pushInstallationStore } from "../../lib/push/device-installation.ts";
import { pushPreferenceStore } from "../../lib/push/device-preference.ts";
import {
	ensurePushChannel,
	installPushPresentation,
	type NativePushPermission,
	nativePushPlatform,
	onPushReceived,
	onPushResponse,
	onPushTokenChanged,
	openPushSystemSettings,
	readExpoPushToken,
	readInitialPushResponse,
	readPushPermission,
	requestPushPermission,
} from "../../lib/push/native.ts";
import type { PushPreference } from "../../lib/push/preference.ts";
import {
	createPushRegistrar,
	type PushDisableOutcome,
	type PushRegisterOutcome,
	type PushRegistrar,
} from "./push-registrar.ts";
import {
	pushReceiptShouldRefreshInbox,
	pushResponsePlan,
} from "./push-response.ts";
import {
	type PushFailureReason,
	type PushRegistrationPhase,
	type PushSectionState,
	resolvePushSectionState,
	shouldRegisterPush,
} from "./push-state.ts";

/**
 * The **single push wiring**, mounted at the app root.
 *
 * ## Permission is not asked here
 *
 * Mounting, loading and signing in do not show the system prompt. This component does four things:
 * it **reads** the current permission, **refreshes** registration for devices already allowed,
 * decides how an arriving banner is drawn, and links a tapped banner to the inbox. The function
 * that shows the prompt is called by one explicit action: the `Turn on` in the settings screen.
 *
 * ## Why the root
 *
 * If one screen attached the listeners, a tapped banner would go nowhere while that screen is
 * unmounted. A banner tapped while the app was dead happened **before** any listener attached, so
 * it must be read once at startup (the same judgement that puts the update-note container at the
 * root).
 *
 * ## The screen does not hold state twice
 *
 * Permission and registration progress live only here, and the settings section reads them. If the
 * section held its own state, leaving and returning would clear "turning on" mid-operation, and the
 * root's auto-refresh and the section would draw different values.
 *
 * ## The order is not here
 *
 * What is written and when (the order between server registration and this installation's decision)
 * belongs to the pure module (`push-registrar.ts`). What remains in this file is **reading and
 * asking for permission** and moving the result into render state. This app's tests start neither
 * React nor native modules, so whatever stays here is code those tests cannot reach.
 */

export interface MobilePushValue {
	state: PushSectionState;
	/** Shows the system prompt and, if allowed, registers this device. */
	enable(): Promise<void>;
	/** Turns off server delivery only. The app cannot revert the OS permission. */
	disable(): Promise<void>;
	/** Permission granted but not registered. Unlike `enable`, shows no prompt. */
	retry(): Promise<void>;
	/** Opens system settings: the only path once a refusal means no prompt will appear again. */
	openSystemSettings(): Promise<void>;
}

const PushContext = createContext<MobilePushValue | null>(null);

export function MobilePushProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { session } = useMobileIdentity();
	const viewerId = session.viewer?.id ?? null;

	const [permission, setPermission] = useState<
		NativePushPermission | "checking"
	>("checking");
	const [canAskAgain, setCanAskAgain] = useState(true);
	const [phase, setPhase] = useState<PushRegistrationPhase>("idle");
	const [failure, setFailure] = useState<PushFailureReason | null>(null);

	/**
	 * The owner of registration: **one for the lifetime of this component.**
	 *
	 * Created in render rather than in an effect, because the first render must already know this
	 * installation's decision (which is also why the storage read is synchronous). The uploaded token
	 * is not render state either: that value is the gate for auto-refresh, not a picture. Holding it
	 * in state would make each write trigger another render, which would re-fire the same effect.
	 */
	/**
	 * Whether one operation is currently running. **A ref, not render state.**
	 *
	 * The registrar also collapses overlaps (it protects the server round trip), but this screen
	 * checks again **for the sake of the UI**: if auto-refresh slips in while an explicit operation
	 * runs, the "nothing happened" it returns would overwrite the in-progress indicator and flash a
	 * red failure message for a frame, right after the user pressed `Turn on`.
	 */
	const busy = useRef(false);
	const registrarRef = useRef<PushRegistrar | null>(null);
	registrarRef.current ??= createPushRegistrar({
		preference: pushPreferenceStore,
		platform: nativePushPlatform,
		ensureChannel: ensurePushChannel,
		readToken: readExpoPushToken,
		installationId: () => pushInstallationStore.resolve(),
		register: async (registration) => {
			await getRowCatClient().push.register(registration);
		},
		unregister: () => getRowCatClient().push.unregister(),
	});
	const registrar = registrarRef.current;

	/**
	 * A render copy of this installation's decision. The store is the authority; this is only the
	 * picture.
	 */
	const [preference, setPreference] = useState<PushPreference>(() =>
		registrar.preference(),
	);

	/* ── Presentation is configured once ── */
	useEffect(() => {
		installPushPresentation();
	}, []);

	/* ── Read permission. Do not ask. ── */
	const syncPermission = useCallback(async () => {
		try {
			const status = await readPushPermission();
			setPermission(status.permission);
			setCanAskAgain(status.canAskAgain);
			return status.permission;
		} catch {
			/**
			 * Do not fold an unreadable permission into "refused". That would show the guidance to open
			 * system settings for a user whose settings are fine.
			 */
			setPermission("undetermined");
			setCanAskAgain(true);
			return "undetermined" as const;
		}
	}, []);

	useEffect(() => {
		void syncPermission();
	}, [syncPermission]);

	/**
	 * Forget the registration fact when the account changes.
	 *
	 * **So that Bob's session does not reuse Alice's registration.** Server isolation is already
	 * structural (registration is tied to the session), but without forgetting here Bob's first frame
	 * would draw "receiving", and auto-refresh would do nothing because the token is the same.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: reacts to one event, a member change.
	useEffect(() => {
		/**
		 * Only the **uploaded fact** is forgotten. The installation's decision belongs to the
		 * installation, not the account; clearing it here would turn one sign-out into re-enrolling a
		 * device that was turned off.
		 */
		registrar.forget();
		setPhase("idle");
		setFailure(null);
	}, [viewerId]);

	/**
	 * Moves the registration result into render state.
	 *
	 * `skipped` means nothing happened, so it is not drawn as a failure: the app is not native, the
	 * device was turned off, or an operation is already running. If a token was uploaded earlier, the
	 * device is still receiving.
	 */
	const applyRegisterOutcome = useCallback(
		(outcome: PushRegisterOutcome) => {
			setPreference(registrar.preference());
			switch (outcome.kind) {
				case "registered":
					setPhase("registered");
					setFailure(null);
					return;
				case "failed":
					/**
					 * **Permission is not reverted.** Touching OS settings because the server briefly failed is
					 * neither something we can do nor something we should do. The state stays exactly as
					 * "permission granted, no registration", and a retry path appears on screen.
					 */
					setPhase("failed");
					setFailure(outcome.failure);
					return;
				default:
					setPhase(registrar.registeredToken() ? "registered" : "idle");
			}
		},
		[registrar],
	);

	/**
	 * Uploads to the server, **only when permission already exists.**
	 *
	 * This function does not show the system prompt. `enable` is the only one that does, and that
	 * separation is the substance of the "never asks" promise.
	 */
	const refresh = useCallback(async (): Promise<void> => {
		/** If an operation is running, back off **without touching the screen**; see `busy` above for why. */
		if (busy.current) return;
		busy.current = true;
		setPhase("registering");
		setFailure(null);
		try {
			applyRegisterOutcome(await registrar.refresh());
		} finally {
			busy.current = false;
		}
	}, [applyRegisterOutcome, registrar]);

	/* ── Auto-refresh for devices already allowed ── */
	useEffect(() => {
		if (
			!shouldRegisterPush({
				signedIn: viewerId !== null,
				permission,
				preference,
				registeredToken: registrar.registeredToken(),
			})
		)
			return;
		void refresh();
	}, [viewerId, permission, preference, refresh, registrar]);

	/**
	 * Re-uploads immediately when the provider rotates the token.
	 *
	 * Without listening to this event, the device receives nothing until the next cold start, and in
	 * the meantime every delivery fails against the dead token. Clearing the registration fact first
	 * is the point: if it is not cleared, the token comparison above answers "same" and uploads
	 * nothing.
	 */
	useEffect(() => {
		const subscription = onPushTokenChanged(() => {
			registrar.forget();
			/**
			 * Pass through the gate **with the same function** as auto-refresh. Writing the conditions again
			 * here would let the copy go stale, and it goes stale in a predictable direction: forgetting the
			 * turned-off fact would let one token rotation silently re-register that installation.
			 */
			if (
				!shouldRegisterPush({
					signedIn: viewerId !== null,
					permission,
					preference,
					registeredToken: registrar.registeredToken(),
				})
			)
				return;
			void refresh();
		});
		return () => subscription.remove();
	}, [viewerId, permission, preference, refresh, registrar]);

	/* ── Arrival and tap ── */
	useEffect(() => {
		const received = onPushReceived((data) => {
			/**
			 * **Do not fabricate a notification.** What arrived is only a signal to ask again; the server
			 * answers what it was.
			 */
			if (pushReceiptShouldRefreshInbox(data))
				void refreshNotifications(queryClient);
		});
		const responded = onPushResponse((data) => {
			const plan = pushResponsePlan(data);
			void refreshNotifications(queryClient);
			/** Uses `navigate`: `push` would stack a new entry every time a banner is tapped. */
			router.navigate(plan.route);
		});
		return () => {
			received.remove();
			responded.remove();
		};
	}, [queryClient, router]);

	/**
	 * A banner tapped while the app was dead.
	 *
	 * Listeners alone miss it: the tap is what launched the app, so it happened before any listener
	 * attached. Read it once (reading again would bounce the user to the inbox on every app launch).
	 */
	const openedInitial = useRef(false);
	useEffect(() => {
		if (openedInitial.current) return;
		openedInitial.current = true;
		void (async () => {
			const data = await readInitialPushResponse().catch(() => null);
			if (!data) return;
			router.navigate(pushResponsePlan(data).route);
		})();
	}, [router]);

	/* ── Explicit operations ── */

	const enable = useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		setFailure(null);
		let status: NativePushPermission;
		try {
			const response = await requestPushPermission();
			status = response.permission;
			setPermission(response.permission);
			setCanAskAgain(response.canAskAgain);
		} catch {
			busy.current = false;
			setPhase("failed");
			setFailure("permission");
			return;
		}
		if (status !== "granted") {
			busy.current = false;
			setPhase("idle");
			setFailure("permission");
			return;
		}
		setPhase("registering");
		try {
			/** Enabled is written only **after** the server accepts it (`push-registrar.ts`). */
			applyRegisterOutcome(await registrar.enable());
		} finally {
			busy.current = false;
		}
	}, [applyRegisterOutcome, registrar]);

	const disable = useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		/**
		 * This device is still receiving while turning off, so the phase is not `registering`. The
		 * decision is written only once unregistration succeeds; on failure the screen returns accurately
		 * to "still receiving".
		 */
		setPhase("unregistering");
		setFailure(null);
		const outcome: PushDisableOutcome = await registrar
			.disable()
			.finally(() => {
				busy.current = false;
			});
		setPreference(registrar.preference());
		switch (outcome.kind) {
			case "disabled":
				setPhase("idle");
				return;
			case "failed":
				/**
				 * Honestly keep the failure: the device is still receiving, so the phase is `registered`.
				 * Unlike sign-out, this operation has no server-side cascade doing the work for us.
				 */
				setPhase("registered");
				setFailure(outcome.failure);
				return;
			default:
				setPhase(registrar.registeredToken() ? "registered" : "idle");
		}
	}, [registrar]);

	const retry = useCallback(async () => {
		await syncPermission();
		await refresh();
	}, [refresh, syncPermission]);

	const value = useMemo(
		(): MobilePushValue => ({
			state: resolvePushSectionState({
				permission,
				canAskAgain,
				phase,
				failure,
				signedIn: viewerId !== null,
				preference,
			}),
			enable,
			disable,
			retry,
			openSystemSettings: openPushSystemSettings,
		}),
		[
			permission,
			canAskAgain,
			phase,
			failure,
			viewerId,
			preference,
			enable,
			disable,
			retry,
		],
	);

	return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function useMobilePush(): MobilePushValue {
	const value = useContext(PushContext);
	if (!value) throw new Error("push can't be read outside MobilePushProvider");
	return value;
}
