import {
	RUNTIME_PROJECT_LIMITS,
	RUNTIME_SOURCE_EXTENSIONS,
	type RuntimePathIssueCode,
} from "@rowcat/authoring";
import { translator } from "#/lib/i18n/current.ts";
import { formatNumber } from "#/lib/i18n/format.ts";

/**
 * The sentence for a path or asset-name rejection, in the render's locale.
 *
 * `@rowcat/authoring` decides (its checks return a code and the limit that was crossed is one of
 * its constants); this names. Only two codes read differently for files and for bound assets, so
 * only those take the subject.
 */
export function runtimePathIssueMessage(
	code: RuntimePathIssueCode,
	subject: "file" | "asset",
): string {
	const t = translator("runtimeStudio");
	switch (code) {
		case "empty":
			return t("pathIssue.empty");
		case "traversal":
			return t("pathIssue.traversal");
		case "invalid_character":
			return t("pathIssue.invalid_character");
		case "too_long":
			return t("pathIssue.too_long", { max: RUNTIME_PROJECT_LIMITS.path });
		case "segment_too_long":
			return t("pathIssue.segment_too_long", {
				max: RUNTIME_PROJECT_LIMITS.segment,
			});
		case "too_deep":
			return t("pathIssue.too_deep", { max: RUNTIME_PROJECT_LIMITS.depth - 1 });
		case "unsupported_extension":
			return t("pathIssue.unsupported_extension", {
				extensions: RUNTIME_SOURCE_EXTENSIONS.join(" · "),
			});
		case "content_too_long":
			return t("pathIssue.content_too_long", {
				max: formatNumber(RUNTIME_PROJECT_LIMITS.content),
			});
		case "too_many":
			return subject === "file"
				? t("pathIssue.file.too_many", { max: RUNTIME_PROJECT_LIMITS.files })
				: t("pathIssue.asset.too_many", { max: RUNTIME_PROJECT_LIMITS.assets });
		case "duplicate":
			return subject === "file"
				? t("pathIssue.file.duplicate")
				: t("pathIssue.asset.duplicate");
	}
}
