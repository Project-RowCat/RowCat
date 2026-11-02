import { describe, expect, it, vi } from "vitest";
import { HOME_INSTANCE } from "../local-scope.ts";
import { createActiveInstanceSource } from "./active-instance.ts";
import { authStoragePrefixFor } from "./auth-storage.ts";
import { createInstanceRegistry } from "./instance-registry.ts";

/**
 * What the network, auth and local-scope layers read instead of the build's fixed origin. The rules that
 * fail quietly: another server inheriting the home server's web links, a subscriber told about a switch the
 * device would not reopen after a restart, two servers sharing one session prefix.
 */

const HOME = "https://home.rowcat.test";

function sourceWith(enabled = true) {
	let raw: string | null = null;
	const registry = createInstanceRegistry({
		storage: {
			read: () => raw,
			write: async (value) => {
				raw = value;
			},
		},
		enabled,
		allowInsecure: false,
		homeOrigin: HOME,
	});
	const source = createActiveInstanceSource({
		registry,
		homeOrigin: HOME,
		homeWebOrigin: "https://web.home.rowcat.test",
	});
	return { registry, source, raw: () => raw };
}

describe("active instance", () => {
	it("starts on home, with home's web origin", () => {
		const { source } = sourceWith();
		expect(source.current()).toEqual({
			instance: HOME_INSTANCE,
			origin: HOME,
			webOrigin: "https://web.home.rowcat.test",
		});
	});

	/** Home's web links on another server would send a member to the wrong site. */
	it("another instance has its own origin and no web origin", async () => {
		const { registry, source } = sourceWith();
		await registry.add("https://elsewhere.test");
		await source.switchTo({ kind: "other", origin: "https://elsewhere.test" });
		expect(source.current()).toEqual({
			instance: { kind: "other", origin: "https://elsewhere.test" },
			origin: "https://elsewhere.test",
			webOrigin: null,
		});
	});

	it("saves before it notifies, and a refused switch notifies nobody", async () => {
		const { registry, source, raw } = sourceWith();
		await registry.add("https://elsewhere.test");
		const seen: (string | null)[] = [];
		source.subscribe(() => seen.push(raw()));
		await source.switchTo({ kind: "other", origin: "https://elsewhere.test" });
		expect(seen).toHaveLength(1);
		expect(JSON.parse(seen[0] ?? "{}").active).toBe("https://elsewhere.test");

		const listener = vi.fn();
		source.subscribe(listener);
		await expect(
			source.switchTo({ kind: "other", origin: "https://stranger.test" }),
		).rejects.toThrow();
		expect(listener).not.toHaveBeenCalled();
		expect(source.current().origin).toBe("https://elsewhere.test");
	});

	it("with selection off it stays home and a switch is refused", async () => {
		const { source } = sourceWith(false);
		expect(source.current().origin).toBe(HOME);
		await expect(source.switchTo(HOME_INSTANCE)).rejects.toThrow();
	});
});

describe("auth storage prefix", () => {
	/** Changing it would sign every installed app out. */
	it("home keeps the prefix installed apps already use", () => {
		expect(authStoragePrefixFor(HOME_INSTANCE)).toBe("rowcat.auth");
	});

	it("each other instance has its own, and none carries the address", () => {
		const a = authStoragePrefixFor({ kind: "other", origin: "https://a.test" });
		const b = authStoragePrefixFor({ kind: "other", origin: "https://b.test" });
		expect(a).not.toBe(b);
		expect(a).not.toBe("rowcat.auth");
		expect(a.startsWith("rowcat.auth.")).toBe(true);
		expect(a).not.toContain("a.test");
		expect(a).toMatch(/^[A-Za-z0-9._-]+$/);
	});
});
