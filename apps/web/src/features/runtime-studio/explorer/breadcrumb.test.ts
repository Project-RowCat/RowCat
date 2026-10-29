import { describe, expect, it } from "vitest";
import {
	RUNTIME_BREADCRUMB_FOLDER_LIMIT,
	runtimeBreadcrumb,
} from "./breadcrumb.ts";

/**
 * The direction of truncation is what this test file checks. Truncating from the back looks
 * plausible: the line still reads like a path and has the right length. But it removes the current
 * file name, which is the reason the line exists. The loss only shows in projects with deep paths.
 */

describe("shallow paths", () => {
	it("a root file is one name", () => {
		expect(runtimeBreadcrumb("main.tsx")).toEqual({
			folders: [],
			truncated: false,
			name: "main.tsx",
		});
	});

	it("one folder stands as is", () => {
		expect(runtimeBreadcrumb("src/main.tsx")).toEqual({
			folders: ["src"],
			truncated: false,
			name: "main.tsx",
		});
	});

	it("no cutting up to the cap", () => {
		expect(runtimeBreadcrumb("src/components/button.tsx")).toEqual({
			folders: ["src", "components"],
			truncated: false,
			name: "button.tsx",
		});
	});
});

describe("deep paths", () => {
	const deep = "src/features/panels/very/deep/button.tsx";

	it("keeps the nearest parents and cuts the front", () => {
		expect(runtimeBreadcrumb(deep)).toEqual({
			folders: ["very", "deep"],
			truncated: true,
			name: "button.tsx",
		});
	});

	it("the file name remains under any cap", () => {
		for (const limit of [0, 1, 2, 5])
			expect(runtimeBreadcrumb(deep, limit).name).toBe("button.tsx");
	});

	it("with a cap of 0 only the fact of cutting remains, with no folders", () => {
		expect(runtimeBreadcrumb(deep, 0)).toEqual({
			folders: [],
			truncated: true,
			name: "button.tsx",
		});
	});

	it("no cut when the cap exceeds the path", () => {
		expect(runtimeBreadcrumb("src/ui/button.tsx", 9)).toEqual({
			folders: ["src", "ui"],
			truncated: false,
			name: "button.tsx",
		});
	});
});

describe("default cap", () => {
	it("is two", () => {
		expect(RUNTIME_BREADCRUMB_FOLDER_LIMIT).toBe(2);
	});

	/**
	 * The truncation marker appears only when the path was actually cut. Showing it always would carry
	 * no information.
	 */
	it("an uncut path shows no marker", () => {
		expect(runtimeBreadcrumb("a/b/c.ts").truncated).toBe(false);
		expect(runtimeBreadcrumb("a/b/c/d.ts").truncated).toBe(true);
	});
});
