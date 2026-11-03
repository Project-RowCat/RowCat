import { deviceValueStorage } from "../device-storage.ts";
import { LOCALE_PREFERENCE_KEY } from "./preference.ts";

/** The device key-value file (`rowcat_device.db`), the same one the appearance preference uses. */
export const expoLocaleStorage = deviceValueStorage(LOCALE_PREFERENCE_KEY);
