import { RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH } from "@rowcat/runtime/asset";
import { describe, expect, test } from "vitest";
import { RUNTIME_DOC_BODIES } from "#/generated/runtime-docs-content.ts";

/**
 * The public docs state a remote image URL length limit; it must match the actual constant.
 *
 * This is the same axis as the generation-limit test (`runtime-docs-generation-limits.test.ts`). If
 * the number lives in both code and docs, one can change alone, and the mismatch first appears to a
 * creator with a long signed URL. The constant's only source is `asset.ts` in `@rowcat/runtime`
 * (the server proxy judges with the same function). The docs write the number as `N자` (N
 * characters).
 */

const REQUIRED_PAGES = ["concepts/assets", "reference/assets"];
const URL_LIMIT =
	/주소[^\n|]*?(\d{1,3}(?:,\d{3})*)자|최대 (\d{1,3}(?:,\d{3})*)자\s*\|/g;

const bodyOf = (slug: string): string => {
	const body = RUNTIME_DOC_BODIES[slug];
	if (body === undefined) throw new Error(`no ${slug} page`);
	return body;
};

const formatted = RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH.toLocaleString("en-US");

describe("remote image address cap: the docs' number equals the constant", () => {
	test.each(REQUIRED_PAGES)("%s states the cap", (slug) => {
		expect(bodyOf(slug)).toContain(`${formatted}자`);
	});

	test.each(
		Object.keys(RUNTIME_DOC_BODIES),
	)("every remote address cap in %s equals the constant", (slug) => {
		for (const match of bodyOf(slug).matchAll(URL_LIMIT)) {
			const value = Number((match[1] ?? match[2] ?? "").replace(/,/g, ""));
			/**
			 * The 200-character limit for logical paths and the 200-character limit for project paths are
			 * separate axes, so that number is skipped.
			 */
			if (value === 200) continue;
			if (Number.isNaN(value) || value < 1_000) continue;
			expect(value, `${slug}: ${match[0]}`).toBe(
				RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH,
			);
		}
	});
});
