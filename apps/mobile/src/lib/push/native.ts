import { type AppPlatform, PUSH_ANDROID_CHANNEL_ID } from "@rowcat/contracts";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";

/**
 * The **only file** that knows `expo-notifications`.
 *
 * No other code in this app imports that module, and a static scan locks that
 * (`features/push/push-boundaries.test.ts`). It is kept this narrow for three reasons:
 *
 * - The module does not open in Node. If rules (permission-state interpretation, registration
 *   timing, wording) lived here too, that much code would be out of reach of the tests.
 * - The SDK's surface changes between versions (the notification display option split from
 *   `shouldShowAlert` into banner and list). That change should end in one file.
 * - **Where the code that asks for permission lives** is this slice's product decision. If it
 *   could be called from several places, a screen mounting one day would open the system dialog.
 *
 * ## What is **not** done here
 *
 * - The app does not ask for permission at startup. This file only exports functions, and the one
 *   call site is an explicit action on the settings screen.
 * - The badge count is not touched (V1). The server holds an unread count, but pushes arrive out
 *   of order, duplicated, and can arrive after another device has already read them. Using an
 *   absolute value as it comes makes that number go backwards. Showing a wrong number with no way
 *   to correct it is worse than showing none.
 * - No local notifications are scheduled. Every banner this app shows comes from the server.
 */

/** The four outcomes of permission. These are the only values the screen reads. */
export type NativePushPermission =
	/** Not asked yet. The system dialog can be shown. */
	| "undetermined"
	| "granted"
	/** Refused. Whether it can be asked again is answered by `canAskAgain`. */
	| "denied";

export interface NativePushPermissionStatus {
	permission: NativePushPermission;
	/**
	 * Whether the system dialog can be shown again.
	 *
	 * On iOS this is permanently false once refused. The only thing the user can do then is open the
	 * system settings, and the screen must know that so it does not draw a button that does nothing
	 * when pressed.
	 */
	canAskAgain: boolean;
}

const toStatus = (
	response: Notifications.NotificationPermissionsStatus,
): NativePushPermissionStatus => ({
	permission: response.granted
		? "granted"
		: response.status === "undetermined"
			? "undetermined"
			: "denied",
	canAskAgain: response.canAskAgain,
});

/** Current permission state. Does not ask; read only. */
export async function readPushPermission(): Promise<NativePushPermissionStatus> {
	return toStatus(await Notifications.getPermissionsAsync());
}

/**
 * Shows the system dialog. **Called only when the user explicitly turns push on.**
 *
 * Startup, first render, sign-in and sign-up do not call this function; a static scan guards that
 * absence. Once refused, the OS does not show the dialog again, so the result then is `denied`
 * unchanged.
 */
export async function requestPushPermission(): Promise<NativePushPermissionStatus> {
	return toStatus(await Notifications.requestPermissionsAsync());
}

/**
 * Creates Android's default channel. Does nothing on iOS.
 *
 * Must be called **before** the token is obtained. A first notification arriving without a channel
 * goes into the default channel the OS creates, and that channel's name means nothing to the user.
 */
export async function ensurePushChannel(): Promise<void> {
	if (Platform.OS !== "android") return;
	await Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL_ID, {
		name: "Notifications",
		importance: Notifications.AndroidImportance.DEFAULT,
	});
}

/** The current platform. Same value as the contract's vocabulary. */
export function nativePushPlatform(): AppPlatform | null {
	if (Platform.OS === "ios") return "ios";
	if (Platform.OS === "android") return "android";
	return null;
}

/**
 * The Expo push token.
 *
 * **Feature code does not write the project id.** EAS configuration already holds it
 * (`extra.eas.projectId` in `app.config.ts`), and a literal here would go stale on its own when the
 * project moves. Without it no token can be obtained, so the result is `null`.
 *
 * This goes over the network. It throws when offline or on timeout, so the caller handles failure.
 */
export async function readExpoPushToken(): Promise<string | null> {
	const projectId =
		Constants.expoConfig?.extra?.eas?.projectId ??
		Constants.easConfig?.projectId;
	if (typeof projectId !== "string" || !projectId) return null;
	const token = await Notifications.getExpoPushTokenAsync({ projectId });
	return token.data || null;
}

/**
 * How notifications that arrive in the foreground are presented.
 *
 * **Set explicitly.** If left unset, the SDK default answers, and that default changes silently
 * when the SDK version rises. Banner and list are on because this app has no second in-app
 * notification system; hiding an event just because the app is open could mean the user never sees
 * it.
 *
 * **Badge is off** (see the header for why).
 */
export function installPushPresentation(): void {
	Notifications.setNotificationHandler({
		handleNotification: async () => ({
			shouldShowBanner: true,
			shouldShowList: true,
			shouldPlaySound: true,
			shouldSetBadge: false,
		}),
	});
}

export interface PushSubscription {
	remove(): void;
}

/** Foreground receipt. Passes only the data; screens have no reason to know the notification object. */
export function onPushReceived(
	listener: (data: unknown) => void,
): PushSubscription {
	return Notifications.addNotificationReceivedListener((event) =>
		listener(event.request.content.data),
	);
}

/**
 * The provider swapped the token. **Rare, but it does happen.**
 *
 * The old token becomes invalid at that moment. If this event is not listened to, the device
 * receives nothing until the next cold start, and every delivery in between fails with
 * `DeviceNotRegistered`.
 *
 * The callback carries the **device token**, which is not the value we upload to the server. The
 * event is a "fetch again" signal, and the caller calls `readExpoPushToken()` again. Rule: do not
 * ask for the device token again inside that handler, since that becomes an infinite loop.
 */
export function onPushTokenChanged(listener: () => void): PushSubscription {
	return Notifications.addPushTokenListener(() => listener());
}

/** The user pressed a banner. */
export function onPushResponse(
	listener: (data: unknown) => void,
): PushSubscription {
	return Notifications.addNotificationResponseReceivedListener((event) =>
		listener(event.notification.request.content.data),
	);
}

/**
 * A banner pressed while the app was dead.
 *
 * A listener alone misses this event: the app was started by that press, so it happened before the
 * listener was attached.
 */
export async function readInitialPushResponse(): Promise<unknown | null> {
	const response = await Notifications.getLastNotificationResponseAsync();
	return response?.notification.request.content.data ?? null;
}

/**
 * Opens this app's system settings.
 *
 * This is the only thing the user can do once permission is refused and the OS no longer shows the
 * dialog. The reason permission is not requested repeatedly in that state is this: the call does
 * nothing, and the screen would be left with a button that responds to presses but does nothing.
 */
export async function openPushSystemSettings(): Promise<void> {
	await Linking.openSettings();
}
