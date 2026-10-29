import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks what this package must not reach.
 * - package.json dependencies cover only half of that (contracts and zod).
 * - The rest, relative paths and workspace aliases, is not enforced by declarations. The monorepo
 *   type resolver follows undeclared packages to their source, and such imports still compile.
 * - The risk grows with the observation layer. The shortest way to draw runtime events on the
 *   timeline is to import the snapshot types of @rowcat/runtime-host, which would make this package
 *   aware of a studio vocabulary that does not exist on mobile.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = () =>
	readdirSync(SRC)
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
		.map((name) => ({
			name,
			source: stripComments(readFileSync(join(SRC, name), "utf8")),
		}));

const FORBIDDEN: { door: string; why: string }[] = [
	{
		door: "@rowcat/runtime",
		why: "런타임 어휘는 스튜디오의 것이고 모바일에는 없다",
	},
	{
		door: "@rowcat/authoring",
		why: "제작이 대화 규칙에 묶이지 않는다는 경계다",
	},
	{
		door: "@rowcat/sdk",
		why: "전송을 알면 BYO 경로가 같은 조립기를 쓸 수 없다",
	},
	{ door: "@rowcat/sync", why: "프로토콜은 이 패키지의 관심이 아니다" },
	{ door: "@rowcat/query", why: "캐시 정책은 앱의 몫이다" },
	{ door: "../../apps", why: "앱이 이 패키지를 쓰지, 그 반대가 아니다" },
	{ door: "react", why: "화면은 앱의 몫이다 — 웹과 모바일의 UI는 같지 않다" },
	{ door: "dexie", why: "저장 수단은 플랫폼마다 다르다" },
	{ door: "node:", why: "Expo에는 Node API가 없다" },
	{ door: "localStorage", why: "관찰 기록도 저장소에 가지 않는다" },
	{ door: "indexedDB", why: "같은 이유다" },
];

describe("@rowcat/chat boundaries", () => {
	it.each(FORBIDDEN)("does not import $door: $why", ({ door }) => {
		expect(
			files()
				.filter((file) => file.source.includes(`from "${door}`))
				.map((file) => file.name),
		).toEqual([]);
	});

	it("there are files to scan", () => {
		expect(files().length).toBeGreaterThan(20);
	});
});

/**
 * Observation records never leave this package: there is no storage and no transport. The structure
 * mostly enforces this, but the test pins it as a value anyway. If a reducer ever calls Date.now(),
 * the record can no longer be checked by value, and tests on whether the cap drops the oldest
 * entries would start depending on timing.
 */
describe("the observation record is pure", () => {
	const debug = () =>
		files().filter(
			(file) =>
				file.name === "debug-trace.ts" ||
				file.name === "prompt-trace.ts" ||
				file.name === "lore.ts",
		);

	it("there are three files to scan", () => {
		expect(
			debug()
				.map((file) => file.name)
				.sort(),
		).toEqual(["debug-trace.ts", "lore.ts", "prompt-trace.ts"]);
	});

	it.each([
		"Date.now(",
		"new Date(",
		"Math.random(",
		"crypto.",
	])("%s 가 나타나지 않는다 — 시각과 신원은 밖에서 들어온다", (shape) => {
		expect(
			debug()
				.filter((file) => file.source.includes(shape))
				.map((file) => file.name),
		).toEqual([]);
	});
});
