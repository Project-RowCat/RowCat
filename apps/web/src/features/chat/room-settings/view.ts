import { translator } from "#/lib/i18n/current.ts";
/**
 * The surface currently shown inside the settings dialog. This is UI state only and is never
 * persisted. It is not stored in the URL (`?settings=generation`), because room settings are not a
 * route: the dialog opens for rooms that are not the one currently open (for example, rows in the
 * sidebar's recent conversations), and the URL would still point at another conversation. It is
 * also not stored elsewhere, since it records where the user currently is, not a value the user
 * chose.
 *
 * So the dialog always opens on home. If the last surface were remembered, someone who changed a
 * model once would land on generation every time and never see what else is available.
 */
export type RoomSettingsView =
	| "home"
	| "generation"
	| "persona"
	| "narration"
	| "intensity"
	| "characters"
	| "userNote"
	| "info";

/** Title for each surface. The dialog header renders these directly. */
export const roomSettingsViewTitle = (key: RoomSettingsView): string =>
	translator("chat")(`roomSettings.title.${key}`);

/**
 * Accessible name for the back control. It is not an arrow alone: an unnamed icon button is
 * announced as just 'button', and this dialog already has another icon button (close), so the two
 * would be indistinguishable.
 */
export const roomSettingsBackLabel = (): string =>
	translator("chat")("roomSettings.back", {
		title: roomSettingsViewTitle("home"),
	});
