import {
	type DraftRuntimeAsset,
	planRuntimeAssetBinding,
	type RuntimePathCheck,
} from "@rowcat/authoring";
import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";
import { translator } from "#/lib/i18n/current.ts";
import { runtimePathIssueMessage } from "../path-issue-copy.ts";

/**
 * Logical names for managed images: the judgment, and the rule that derives a name from a file
 * name.
 * - Syntax comes from `classifyRuntimeAssetValue` in @rowcat/runtime, the language contract and
 *   its authority.
 * - Duplicates and counts come from `planRuntimeAssetBinding` in @rowcat/authoring. That package
 *   does not import the language contract (layering rule), so this module joins the two at the
 *   assembly point, the same way the publish assembler takes `apiVersion` as an argument.
 * - Wording belongs to this screen.
 *
 * Syntax is not restated here. Names creators can write in code and names this screen accepts must
 * be identical, or a stale copy would reject names that work. The server's publish check passes
 * through the same function, so all three are one judgment.
 */

/**
 * The name for the fact that a value is not a logical name. It is kept separate from the
 * authoring-side codes (`RuntimePathIssueCode`).
 */
const invalidShape = (): string =>
	translator("runtimeStudio")("assetName.invalidShape");

/**
 * Whether a name is usable now. Checks run in order: syntax first, then duplicates and count.
 *
 * The order matters. A value with bad syntax has no meaning against any list. Comparing duplicates
 * on a string that has not been canonicalized would let `characters/a` and `Characters/a` pass as
 * different names. The language contract is case-sensitive, so they really are different names, and
 * this function does not reverse that.
 *
 * `excludeId` identifies the asset being renamed. If it counted itself as a duplicate, the common
 * edit of changing only the case would be impossible. File renaming has the same exception.
 */
export function planRuntimeAssetName(
	assets: readonly DraftRuntimeAsset[],
	input: string,
	options: { excludeId?: string } = {},
): RuntimePathCheck {
	const target = classifyRuntimeAssetValue(input.trim());
	if (target === null || target.kind !== "logical")
		return { ok: false, code: "invalid_character", message: invalidShape() };
	const checked = planRuntimeAssetBinding(assets, target.path, options);
	return checked.ok
		? checked
		: { ...checked, message: runtimePathIssueMessage(checked.code, "asset") };
}

/**
 * The name suggested from a file name. It is a default the user can edit.
 *
 * For example, `sena-smile.png` becomes `images/sena-smile`, and a name written only in non-Latin letters
 * becomes `images/image` because no usable characters remain.
 *
 * The result is not silently altered. This function's answer is the initial value of the input
 * field, not the saved value. If the typed name were replaced by us (spaces to `-`, Hangul to
 * romanization), the creator would have to write a name in code they never typed, and the only
 * place they would notice is a screen where the picture does not appear. So the suggestion ends
 * here, and the judgment above checks the value exactly as typed.
 *
 * Placing names under `images/` is also only a suggestion. The language contract reserves no prefix
 * (see the asset.ts header), so this decides only the shape a first-time user sees.
 */
export function suggestRuntimeAssetName(fileName: string): string {
	const base = fileName
		.replace(/\.[^./\\]+$/, "")
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[^A-Za-z0-9]+/, "")
		.replace(/[-.]+$/, "");
	return `images/${base.length > 0 ? base : "image"}`;
}
