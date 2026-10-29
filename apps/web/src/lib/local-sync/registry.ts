import { authoringSyncCodecs } from "@rowcat/authoring";
import { chatSyncCodecs } from "@rowcat/chat";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import type { AnySyncCodec } from "@rowcat/sync";
import { createCodecRegistry } from "@rowcat/sync";

/**
 * Codec assembly point. This is the reclaim point of 'option B'.
 *
 * @rowcat/chat and @rowcat/authoring do not import @rowcat/sync. They export plain objects, and
 * whether an object is really a codec is checked by the one type assignment below: if it does not
 * fit AnySyncCodec[], compilation fails here.
 *
 * So a domain can add a field without touching the protocol package, and a new domain adds one line
 * to this array. The reverse arrangement (sync importing the domains) would make the protocol
 * package a hub that knows every domain.
 *
 * Order is part of the protocol. Outbound collection follows it, so parents go out before children
 * (room before messages, draft before its children). The receiving device does not depend on order,
 * since a child without its parent is still stored. But when the order is right, the window in
 * which a child exists without its parent never opens.
 */
const codecs: readonly AnySyncCodec[] = [
	...chatSyncCodecs,
	...authoringSyncCodecs,
	/**
	 * Player saves have no parent. Unlike the first two groups, which are the member's authored
	 * manuscripts, these are the member's play progress, which can also arise for works by other
	 * people. So they are not children of drafts. The only thing that matters about their order is
	 * that they come last. chat.persona sits in the same position.
	 */
	...runtimePersistenceSyncCodecs,
];

export const syncCodecRegistry = createCodecRegistry(codecs);
