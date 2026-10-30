import { describe, expect, test } from "vitest";
import {
	formatSetupCode,
	normalizeSetupCode,
	SETUP_CODE_LENGTH,
	setupCodeFromBytes,
} from "./setup-code.ts";

describe("setupCodeFromBytes", () => {
	test("encodes the first 60 bits as twelve Crockford characters", () => {
		expect(setupCodeFromBytes(new Uint8Array(8))).toBe("000000000000");
		expect(setupCodeFromBytes(new Uint8Array(8).fill(0xff))).toBe(
			"ZZZZZZZZZZZZ",
		);
		// 0x08 = 00001|000…: the first character carries the top five bits.
		expect(
			setupCodeFromBytes(new Uint8Array([0x08, 0, 0, 0, 0, 0, 0, 0])),
		).toBe("100000000000");
	});

	test("ignores bytes past the first eight", () => {
		const head = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const longer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(setupCodeFromBytes(longer)).toBe(setupCodeFromBytes(head));
		expect(setupCodeFromBytes(head)).toHaveLength(SETUP_CODE_LENGTH);
	});

	test("refuses too few bytes instead of padding", () => {
		expect(() => setupCodeFromBytes(new Uint8Array(7))).toThrow();
	});
});

describe("normalizeSetupCode", () => {
	test("accepts the printed form, lower case and spaces", () => {
		expect(normalizeSetupCode("7KQM-3XWD-P9RT")).toBe("7KQM3XWDP9RT");
		expect(normalizeSetupCode(" 7kqm 3xwd p9rt ")).toBe("7KQM3XWDP9RT");
	});

	test("folds the letters people confuse with digits", () => {
		expect(normalizeSetupCode("OOOO-IIII-LLLL")).toBe("000011111111");
	});

	test("rejects a wrong length or a character outside the alphabet", () => {
		expect(normalizeSetupCode("7KQM-3XWD-P9R")).toBeNull();
		expect(normalizeSetupCode("7KQM-3XWD-P9RTX")).toBeNull();
		// `U` is not in Crockford's alphabet and must not be dropped to make the length fit.
		expect(normalizeSetupCode("7KQM-3XWD-P9RU")).toBeNull();
		expect(normalizeSetupCode("7KQM-3XWD-P9R!")).toBeNull();
	});

	test("round-trips what the encoder produces", () => {
		const code = setupCodeFromBytes(
			new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67]),
		);
		expect(normalizeSetupCode(formatSetupCode(code))).toBe(code);
		expect(formatSetupCode(code)).toMatch(/^.{4}-.{4}-.{4}$/);
	});
});
