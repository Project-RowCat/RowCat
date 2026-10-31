import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { buildFreshness, installBuildFreshness } from "./index.ts";

/**
 * Keeps this tab on the build the server serves (`freshness.ts`). Renders nothing, and does nothing on
 * the server: the wiring is an effect.
 */
export function BuildFreshnessWatch(): null {
	const router = useRouter();
	useEffect(() => installBuildFreshness(router, buildFreshness()), [router]);
	return null;
}
