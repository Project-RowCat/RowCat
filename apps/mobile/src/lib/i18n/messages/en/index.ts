import { common } from "./common.ts";
import { discover } from "./discover.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { signIn } from "./sign-in.ts";
import { story } from "./story.ts";
import { vocab } from "./vocab.ts";

/**
 * The source dictionary. One namespace per feature area, named after it, so a screen's copy is
 * found near its code and two features never fight over one key.
 *
 * Adding a namespace means adding it here and in `../ko/index.ts`; the `Messages` type makes a
 * missing Korean namespace a compile error.
 */
export const en = {
	common,
	shell,
	signIn,
	settings,
	vocab,
	discover,
	story,
};
