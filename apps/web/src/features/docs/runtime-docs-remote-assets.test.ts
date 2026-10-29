import { describe, expect, test } from "vitest";
import { RUNTIME_DOC_BODIES } from "#/generated/runtime-docs-content.ts";

/**
 * Public docs state two facts about remote images, and they must state them exactly.
 *
 *   static declaration  only addresses written in the source become real requests; assembled
 *                       URLs are placeholders
 *   privacy             the player's connection info is hidden, but NOT anonymized
 *
 * The second is why this file exists. The docs once said `플레이어의 IP 주소나 접속 시각이 당신의 서버에 남지 않습니다` (the
 * player's IP and access time are not kept on your server). The second half was false: when RowCat
 * fetches on the creator's behalf, the creator's server still sees the request and its time.
 * Promising stronger privacy than the reality puts people who rely on it at risk; the block message
 * already made the same judgment.
 */

const bodyOf = (slug: string): string => {
	const body = RUNTIME_DOC_BODIES[slug];
	if (body === undefined) throw new Error(`no ${slug} page`);
	return body;
};

const ASSET_PAGES = ["concepts/assets", "reference/assets"];

describe("remote images are statically declared assets", () => {
	test("the assets concept doc states the rule", () => {
		const body = bodyOf("concepts/assets");
		expect(body).toContain("프로젝트에 고정된 자산");
		/** A valid and an invalid example must both be present for the rule to be readable. */
		expect(body).toMatch(/asset\("https:\/\/cdn\.example\.com\/[^"]+"\)/);
		expect(body).toMatch(/asset\(`https:\/\/[^`]*\$\{/);
	});

	test("the reference rules table has the declaration axis", () => {
		expect(bodyOf("reference/assets")).toContain("소스에 그대로 적힌 주소만");
	});

	test("the unsupported list mentions assembled addresses", () => {
		expect(bodyOf("runtime-model/unsupported-apis")).toContain(
			"실행 중에 만든 원격 이미지 주소",
		);
	});

	test("the security doc states why", () => {
		expect(bodyOf("runtime-model/security")).toContain("프로젝트에 고정");
	});
});

describe("the privacy wording is no stronger than reality", () => {
	/**
	 * The test forbids a claim, not a particular sentence. The pattern matches only sentences saying
	 * that access time is not kept. The current docs say the opposite (`볼 수 있습니다`, can see).
	 */
	test.each(
		Object.keys(RUNTIME_DOC_BODIES),
	)("%s does not claim access times are not left", (slug) => {
		expect(bodyOf(slug)).not.toMatch(
			/접속 시각[^\n]{0,40}(남지 않|전달되지 않|알 수 없)/,
		);
	});

	test.each(ASSET_PAGES)("%s states what the remote server sees", (slug) => {
		const body = bodyOf(slug);
		expect(body).toMatch(
			/RowCat[^\n]*요청[^\n]*시점|요청[^\n]*시점[^\n]*볼 수/,
		);
	});

	test("states what is hidden: the IP and User-Agent", () => {
		const body = bodyOf("concepts/assets");
		expect(body).toContain("IP 주소");
		expect(body).toContain("User-Agent");
	});

	test("the security doc states the same two facts", () => {
		const body = bodyOf("runtime-model/security");
		expect(body).toContain("User-Agent");
		expect(body).toMatch(/요청과 그 시점/);
	});
});

describe("the network capability boundary is unchanged", () => {
	test("states there is no arbitrary network API", () => {
		const body = bodyOf("runtime-model/security");
		expect(body).toContain("임의의 네트워크 API가");
		expect(body).toMatch(/fetch/);
	});

	test("published code is still not secret", () => {
		expect(bodyOf("runtime-model/security")).toContain(
			"비밀을 두는 곳이 아닙니다",
		);
		expect(bodyOf("concepts/assets")).toContain("비밀이 아닙니다");
	});

	/**
	 * Static addresses with a query string are still supported. What was narrowed is URL assembly, not
	 * queries.
	 */
	test("states static query addresses are still supported", () => {
		expect(bodyOf("concepts/assets")).toMatch(/\?width=800/);
	});
});

/**
 * The docs must state that RowCat images are not placeholders.
 *
 * What this group guards is an absence, not one sentence. The docs once called logical assets reserved and still placeholders. That sentence would not break compilation even
 * after the feature opened, so creators read a working feature as broken and went looking for an
 * external CDN.
 */
describe("RowCat images", () => {
	test("the old placeholder sentence is gone", () => {
		for (const slug of [
			"concepts/assets",
			"reference/assets",
			"reference/components",
			"reference",
			"runtime-model/unsupported-apis",
		]) {
			const body = bodyOf(slug);
			expect(body, slug).not.toContain("아직 자리표시자");
			expect(body, slug).not.toContain("예약되어");
			expect(body, slug).not.toContain("자산 호스트");
		}
	});

	test("the concept doc explains uploading and calling by name", () => {
		const body = bodyOf("concepts/assets");
		expect(body).toContain("RowCat 자산");
		expect(body).toMatch(/asset\("characters\/sena\/smile"\)/);
	});

	/**
	 * The docs must state that there is one name space. Pictures and sounds share the same syntax.
	 * Without this, creators would think a sound can take the same name as a picture, and that publish
	 * would be rejected.
	 */
	test("states images and sounds share one namespace", () => {
		const body = bodyOf("concepts/assets");
		expect(body).toContain("한 이름 공간");
		expect(body).toMatch(/asset\("audio\/bgm\/main"\)/);
	});

	/**
	 * The docs must state the accepted sound formats and size limits. Without them, creators learn by
	 * uploading and failing.
	 */
	test("states sound formats and caps", () => {
		const body = bodyOf("concepts/assets");
		expect(body).toContain("MP3");
		expect(body).toContain("M4A");
		expect(body).toMatch(/10분/);
	});

	/**
	 * The docs must state the asymmetry between the two kinds: names may be chosen at runtime,
	 * external addresses may not. If the docs do not say so, creators learn the wrong rule for one of
	 * the two.
	 */
	test("states names may be built at runtime", () => {
		expect(bodyOf("concepts/assets")).toContain("실행 중에 골라도 됩니다");
		expect(bodyOf("reference/assets")).toContain("실행 중에 만들어도 됩니다");
	});

	/**
	 * A name that does not exist is not an error. It is the normal state during authoring, and the
	 * docs must say it shows a placeholder.
	 */
	test("states a missing name is a placeholder", () => {
		expect(bodyOf("concepts/assets")).toContain("없는 이름은 자리표시자입니다");
	});

	/**
	 * Asset changes take effect only after republishing. This is the point creators most often
	 * misread.
	 */
	test("states changes apply only after republishing", () => {
		expect(bodyOf("concepts/assets")).toContain("다시 발행하기 전까지 그대로");
	});
});
