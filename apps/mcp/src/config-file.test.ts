import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * The config holds the session cookie and the sync key. The path is read from the home directory
 * when the module loads, so each case points HOME at a fresh directory and imports the module again.
 */

const saved = {
	HOME: process.env.HOME,
	ROWCAT_SYNC_KEY: process.env.ROWCAT_SYNC_KEY,
	ROWCAT_SESSION_COOKIE: process.env.ROWCAT_SESSION_COOKIE,
	ROWCAT_API_BASE_URL: process.env.ROWCAT_API_BASE_URL,
};
afterEach(() => {
	for (const [name, value] of Object.entries(saved))
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	vi.resetModules();
});

/** A home with `~/.rowcat/mcp.json` holding `content`, at the given modes. */
function home(content: unknown, fileMode = 0o600, folderMode = 0o700) {
	const dir = mkdtempSync(join(tmpdir(), "rowcat-mcp-config-"));
	const folder = join(dir, ".rowcat");
	const file = join(folder, "mcp.json");
	mkdirSync(folder);
	chmodSync(folder, folderMode);
	writeFileSync(file, `${JSON.stringify(content)}\n`);
	chmodSync(file, fileMode);
	process.env.HOME = dir;
	delete process.env.ROWCAT_SYNC_KEY;
	delete process.env.ROWCAT_SESSION_COOKIE;
	delete process.env.ROWCAT_API_BASE_URL;
	vi.resetModules();
	return {
		folder,
		file,
		read: () => JSON.parse(readFileSync(file, "utf8")) as unknown,
	};
}

describe.skipIf(process.platform === "win32")("writing the config", () => {
	/**
	 * `mode` applies only when a file is created, so writing in place put the cookie and the key
	 * into a 0644 inode before the `chmod` after it ran. A new inode is the evidence the write never
	 * went into the old one.
	 */
	test("a world-readable config is replaced by a new 0600 file, and the folder tightened", async () => {
		const at = home({}, 0o644, 0o755);
		const before = statSync(at.file).ino;

		const { writeConfig } = await import("./config.ts");
		writeConfig({ cookie: "session=a", dek: "ZGVr", memberId: "member-a" });

		expect(statSync(at.file).ino).not.toBe(before);
		expect(statSync(at.file).mode & 0o777).toBe(0o600);
		expect(statSync(at.folder).mode & 0o777).toBe(0o700);
		expect(at.read()).toEqual({
			cookie: "session=a",
			dek: "ZGVr",
			memberId: "member-a",
		});
		expect(readdirSync(at.folder)).toEqual(["mcp.json"]);
	});
});

describe.skipIf(process.platform === "win32")("dropping a stale key", () => {
	test("the key that was found stale is dropped, and nothing else", async () => {
		const at = home({ cookie: "session=a", dek: "OLD", memberId: "member-a" });
		const { forgetStoredDek } = await import("./config.ts");

		expect(forgetStoredDek("member-a", "OLD")).toBe(true);
		expect(at.read()).toEqual({ cookie: "session=a", memberId: "member-a" });
	});

	/** `pair` ran in another terminal while the question was in flight. */
	test("a key paired in the meantime survives", async () => {
		const at = home({ cookie: "session=a", dek: "NEW", memberId: "member-a" });
		const { forgetStoredDek } = await import("./config.ts");

		expect(forgetStoredDek("member-a", "OLD")).toBe(false);
		expect(at.read()).toEqual({
			cookie: "session=a",
			dek: "NEW",
			memberId: "member-a",
		});
	});

	/** The environment lays its cookie and address over the file; neither may be written into it. */
	test("the file's own cookie survives an environment cookie, and no environment address is written", async () => {
		const at = home({
			cookie: "session=file",
			dek: "OLD",
			memberId: "member-a",
		});
		process.env.ROWCAT_SESSION_COOKIE = "session=env";
		process.env.ROWCAT_API_BASE_URL = "https://api.example.test/v2";
		const { forgetStoredDek } = await import("./config.ts");

		expect(forgetStoredDek("member-a", "OLD")).toBe(true);
		expect(at.read()).toEqual({ cookie: "session=file", memberId: "member-a" });
	});

	test("a key from ROWCAT_SYNC_KEY never costs the file its own", async () => {
		const at = home({ cookie: "session=a", dek: "FILE", memberId: "member-a" });
		process.env.ROWCAT_SYNC_KEY = "ENV";
		process.env.ROWCAT_SESSION_COOKIE = "session=env";
		const { forgetStoredDek } = await import("./config.ts");

		expect(forgetStoredDek("member-a", "ENV")).toBe(false);
		expect(forgetStoredDek("member-a", "FILE")).toBe(false);
		expect((at.read() as { dek?: string }).dek).toBe("FILE");
	});
});
