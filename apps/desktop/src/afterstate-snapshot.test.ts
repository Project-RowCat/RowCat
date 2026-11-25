import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AfterstateSnapshot } from "./afterstate-snapshot.ts";

it("authenticates ciphertext to the member, rejects corruption and clears interrupted writes", () => {
	const dir = mkdtempSync(join(tmpdir(), "afterstate-snapshot-"));
	const file = join(dir, "index");
	const key = randomBytes(32);
	try {
		const index = new AfterstateSnapshot(file, key, "member-a");
		const original = Buffer.from("exact private conversation revision 9");
		index.save(original);
		expect(readFileSync(file).includes(original)).toBe(false);
		expect(index.load()).toEqual(original);
		writeFileSync(`${file}.pending`, "interrupted ciphertext");
		new AfterstateSnapshot(file, key, "member-a");
		expect(existsSync(`${file}.pending`)).toBe(false);
		expect(() => new AfterstateSnapshot(file, key, "member-b").load()).toThrow(
			"corrupt snapshot",
		);
		expect(existsSync(file)).toBe(false);
		index.save(original);
		const corrupt = readFileSync(file);
		corrupt[corrupt.length - 1] ^= 1;
		writeFileSync(file, corrupt);
		expect(() => index.load()).toThrow("corrupt snapshot");
		expect(index.load()).toBeNull();
		index.save(original);
		index.invalidate();
		expect(index.load()).toBeNull();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("round-trips binary images across streaming chunk boundaries and rejects truncation", () => {
	const dir = mkdtempSync(join(tmpdir(), "afterstate-stream-"));
	const file = join(dir, "index");
	try {
		const snapshot = new AfterstateSnapshot(file, randomBytes(32), "member");
		for (const length of [262143, 262144, 262145, 1048583]) {
			const bytes = randomBytes(length);
			snapshot.save(bytes);
			// A byte compare: `toEqual` walks a megabyte element by element, seconds on a slow runner.
			expect(snapshot.load()?.equals(bytes)).toBe(true);
		}
		const bytes = readFileSync(file);
		writeFileSync(file, bytes.subarray(0, bytes.length - 3));
		expect(() => snapshot.load()).toThrow("corrupt snapshot");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
