import { markdownUrlTransform, schemeOf } from "@rowcat/markdown";

/**
 * Address policy for documents the repo owns: the shared policy plus internal destinations.
 *
 * The axis is not which screen renders the text but who wrote it. The @rowcat/markdown policy is
 * for others' text (a creator's work, a model's reply). Refusing rootless paths there is correct:
 * text from others that points at our screens reads as a lure, not a link. The public runtime docs
 * are markdown in docs/**, and pointing at other docs and product screens is what those documents
 * do.
 *
 * Without this gate no link goes anywhere. react-markdown rewrites address attributes before it
 * calls the component, so under the shared policy, /docs/runtime/..., /settings/ai and #section
 * all reach the component with an empty href. The routed branch then becomes unreachable. Links
 * still render and can be clicked; clicking reloads the current page with no error. Two doc sites
 * were in exactly that state.
 *
 * Only internal destinations are widened. Addresses with a scheme return exactly what the shared
 * function returns. Images (src) do not pass this gate: owning the document is not grounds to
 * accept javascript: or data:, and two layers giving the same answer is itself the defense.
 *
 * Internal paths are not narrowed to a prefix list. An address missing from such a list would
 * silently become a dead link, the same shape as the failure being fixed. Each document's own tests
 * verify that the destinations exist.
 */

/** Characters that browsers strip from URL attribute values. Same trimming as the shared policy. */
const STRIPPED = /[\t\n\r]/g;

/**
 * Checks only two shapes, and only when there is no scheme. schemeOf trims the same way a browser
 * does before it reads the scheme, so a tab inserted inside a scheme (java<tab>script:) is not
 * mistaken for a relative path. Re-writing that judgment by hand would turn the check into an
 * invitation to bypass it.
 */
export function ownedDocumentUrlTransform(url: string, key: string): string {
	if (key === "href" && schemeOf(url) === null) {
		const value = url.replace(STRIPPED, "").trim();
		/** Same-document anchor. A lone # points to no section, so it is not accepted. */
		if (value.startsWith("#") && value.length > 1) return value;
		/**
		 * Same-origin absolute path. //example.com has no scheme but is still external, so it must be
		 * filtered here. Checking only the first character would let it through.
		 */
		if (value.startsWith("/") && !value.startsWith("//")) return value;
	}
	return markdownUrlTransform(url, key);
}
