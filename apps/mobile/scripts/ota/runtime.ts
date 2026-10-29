import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MobileRuntimeVersion } from "@rowcat/contracts";

/**
 * Record of native runtime generations: the native fingerprint at the moment each was cut.
 *
 * ```text
 * app.config.ts               runtimeVersion = rowcat-native-N    which native contract this binary is
 * native-runtime.lock.json    rowcat-native-N → <fingerprint>     what that contract was
 * @expo/fingerprint           current fingerprint                  what the current source builds
 * ```
 *
 * If the third differs from the second, native changed but the generation did not. An OTA published
 * then lands JS that expects new native code on an old binary with the same generation name; the
 * symptom is not an error but a "missing native module" crash on that binary only, so publishing
 * stops.
 *
 * The record is append-only. No command changes the fingerprint of an existing generation: a binary
 * under that name may already be in the stores and its contract does not change. When native
 * changes, use the next number (`RUNTIME_VERSION` in `app.config.ts`).
 */

export const LOCK_FILE = "native-runtime.lock.json";

export interface RuntimeLock {
	generations: Record<string, { fingerprint: string; recordedAt: string }>;
}

export const readRuntimeLock = (mobileRoot: string): RuntimeLock =>
	JSON.parse(readFileSync(join(mobileRoot, LOCK_FILE), "utf8")) as RuntimeLock;

/**
 * Current fingerprint, computed with the OTA axis off so config evaluation does not depend on the
 * channel. The scope is set by `fingerprint.config.js` and has no `updates` entry.
 */
export async function currentFingerprint(mobileRoot: string): Promise<string> {
	const saved = {
		ROWCAT_OTA: process.env.ROWCAT_OTA,
		ROWCAT_OTA_CHANNEL: process.env.ROWCAT_OTA_CHANNEL,
		EAS_BUILD: process.env.EAS_BUILD,
	};
	process.env.ROWCAT_OTA = "off";
	delete process.env.ROWCAT_OTA_CHANNEL;
	delete process.env.EAS_BUILD;
	try {
		const { createFingerprintAsync } = await import("@expo/fingerprint");
		const fingerprint = await createFingerprintAsync(mobileRoot, {
			silent: true,
		});
		return fingerprint.hash;
	} finally {
		for (const [key, value] of Object.entries(saved))
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
	}
}

/** Runtime generation of the evaluated config; `app.config.ts` is its only source. */
export async function configuredRuntimeVersion(): Promise<string> {
	const saved = process.env.ROWCAT_OTA;
	process.env.ROWCAT_OTA = "off";
	try {
		const { default: config } = await import("../../app.config.ts");
		return MobileRuntimeVersion.parse(config.runtimeVersion);
	} finally {
		if (saved === undefined) delete process.env.ROWCAT_OTA;
		else process.env.ROWCAT_OTA = saved;
	}
}

export type RuntimeCheck =
	| { ok: true; runtimeVersion: string; fingerprint: string }
	| {
			ok: false;
			runtimeVersion: string;
			fingerprint: string;
			recorded: string | null;
			problem: string;
	  };

export function judgeRuntime(
	lock: RuntimeLock,
	runtimeVersion: string,
	fingerprint: string,
): RuntimeCheck {
	const recorded = lock.generations[runtimeVersion]?.fingerprint ?? null;
	if (recorded === null)
		return {
			ok: false,
			runtimeVersion,
			fingerprint,
			recorded,
			problem:
				`there is no record of runtime generation ${runtimeVersion} — before building a binary with this generation, ` +
				"record the fingerprint with `pnpm mobile:update runtime:record` and commit it.",
		};
	if (recorded !== fingerprint)
		return {
			ok: false,
			runtimeVersion,
			fingerprint,
			recorded,
			problem:
				`the native fingerprint differs from ${runtimeVersion}'s record (recorded ${recorded.slice(0, 12)} · now ${fingerprint.slice(0, 12)}) — ` +
				"native code changed. Raise RUNTIME_VERSION in app.config.ts to the next number, " +
				"record it with `pnpm mobile:update runtime:record`, then build a new binary. " +
				"The first OTA of that generation means something only after that binary ships.",
		};
	return { ok: true, runtimeVersion, fingerprint };
}

/** Records the current fingerprint for the current generation for the first time; if one exists, succeeds only when identical. */
export function recordRuntime(
	mobileRoot: string,
	runtimeVersion: string,
	fingerprint: string,
	now: Date,
): "recorded" | "unchanged" {
	const lock = readRuntimeLock(mobileRoot);
	const existing = lock.generations[runtimeVersion];
	if (existing) {
		if (existing.fingerprint === fingerprint) return "unchanged";
		throw new Error(
			`${runtimeVersion} is already recorded with a different fingerprint — generation numbers aren't reused. ` +
				"Raise RUNTIME_VERSION to the next number.",
		);
	}
	const next: RuntimeLock = {
		generations: {
			...lock.generations,
			[runtimeVersion]: {
				fingerprint,
				recordedAt: now.toISOString().slice(0, 10),
			},
		},
	};
	writeFileSync(
		join(mobileRoot, LOCK_FILE),
		`${JSON.stringify(next, null, "\t")}\n`,
	);
	return "recorded";
}
