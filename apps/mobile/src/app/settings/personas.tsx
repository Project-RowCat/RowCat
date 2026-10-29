import { SettingsPersonaScreen } from "../../features/settings/settings-persona-screen.tsx";

/**
 * Persona library: the address takes no room id, and that absence is the point. The library is an
 * account asset, not a child of a room (`persona.ts` in `@rowcat/chat`), and is the same list from
 * any room; a parameter would invite narrowing it to "roles used in this room", the first step
 * toward hanging the library on the room.
 *
 * The address is plural `personas` as on web; no per-role address exists (editing is a window in
 * this screen).
 */
export default function SettingsPersonasRoute() {
	return <SettingsPersonaScreen />;
}
