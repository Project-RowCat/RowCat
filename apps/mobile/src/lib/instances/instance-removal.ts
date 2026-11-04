import type { InstanceRegistry } from "./instance-registry.ts";

/**
 * Whether an instance may be removed from this device, and why not (`docs/mobile/INSTANCES.md`
 * §전환 · 로그아웃 · 취소된 자격). Pure, so the screen and the removal itself ask the same question.
 *
 * ```text
 * home     never — it is the build's own server; the member signs out of it instead
 * active   not while it is in use — switch away first, so its scope is closed before its files go
 * unknown  not on this device (a stale screen)
 * ```
 *
 * The active rule is the important one: removing the instance in use would delete the database the open
 * scope is writing to.
 */
export type InstanceRemovalBlocker = "home" | "active" | "unknown";

export function instanceRemovalBlocker(
	registry: InstanceRegistry,
	origin: string,
	homeOrigin: string,
): InstanceRemovalBlocker | null {
	if (origin === homeOrigin) return "home";
	if (!registry.list().some((entry) => entry.origin === origin))
		return "unknown";
	const active = registry.active();
	if (active.kind === "other" && active.origin === origin) return "active";
	return null;
}
