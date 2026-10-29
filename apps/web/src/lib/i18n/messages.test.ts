import { expect, test } from "vitest";
import { en } from "./messages/en/index.ts";
import { ko } from "./messages/ko/index.ts";

/**
 * The `Messages` type already rejects a missing key at compile time. This checks what the type
 * cannot: that each translation keeps the same interpolation variables. A Korean string that drops
 * `{{count}}` compiles and renders without the number.
 */
type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out.set(path, value);
		else for (const [k, v] of leaves(value, path)) out.set(k, v);
	}
	return out;
}

function variables(text: string): string[] {
	return [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)]
		.map((match) => match[1] ?? "")
		.sort();
}

test("every locale has exactly the English keys", () => {
	expect([...leaves(ko as Tree).keys()].sort()).toEqual(
		[...leaves(en as Tree).keys()].sort(),
	);
});

test("every translation keeps the source's interpolation variables", () => {
	const source = leaves(en as Tree);
	for (const [key, text] of leaves(ko as Tree)) {
		expect({ key, vars: variables(text) }).toEqual({
			key,
			vars: variables(source.get(key) ?? ""),
		});
	}
});

test("no English source string contains Hangul", () => {
	for (const [key, text] of leaves(en as Tree)) {
		expect({ key, hangul: /[\uac00-\ud7a3]/.test(text) }).toEqual({
			key,
			hangul: false,
		});
	}
});
