import { translator } from "../../lib/i18n/instance.ts";
import { PERSONA_COPY } from "./persona-form.ts";

/**
 * The library's row names and the delete confirmation. The fixed words are `PERSONA_COPY`; these
 * two carry the persona's name.
 */
export const personaRowActionsLabel = (
	name: string,
	action: "edit" | "delete",
): string => translator("persona")(action, { name });

export const personaDeleteDescription = (name: string): string =>
	`${translator("persona")("deleteDescription", { name })} ${PERSONA_COPY.deleteNotice}`;
