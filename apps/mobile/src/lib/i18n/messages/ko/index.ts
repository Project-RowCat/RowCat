import type { Messages } from "../../types.ts";
import { common } from "./common.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { signIn } from "./sign-in.ts";

export const ko: Messages = {
	common,
	shell,
	signIn,
	settings,
};
