import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { PersonaLibrarySection } from "../persona/persona-library-section.tsx";
import { SettingsCategoryBody } from "./settings-parts.tsx";

/**
 * Personas: the library of saved **roles that are yours**.
 *
 * This screen sits under settings because of what the data is. The library is an **account asset**,
 * not a child of any conversation (`persona.ts` in `@rowcat/chat`). So it takes no room id and does
 * not go through a path such as `/chat/:roomId/settings`.
 *
 * **The picker in room settings stays.** That picker decides *which copy gets pinned to this
 * conversation*, while this screen decides **the list itself**. Both read the same store and answer
 * different questions.
 *
 * The content belongs to the feature folder (`features/persona/`). Settings only assembles it
 * inside its own shell. The folder lives outside the conversation folder, as of this slice's first
 * commit.
 */
export function SettingsPersonaScreen() {
	return (
		/** Entry animation wraps only the category body (same place as in `settings-general-screen.tsx`). */
		<PageEnter>
			<SettingsCategoryBody category="persona">
				<PersonaLibrarySection />
			</SettingsCategoryBody>
		</PageEnter>
	);
}
