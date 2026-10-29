import { describe, expect, test } from "vitest";
import { shellRouteFor } from "#/components/app-shell/shell-route.ts";
import { routeTree } from "#/routeTree.gen.ts";
import { runtimeDocHref, runtimeDocSlugFromSplat } from "./runtime-docs-nav.ts";

/**
 * Public docs route check: the route is registered, public, and does not fall outside the shell.
 *
 * It does not render React; it inspects the tree
 * the router builds and the shell decision. It does not search the generated file's text, since a
 * string search also matches comments.
 */

interface RouteNode {
	options?: { path?: string };
	children?: RouteNode[];
}

function routePaths(): string[] {
	const paths: string[] = [];
	const walk = (route: RouteNode) => {
		const path = route.options?.path;
		if (typeof path === "string") paths.push(path);
		for (const child of route.children ?? []) walk(child);
	};
	walk(routeTree as unknown as RouteNode);
	return paths;
}

const matches = (routeId: string, params: unknown = {}) => [
	{ routeId: "__root__", params: {} },
	{ routeId: "/(app)", params: {} },
	{ routeId, params },
];

const DOCS_INDEX = "/(app)/docs/runtime/";
const DOCS_PAGE = "/(app)/docs/runtime/$";

describe("public docs routes", () => {
	test("the root and doc routes are registered at those addresses", () => {
		const paths = routePaths();
		expect(paths).toContain("/docs/runtime/");
		expect(paths).toContain("/docs/runtime/$");
	});

	test.each([
		[DOCS_INDEX, {}],
		[DOCS_PAGE, { _splat: "quick-start" }],
		[DOCS_PAGE, { _splat: "concepts/state" }],
	])("%s — a public doc that lights up no sidebar or header item", (routeId, params) => {
		const shell = shellRouteFor(matches(routeId, params));
		expect(shell).toEqual({
			section: null,
			utility: null,
			context: null,
			viewportLocked: false,
			publicDocument: true,
		});
	});
});

describe("addresses and slugs", () => {
	test("the root is /docs/runtime without a trailing slash and the rest sit below it", () => {
		expect(runtimeDocHref("")).toBe("/docs/runtime");
		expect(runtimeDocHref("concepts/state")).toBe(
			"/docs/runtime/concepts/state",
		);
	});

	test("a splat's trailing and leading slash are the same doc", () => {
		expect(runtimeDocSlugFromSplat("concepts/state/")).toBe("concepts/state");
		expect(runtimeDocSlugFromSplat("/quick-start")).toBe("quick-start");
		expect(runtimeDocSlugFromSplat(undefined)).toBe("");
	});
});
