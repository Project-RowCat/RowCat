import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { GuardianConsentPage } from "#/features/onboarding/guardian-consent-page.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Guardian consent page at `/guardian/$token`, outside the `(app)` group.
 *
 * The visitor is not a member: there is no session or account, only the link the minor sent. Inside
 * the app group, the sidebar entries `Discover`, `Conversations` and `Create` would lead nowhere for them, and the
 * entry gate would stand in front of this screen. Opened in a browser logged in as someone else,
 * that person's own entry gate could appear.
 *
 * There is no loader or guard, since relying on a session would make the page unavailable to
 * logged-out guardians. The token is not prefetched in the loader either: it is a bearer
 * credential, and SSR state would carry it into HTML that intermediate caches might keep. The
 * screen queries it directly and shows the exact message for each error code.
 *
 * Not indexed, since the address holds a one-time token.
 */
export const Route = createFileRoute("/guardian/$token")({
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.guardian", { app: APP_NAME }) },
			{ name: "robots", content: "noindex, nofollow" },
			/**
			 * Sends only the origin in the referrer, never the path. The guardian page address contains the
			 * consent token, and if the path reached the identity verification provider's logs, the token
			 * would leak.
			 *
			 * `no-referrer` looks stronger, but it removes the Referer header entirely. Some verification
			 * channels check that header to validate the request origin, so the flow would stop working.
			 * Cross-origin requests therefore carry the origin only; the provider already has that origin
			 * registered.
			 */
			{ name: "referrer", content: "strict-origin-when-cross-origin" },
		],
	}),
	component: GuardianRoute,
});

function GuardianRoute() {
	const { token } = Route.useParams();
	return <GuardianConsentPage token={token} />;
}
