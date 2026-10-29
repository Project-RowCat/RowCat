import { RUNTIME_HOST_ERROR_CODE } from "@rowcat/runtime-host/errors";
import { describe, expect, it } from "vitest";
import type { NativeRuntimeFailure } from "../../lib/runtime-native/protocol.ts";
import { runtimeArtifactIncompatible } from "./runtime-player-status.ts";

/**
 * A version-mismatch failure and any other failure **require different answers.**
 *
 * While this branch did not exist, both failures drew the same sentence (`Please restart`). Restarting
 * from the first rebuilds the same artifact in the same app and gets the same failure, so that
 * advice keeps the user in a retry that never ends.
 */

const error = (code: string | null): NativeRuntimeFailure => ({
	stage: "start",
	error: {
		kind: "host",
		name: "RuntimeHostError",
		message: "…",
		code,
		componentStack: [],
	},
});

describe("version mismatch failures", () => {
	it("artifact validation and the sandbox version comparison are that branch", () => {
		expect(
			runtimeArtifactIncompatible(
				error(RUNTIME_HOST_ERROR_CODE.artifactInvalid),
			),
		).toBe(true);
		expect(
			runtimeArtifactIncompatible(
				error(RUNTIME_HOST_ERROR_CODE.sandboxIncompatible),
			),
		).toBe(true);
	});

	/**
	 * Other start failures are **our incident or a limit**, so restart is the answer. Folding them
	 * into this branch would draw "update the app" for someone who can actually do something.
	 */
	it("other codes and code-less exceptions aren't that branch", () => {
		expect(
			runtimeArtifactIncompatible(
				error(RUNTIME_HOST_ERROR_CODE.vmInitializationFailed),
			),
		).toBe(false);
		expect(runtimeArtifactIncompatible(error(null))).toBe(false);
	});

	/**
	 * Only `start` is checked. Those two codes are thrown **before a VM is even created**, and the
	 * web's equivalent decision is also that one spot. The same code arriving with a failure during
	 * running is a different fact.
	 */
	it("outside the start stage it isn't that branch", () => {
		expect(
			runtimeArtifactIncompatible({
				stage: "runtime",
				error: {
					kind: "host",
					name: "RuntimeHostError",
					message: "…",
					code: RUNTIME_HOST_ERROR_CODE.artifactInvalid,
					componentStack: [],
				},
			}),
		).toBe(false);
		expect(
			runtimeArtifactIncompatible({ stage: "transport", message: "…" }),
		).toBe(false);
		expect(
			runtimeArtifactIncompatible({ stage: "renderer", message: "…" }),
		).toBe(false);
	});

	it("no failure means it isn't that branch", () => {
		expect(runtimeArtifactIncompatible(null)).toBe(false);
		expect(runtimeArtifactIncompatible(undefined)).toBe(false);
	});
});
