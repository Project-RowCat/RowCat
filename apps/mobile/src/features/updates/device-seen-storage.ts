import { deviceValueStorage } from "../../lib/device-storage.ts";
import { UPDATE_NOTE_SEEN_KEY } from "./seen-store.ts";

/**
 * The native wiring of the seen fact: one entry in the device key-value store.
 *
 * All rules live in `seen-store.ts`; this file only decides which key is used. It is separate for
 * the same reason as `appearance/sqlite-storage.ts`: importing the native module makes this file
 * unloadable under Node, so the code that tests cannot reach stays minimal.
 */
export const expoUpdateNoteSeenStorage =
	deviceValueStorage(UPDATE_NOTE_SEEN_KEY);
