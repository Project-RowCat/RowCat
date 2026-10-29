import { useEffect, useState } from "react";
import { readAuthCookie } from "./auth.ts";
import { API_ORIGIN } from "./env.ts";
import { useMobileIdentity } from "./identity.tsx";

/**
 * Request headers for images that need a session — **`Image` does not go through the SDK's
 * transport.**
 *
 * This app's authentication attaches a `Cookie` header to each request (`auth-fetch.ts`). There is
 * no place where the transport attaches cookies automatically, as a browser would. But `<Image
 * source={{ uri }}>` does not use that `fetch`: the **native image loader** makes its own request,
 * so that request always goes out as a guest.
 *
 * ⚠️ The defect caused by that mismatch is silent and concrete. Cover reads use the **same
 * predicate** as the story detail (`routes/stories/cover.ts`), so covers that are visible only with
 * a session — the owner's own **private**, archived and operator-hidden works — all become 404 in
 * the app and collapse to the placeholder. The web draws that picture on the same screen:
 *
 * ```text
 * web   GET /v2/stories/<private work>/cover   200   the cookie attaches automatically
 * app   GET /v2/stories/<private work>/cover   404   the picture loader carries no cookie
 * ```
 *
 * So the symptom reads as "the cover was never uploaded". In fact it is there, and the discovery
 * grid, the story detail and the `Published` tab are **all wrong at once**. Reading the source alone
 * does not catch it (`coverUrl` is the same value on both sides); two screens placed side by side
 * reveal it.
 *
 * ## The cookie is attached only to our origin
 *
 * This header is the session itself. Attached to an arbitrary address, a picture would become a
 * channel carrying the session to a foreign host. `StoryCover` also draws a just-picked local file
 * (`file://`), so that case really exists. The decision is **one origin**: an address that is not
 * ours gets no header (the picture still loads — a public cover needs no session).
 *
 * ## Re-read when identity changes
 *
 * Reading once would leave a screen that mounted **after** sign-in holding the guest header, and
 * across an account switch it would hold the previous person's cookie. So the viewer id is a
 * dependency.
 */
export interface AuthImageCredentials {
	/**
	 * Whether the header is **settled**. The signed-in viewer's cookie comes from SecureStore, so it
	 * is not there yet on the first render.
	 *
	 * ⚠️ Without this axis the fix does not take. `Image` remembers a failed address (`onError` →
	 * `failedUri`) and afterwards draws only the placeholder. If a request goes out **before** the
	 * header arrives, that request is exactly today's 404, and when the cookie arrives later the
	 * picture never comes back. So consumers must **not create the request** until this value is true.
	 */
	ready: boolean;
	headers?: Record<string, string>;
}

export function useAuthImageHeaders(): AuthImageCredentials {
	const { session } = useMobileIdentity();
	const viewerId = session.viewer?.id ?? null;
	const [cookie, setCookie] = useState<string | null>(null);
	const [resolvedFor, setResolvedFor] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		if (!viewerId) {
			setCookie(null);
			setResolvedFor(null);
			return;
		}
		readAuthCookie().then((value) => {
			if (!alive) return;
			setCookie(value);
			setResolvedFor(viewerId);
		});
		return () => {
			alive = false;
		};
	}, [viewerId]);

	/**
	 * **`booting` is not a guest.** Answering "no cookie" before identity is settled would let a
	 * picture mounted in that gap go out with no header once, and that 404 would stick. That is
	 * exactly the path by which a private cover stays a placeholder on the first screen on every cold
	 * start. `unavailable` is the same: we are asking again, not signed out.
	 */
	if (session.phase === "booting" || session.phase === "unavailable")
		return { ready: false };
	/** A guest has nothing to wait for — public covers load without a session. */
	if (!viewerId) return { ready: true };
	if (resolvedFor !== viewerId) return { ready: false };
	return { ready: true, headers: cookie ? { Cookie: cookie } : undefined };
}

/** Whether this address is our API — the only destination a session header may be sent to. */
export function isApiOrigin(uri: string): boolean {
	return uri.startsWith(`${API_ORIGIN}/`);
}
