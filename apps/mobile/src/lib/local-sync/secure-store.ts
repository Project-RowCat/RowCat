import * as SecureStore from "expo-secure-store";
import type { SecureKeyStorage } from "./device-key.ts";

/**
 * Native implementation of `SecureKeyStorage` (iOS Keychain / Android Keystore).
 *
 * It lives in its own file because importing `expo-secure-store` makes the module unloadable under
 * Node. The rules (per-member key names, encoding, length checks) stay in `device-key.ts`; this
 * file is only three lines of wiring, which keeps the untested surface minimal.
 *
 * `requireAuthentication` is deliberately off. With it on, biometrics would prompt on every read,
 * and sync runs quietly whenever the app comes to the foreground, so the prompt would become a
 * constant chore. Device lock (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) is the protection instead: the key
 * is unreadable on a locked device and does not migrate to another device by backup (a backed-up
 * key would make that device a trusted one we never trusted).
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecureKeyStorage: SecureKeyStorage = {
	get: (key) => SecureStore.getItemAsync(key, OPTIONS),
	set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
	remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
