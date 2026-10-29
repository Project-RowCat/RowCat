import { describe, expect, test } from "vitest";
import { tokenizeCode } from "./code-tokens.ts";

/**
 * The tokenizer makes two promises: no character is ever lost, and when it guesses wrong it falls
 * back to plain text.
 */

const SAMPLE = `import { Stack, Text } from "@rowcat/runtime";

// first screen
export default function App() {
	const [n, setN] = useState(0);
	return <Stack gap={8}><Text style={{ fontSize: 22 }}>{n}</Text></Stack>;
}
`;

describe("tokenizeCode", () => {
	test("joining the tokens gives the source", () => {
		expect(
			tokenizeCode(SAMPLE, "tsx")
				.map((token) => token.text)
				.join(""),
		).toBe(SAMPLE);
		expect(
			tokenizeCode("echo hi", "bash")
				.map((token) => token.text)
				.join(""),
		).toBe("echo hi");
	});

	test("a language without highlighting is one plain token", () => {
		expect(tokenizeCode("a\nb", "text")).toEqual([
			{ kind: "plain", text: "a\nb" },
		]);
	});

	test("splits keywords, strings, comments, numbers, tags and attributes", () => {
		const kinds = new Map(
			tokenizeCode(SAMPLE, "tsx").map((token) => [token.text, token.kind]),
		);
		expect(kinds.get("import")).toBe("keyword");
		expect(kinds.get('"@rowcat/runtime"')).toBe("string");
		expect(kinds.get("// first screen")).toBe("comment");
		expect(kinds.get("22")).toBe("number");
		expect(kinds.get("Stack")).toBe("tag");
		expect(kinds.get("gap")).toBe("attribute");
		expect(kinds.get("useState")).toBe("function");
	});

	test("an unclosed string or comment is one token to the end and does not throw", () => {
		expect(tokenizeCode('const a = "open', "ts").at(-1)).toEqual({
			kind: "string",
			text: '"open',
		});
		expect(tokenizeCode("/* never", "ts")).toEqual([
			{ kind: "comment", text: "/* never" },
		]);
	});

	test("a template literal is one string", () => {
		/** The checker warns about a placeholder inside a plain string, so the pieces are joined. */
		const template = ["`a $", "{b} c`"].join("");
		const tokens = tokenizeCode(`const s = ${template};`, "ts");
		expect(tokens.find((token) => token.kind === "string")?.text).toBe(
			template,
		);
	});
});
