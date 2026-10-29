import { DiscoverScreen } from "../features/discover/discover-screen.tsx";

/**
 * First screen: discovery. It used to be a diagnostic screen switching on `useMobileAppPhase()`,
 * which tied reading public works to Better Auth and SQLite. The route file is only a route; the
 * screen belongs to the feature. Guests are not bounced to login: signing in is user-initiated and
 * public browsing is a legitimate product state.
 */
export default function Index() {
	return <DiscoverScreen />;
}
