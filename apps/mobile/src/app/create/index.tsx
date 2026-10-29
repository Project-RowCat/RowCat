import { CreateScreen } from "../../features/create/create-screen.tsx";

/**
 * Create: a real destination. The drawer's third item comes here, leaving the editor comes here,
 * and login returns here (`?redirect=/create`).
 *
 * The route file is only a route; queries, SQLite and publication order belong to the feature.
 * `?view=` is not read here: the parsing rule is a pure function (`create-view.ts`) the screen
 * calls, since this app's tests do not render React. Guests are not bounced to login; they first
 * read why they cannot create (same as `/chats` and `/account`).
 */
export default function CreateRoute() {
	return <CreateScreen />;
}
