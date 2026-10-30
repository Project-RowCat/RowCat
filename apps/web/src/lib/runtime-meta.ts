/**
 * Deployment values the server hands the browser through `<meta>` tags in the document head.
 *
 * They exist so one image can run any deployment: the server reads its environment at runtime and
 * writes the value here, and the browser reads it back instead of carrying a build-time copy. Only
 * public values belong here — everything in the document is readable by anyone who loads a page.
 *
 * The names are the one contract between `routes/__root.tsx` (writes) and the modules that read; a
 * tag the server did not write is `undefined`, never an empty string.
 */
export const API_ORIGIN_META = "rowcat-api-origin";
export const ADMIN_ORIGIN_META = "rowcat-admin-origin";

export function runtimeMeta(name: string): string | undefined {
	if (typeof document === "undefined") return undefined;
	return (
		document
			.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
			?.content.trim() || undefined
	);
}
