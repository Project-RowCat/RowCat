import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	viewerDatabaseName,
	viewerDraftCoverDirName,
} from "./local-data/database.ts";
import { providerCredentialEntry } from "./local-provider/record.ts";
import { homeScope, type LocalScope, localScopeKey } from "./local-scope.ts";
import { deviceKeyEntry } from "./local-sync/device-key.ts";

/**
 * Local names are keyed by (instance, member). Two promises, and both fail silently:
 *
 * - **The home instance's names did not move.** Installed apps keep conversations, drafts and keys
 *   under them; a changed name opens an empty app, not an error. Pinned here as literal strings.
 * - **Another instance cannot reach them by claiming a member id.** Same id, different origin, different
 *   name — and no plain id or origin in any name (they land in backups and diagnostics).
 */

const MEMBER = "member-alice";
/** sha256("member-alice") — what every name was built from before scopes existed. */
const TODAY =
	"5fbcc70241188eba5926e545be5243d6fe53be3a601d3ef2ad418f5abfd5a821";

const other = (origin: string, memberId = MEMBER): LocalScope => ({
	instance: { kind: "other", origin },
	memberId,
});

describe("the home instance keeps today's names", () => {
	it("byte for byte", () => {
		const home = homeScope(MEMBER);
		expect(localScopeKey(home)).toBe(TODAY);
		expect(viewerDatabaseName(home)).toBe(`rowcat_vnext_${TODAY}.db`);
		expect(viewerDraftCoverDirName(home)).toBe(`draft-covers-${TODAY}`);
		expect(deviceKeyEntry(home)).toBe(`rowcat.sync.dek.${TODAY}`);
		expect(providerCredentialEntry(home, "anthropic-byo")).toBe(
			`rowcat.provider.${TODAY}.anthropic-byo`,
		);
	});
});

describe("another instance", () => {
	it("claiming the home member's id opens different names", () => {
		const claimed = other("https://elsewhere.test");
		expect(localScopeKey(claimed)).not.toBe(TODAY);
		expect(viewerDatabaseName(claimed)).not.toBe(
			viewerDatabaseName(homeScope(MEMBER)),
		);
		expect(deviceKeyEntry(claimed)).not.toBe(deviceKeyEntry(homeScope(MEMBER)));
	});

	it("is per origin, and the same scope always opens the same files", () => {
		expect(localScopeKey(other("https://a.test"))).not.toBe(
			localScopeKey(other("https://b.test")),
		);
		expect(localScopeKey(other("https://a.test"))).toBe(
			localScopeKey(other("https://a.test")),
		);
	});

	/** Bare concatenation would make these two the same input. */
	it("the origin is length-prefixed, so pairs cannot collide", () => {
		expect(localScopeKey(other("https://a.test1", "x"))).not.toBe(
			localScopeKey(other("https://a.test", "1x")),
		);
	});

	it("no name carries the origin or the member id", () => {
		const scope = other("https://elsewhere.test");
		for (const name of [
			viewerDatabaseName(scope),
			viewerDraftCoverDirName(scope),
			deviceKeyEntry(scope),
			providerCredentialEntry(scope, "gemini-byo"),
		]) {
			expect(name).not.toContain("elsewhere");
			expect(name).not.toContain(MEMBER);
		}
	});
});

/**
 * Where a member id still enters as the home instance. The slice that adds instance selection replaces
 * exactly these with the active instance; a new site that wraps an id on its own would quietly keep
 * using the home names for every instance.
 */
describe("homeScope is stated in a known set of places", () => {
	const SRC = fileURLToPath(new URL("../", import.meta.url));
	const walk = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return walk(path);
			return /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path)
				? [path]
				: [];
		});

	it("activation, purge and the store assembly — nothing else", () => {
		const users = walk(SRC)
			.filter((path) => /\bhomeScope\(/.test(readFileSync(path, "utf8")))
			.map((path) => relative(SRC, path))
			.filter((path) => path !== "lib/local-scope.ts")
			.sort();
		expect(users).toEqual([
			"lib/local-data/activation.ts",
			"lib/local-data/purge.ts",
			"lib/local-data/stores.ts",
		]);
	});
});
