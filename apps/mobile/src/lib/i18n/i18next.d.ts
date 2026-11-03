import "i18next";
import type { en } from "./messages/en/index.ts";

/**
 * Types every `t()` call against the English source, so a key that does not exist fails tsc
 * instead of rendering the key itself. Korean is checked separately (`Messages`).
 */
declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "common";
		resources: typeof en;
	}
}
