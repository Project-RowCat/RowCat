import { AUTHORING_SCHEMA_VERSION } from "@rowcat/authoring";
import { CHAT_MESSAGE_PAGE_SIZE } from "@rowcat/chat";
import { API_BASE_PATH, SYNC_PROTOCOL_VERSION } from "@rowcat/contracts";
import { APP_BUNDLE_ID } from "@rowcat/domain";
import { VIEWER_QUERY_KEY } from "@rowcat/query";
import { DEVELOPMENT_API_ORIGIN } from "@rowcat/sdk";
import { AEAD } from "@rowcat/sync";

/**
 * Shared-package load probe. The point of this file is the imports themselves, not the values.
 *
 * The mobile foundation has to prove that the seven shared packages are actually bundled and
 * evaluated by Metro/Hermes. Type checking cannot show that: DOM globals touched at module top
 * level, Node built-in imports, and `exports` maps Metro cannot read only surface at runtime.
 * Reading one value from each package makes that failure visible on the diagnostic screen, and
 * bundling (`expo export`) catches resolution failures earlier.
 *
 * So the values here must be light constants. Creating a client or opening a database would tie
 * this probe to those side effects, and a failure would no longer say what broke.
 *
 * This summary is the only thing the diagnostic screen draws. Member ids, file names, DEKs and
 * recovery material never enter it (#85, #99, #100).
 */
export interface SharedPackageProbe {
	name: string;
	detail: string;
}

export const sharedPackageProbes = (): SharedPackageProbe[] => [
	{ name: "@rowcat/contracts", detail: `base ${API_BASE_PATH}` },
	{ name: "@rowcat/domain", detail: APP_BUNDLE_ID },
	{ name: "@rowcat/sdk", detail: `dev ${DEVELOPMENT_API_ORIGIN}` },
	{ name: "@rowcat/query", detail: `key ${VIEWER_QUERY_KEY.join("/")}` },
	{ name: "@rowcat/chat", detail: `page ${CHAT_MESSAGE_PAGE_SIZE}` },
	{ name: "@rowcat/authoring", detail: `schema v${AUTHORING_SCHEMA_VERSION}` },
	{
		name: "@rowcat/sync",
		detail: `protocol v${SYNC_PROTOCOL_VERSION} · AES-${AEAD.keyBytes * 8}-GCM`,
	},
];
