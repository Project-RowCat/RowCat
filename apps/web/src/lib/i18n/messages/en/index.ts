import { account } from "./account.ts";
import { auth } from "./auth.ts";
import { chat } from "./chat.ts";
import { chatLibrary } from "./chat-library.ts";
import { comments } from "./comments.ts";
import { common } from "./common.ts";
import { conversation } from "./conversation.ts";
import { create } from "./create.ts";
import { docs } from "./docs.ts";
import { gallery } from "./gallery.ts";
import { generation } from "./generation.ts";
import { moderation } from "./moderation.ts";
import { notifications } from "./notifications.ts";
import { onboarding } from "./onboarding.ts";
import { persona } from "./persona.ts";
import { playtest } from "./playtest.ts";
import { profile } from "./profile.ts";
import { runtimePlayer } from "./runtime-player.ts";
import { runtimePreview } from "./runtime-preview.ts";
import { runtimeStudio } from "./runtime-studio.ts";
import { runtimeTemplates } from "./runtime-templates.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { social } from "./social.ts";
import { story } from "./story.ts";
import { sync } from "./sync.ts";
import { vocab } from "./vocab.ts";

/**
 * The source dictionary. One namespace per feature folder, named after it, so a screen's copy is
 * found where its code is and two features never fight over one key.
 *
 * Adding a namespace means adding it here and in `../ko/index.ts`; the `Messages` type makes a
 * missing Korean namespace a compile error.
 */
export const en = {
	common,
	sync,
	social,
	profile,
	generation,
	conversation,
	persona,
	chatLibrary,
	auth,
	moderation,
	onboarding,
	notifications,
	vocab,
	gallery,
	shell,
	docs,
	story,
	comments,
	account,
	create,
	chat,
	settings,
	playtest,
	runtimeStudio,
	runtimeTemplates,
	runtimePreview,
	runtimePlayer,
};
