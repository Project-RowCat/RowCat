/**
 * Copy for the docs screen. The document body is not here (it lives in `docs/public/runtime`). Only
 * the shell's words are here: the navigation label, previous and next, and the narrow-screen
 * trigger.
 */

import { APP_NAME } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * A function, not a constant: the words follow the request's language (`docs` dictionary).
 *
 * - `title`: name of the whole docs section. The tab title, navigation heading and breadcrumb all
 *   use this same word.
 * - `product`: tab title suffix, e.g. `Quick start | Creator runtime | RowCat`.
 * - `entry`: label of the link from the authoring surfaces to the docs (`runtime-docs-entry.tsx`).
 * - `previewGuide`: the doc the preview's empty state points to: what run, reset and the AI toggle
 *   each do.
 */
export function runtimeDocsCopy() {
	const t = translator("docs");
	return {
		title: t("title"),
		product: APP_NAME,
		navLabel: t("navLabel"),
		openNav: t("openNav"),
		pagerLabel: t("pagerLabel"),
		previous: t("previous"),
		next: t("next"),
		codeBlock: t("codeBlock"),
		entry: t("entry"),
		previewGuide: t("previewGuide"),
	};
}
