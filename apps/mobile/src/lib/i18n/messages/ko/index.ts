import type { Messages } from "../../types.ts";
import { common } from "./common.ts";
import { discover } from "./discover.ts";
import { moderation } from "./moderation.ts";
import { notifications } from "./notifications.ts";
import { persona } from "./persona.ts";
import { profile } from "./profile.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { signIn } from "./sign-in.ts";
import { story } from "./story.ts";
import { updates } from "./updates.ts";
import { vocab } from "./vocab.ts";

export const ko: Messages = {
	common,
	shell,
	signIn,
	settings,
	vocab,
	discover,
	story,
	moderation,
	persona,
	profile,
	notifications,
	updates,
};
