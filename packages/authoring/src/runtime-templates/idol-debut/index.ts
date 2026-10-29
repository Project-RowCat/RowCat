import type { RuntimeTemplate } from "../types.ts";
import { COMPONENT_FILES } from "./files-components.ts";
import { CORE_FILES } from "./files-core.ts";
import { SCREEN_FILES } from "./files-screens.ts";
import { STORY_FILES } from "./files-story.ts";
import { SYSTEM_FILES } from "./files-systems.ts";

/**
 * Flagship: eight weeks to the debut evaluation. The other four templates each teach one technique;
 * this one uses them together: weekly settlement, stats and trust, event branching, free-text
 * conversation, endings, and a record that persists across runs.
 * - useState: open tabs, input, pending state. Lost on restart.
 * - useStoryState: this group's week, stats, condition, and trust. Starts over on restart.
 * - usePersistentState: what was learned about the members, endings seen, best score. Kept across
 *   resets. The third has no stats by design. A new group starts at zero and only learned
 *   information carries over. Without that asymmetry the work becomes a stat-counting growth game.
 *   Learned information unlocks events and `requires.note` choice locks (choiceAvailable in
 *   systems/progression.ts). No assets: faces are initials, depth is overlapping bordered planes,
 *   and scenes change by transition. Bars use a grow ratio, not width percent, because transitions
 *   do not manage the layout axis. A seam marks where MemberAvatar's circle becomes an image once
 *   an asset host exists. Presentation rules (body width cap, own button, size ladder) were chosen
 *   in a browser. The reasons are in app-shell.tsx, action-button.tsx, and theme.ts. Member colors
 *   are kept apart from semantic colors (see TINT in theme.ts). The evening entry is one input
 *   line. Code decides what a message touched (matchTopic in systems/topics.ts). That judgment uses
 *   the user's input and runs before generation, so learned information survives a provider
 *   rejection, and the story still progresses in preview with AI off. The model only voices facts
 *   already decided. Settlement has no randomness, so the preview score matches the actual result.
 *   The source is a copy of one folder; the files-*.ts files hold the 42 src/** files. It is copied
 *   at creation and has no link afterward.
 */
export const IDOL_DEBUT_TEMPLATE: RuntimeTemplate = {
	id: "idol-debut",
	name: "Eight Weeks to Debut",
	/**
	 * Kept short on purpose. The card and the detail view render this value, and long text pushes
	 * neighboring templates out of the row. The rest is listed in `demonstrates`.
	 */
	description:
		"Eight weeks until the debut evaluation. As the manager of five trainees, you plan each week and stay behind with one of them every evening to talk in your own words. What you say decides what you learn, and what you learn stays with the next debut group too.",
	category: "story",
	complexity: "advanced",
	featured: true,
	demonstrates: [
		"Evenings where your own words decide what you learn",
		"Pure rules that judge the player's sentence by its words",
		"Putting an opened story into the instructions so the character answers in their own voice",
		"Deterministic weekly rules that settle the three slots you plan",
		"Five members' vocal, dance and expression, with condition and trust",
		"Weekly events that branch on choices, and two midpoint reviews",
		"Eight weeks in useStoryState and lasting stories in usePersistentState",
		"Four endings decided by a single resolveEnding",
		"A screen whose transitions say the scene changed",
	],
	entry: "src/main.tsx",
	files: [
		...CORE_FILES,
		...SYSTEM_FILES,
		...STORY_FILES,
		...COMPONENT_FILES,
		...SCREEN_FILES,
	],
};
