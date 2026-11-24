import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { ToolLibrarySection } from "../tools/tool-library-section.tsx";
import { SettingsCategoryBody } from "./settings-parts.tsx";

/**
 * Tools: the library of chat tools **you wrote**, the persona screen's shape
 * (`settings-persona-screen.tsx`) for its reason. The library is an account asset, not a child of
 * any conversation (`user-tool.ts` in `@rowcat/chat`), so this screen takes no room id.
 *
 * **The room's tools pane stays.** It decides which of these tools are on in one conversation;
 * this screen decides the list itself and each tool's default. Both read the same store.
 *
 * The content belongs to the feature folder (`features/tools/`); settings only assembles it inside
 * its shell.
 */
export function SettingsToolsScreen() {
	return (
		<PageEnter>
			<SettingsCategoryBody category="tools">
				<ToolLibrarySection />
			</SettingsCategoryBody>
		</PageEnter>
	);
}
