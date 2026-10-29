import { authoringSyncCodecs } from "@rowcat/authoring";
import { chatSyncCodecs } from "@rowcat/chat";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import { type AnySyncCodec, createCodecRegistry } from "@rowcat/sync";

/**
 * Codec assembly point. Same file, **same array and same order** as the web.
 *
 * Neither @rowcat/chat nor @rowcat/authoring imports @rowcat/sync. They export plain objects, and
 * whether those objects really are codecs is checked by the **type assignment** on the line below.
 *
 * It is the point of this file that mobile does not have its own codecs. A copy such as
 * `chat-mobile` here would make the two platforms encode the same record differently, and that
 * mismatch shows up not as a compile error but as **one field going blank on another device**.
 *
 * Order is **part of the protocol**. Outbound collection follows this order so parents go out
 * before children (room → message, draft → children). A receiving device does not depend on the
 * order, but when the order is right, there is no window in which a "child without parent" briefly
 * exists.
 */
const codecs: readonly AnySyncCodec[] = [
	...chatSyncCodecs,
	...authoringSyncCodecs,
	/** Player saves — must be in the **same position and order** as the web's same array. */
	...runtimePersistenceSyncCodecs,
];

export const syncCodecRegistry = createCodecRegistry(codecs);
