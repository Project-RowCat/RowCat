import { deviceValueStorage } from "../device-storage.ts";
import { APPEARANCE_PREFERENCE_KEY } from "./preference.ts";

/**
 * Native wiring for the device appearance preference.
 *
 * The rules all live on the port (`preference.ts`), and the medium is the device key-value store
 * (`lib/device-storage.ts`, which holds the file name, the synchronous read and the failure
 * folding). What remains here is one thing: **which key**.
 *
 * This file exists separately for the same reason as `expo-driver.ts` and `secure-store.ts`:
 * importing a native module means that module cannot be opened under Node. Keeping rules apart from
 * wiring minimizes the code that tests cannot reach.
 */
export const expoAppearanceStorage = deviceValueStorage(
	APPEARANCE_PREFERENCE_KEY,
);
