import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type MobileUpdateChannel,
	type MobileUpdateManifest,
	type MobileUpdatePlatform,
	MobileUpdateReleaseBundle,
	type MobileUpdateSignature,
	type MobileUpdateStoredAsset,
} from "@rowcat/contracts";
import { updateNotesFor } from "@rowcat/domain";
import { apiCliJson } from "./api-cli.ts";
import {
	type ChannelEnvironment,
	exportProcessEnv,
	readEasJson,
	resolveChannelEnvironment,
} from "./environment.ts";
import {
	buildManifest,
	buildRepublishedManifest,
	buildRollbackDirective,
	checkAssetBaseUrl,
	contentTypeFor,
	RELEASE_KEY_PREFIX,
	readPlatformExport,
} from "./manifest.ts";
import {
	configuredRuntimeVersion,
	currentFingerprint,
	judgeRuntime,
	readRuntimeLock,
} from "./runtime.ts";
import {
	certificatePathFor,
	loadSigningKey,
	signForKeyId,
} from "./signing.ts";
import type { RegisteredRelease, StageTracker } from "./result.ts";
import { artifactStoreFromEnv, type UpdateArtifactStore } from "./storage.ts";

/**
 * Publish: one signed, immutable release per platform from a single export.
 *
 * ```text
 *  1 repository state  clean working tree · one commit (sourceCommit)
 *  2 channel env       shell matches that profile's env in eas.json · build-profile rule
 *  3 native runtime    current fingerprint = this generation's record
 *  4 checks            types · tests · generated-artifact freshness (harness, sandbox, update notes)
 *  5 update note       production names which note belongs to this release (or says there is none)
 *  6 config eval       expo config: update URL, key id and runtime match the environment
 *  7 export            expo export (only that channel's EXPO_PUBLIC_*, no secrets)
 *  8 assets            hash, upload only what is missing (same hash compares bytes)
 *  9 manifest          sign, then verify with the committed certificate
 * 10 bundle            keep in the work folder and the store
 * 11 register          production is draft unless a percentage is given
 * ```
 *
 * A failure at any step stops everything after it. Rerunning a failed publish is safe because
 * assets are not re-uploaded (same hash) and registration refuses a second release of the same code
 * (`content_key`).
 */

export interface PublishOptions {
	mobileRoot: string;
	repoRoot: string;
	channel: MobileUpdateChannel;
	platforms: MobileUpdatePlatform[];
	rollout: number | null;
	draft: boolean;
	apiOrigin?: string;
	note?: string;
	noNote: boolean;
	skipChecks: boolean;
	allowDirty: boolean;
	register: boolean;
	reason: string;
	now: Date;
	/** Lets CI record the stopped stage in the result file (`result.ts`); absent for a human run. */
	stages?: StageTracker;
}

const log = (message: string) => console.log(`· ${message}`);

function git(repoRoot: string, args: string[]): string {
	return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function run(
	command: string,
	args: string[],
	cwd: string,
	env?: NodeJS.ProcessEnv,
): void {
	const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

export function sourceCommitOf(
	repoRoot: string,
	allowDirty: boolean,
): string {
	const dirty = git(repoRoot, ["status", "--porcelain"]);
	if (dirty && !allowDirty)
		throw new Error(
			"the working tree isn't clean — a release comes from one commit (that commit is the bundle's sourceCommit)",
		);
	return git(repoRoot, ["rev-parse", "HEAD"]);
}

export function requireRuntime(mobileRoot: string, runtimeVersion: string) {
	return currentFingerprint(mobileRoot).then((fingerprint) => {
		const judged = judgeRuntime(
			readRuntimeLock(mobileRoot),
			runtimeVersion,
			fingerprint,
		);
		if (!judged.ok) throw new Error(judged.problem);
		return judged;
	});
}

/** Throws if the exported bundle contains even a fragment of a publish-environment secret. */
export function assertNoSecretsInBundle(
	bundle: Buffer,
	env: Readonly<Record<string, string | undefined>>,
): void {
	const text = bundle.toString("latin1");
	const secrets = [
		env.ROWCAT_OTA_SIGNING_KEY,
		env.ROWCAT_OTA_S3_SECRET_ACCESS_KEY,
		env.ROWCAT_OTA_S3_ACCESS_KEY_ID,
	];
	if (env.ROWCAT_OTA_SIGNING_KEY_FILE)
		try {
			secrets.push(readFileSync(env.ROWCAT_OTA_SIGNING_KEY_FILE, "utf8"));
		} catch {
			// An unreadable key file is rejected earlier by the signing step.
		}
	for (const secret of secrets) {
		if (!secret) continue;
		// For a PEM, each body line; otherwise the whole value. No fragment may appear in the bundle.
		const lines = secret
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length >= 40 && !line.startsWith("-----"));
		const probes = lines.length > 0 ? lines : [secret.trim()];
		for (const probe of probes)
			if (probe.length >= 8 && text.includes(probe))
				throw new Error("the exported bundle contains a secret from the release environment — stopping");
	}
}

interface PublicConfig {
	runtimeVersion?: unknown;
	updates?: {
		enabled?: boolean;
		url?: string;
		codeSigningMetadata?: { keyid?: string };
		requestHeaders?: Record<string, string>;
	};
	[key: string]: unknown;
}

/**
 * Config as Expo evaluated it. `public` is the shape carried in the manifest's `extra.expoClient`
 * (the signing-certificate field is dropped); `full` is the config the binary is built from, and
 * the key id is compared against that one.
 */
function evaluateConfig(
	mobileRoot: string,
	env: Record<string, string>,
	type: "public" | "full",
): PublicConfig {
	const result = spawnSync(
		"npx",
		[
			"expo",
			"config",
			...(type === "public" ? ["--type", "public"] : []),
			"--json",
		],
		{
			cwd: mobileRoot,
			env: env as NodeJS.ProcessEnv,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		},
	);
	if (result.status !== 0)
		throw new Error(`expo config failed:\n${result.stderr}`);
	const start = result.stdout.indexOf("{");
	return JSON.parse(result.stdout.slice(start)) as PublicConfig;
}

/**
 * Whether the evaluated config says the same as the binary: the update URL, key id and runtime of a
 * binary built for that channel must match this bundle's environment.
 */
export function checkEvaluatedConfig(
	config: PublicConfig,
	environment: ChannelEnvironment,
	runtimeVersion: string,
): { keyId: string } {
	const updates = config.updates;
	if (!updates?.enabled)
		throw new Error("OTA is off in the evaluated config — that channel's binaries don't receive OTA either");
	if (config.runtimeVersion !== runtimeVersion)
		throw new Error(
			`the evaluated runtime (${String(config.runtimeVersion)}) differs from ${runtimeVersion}`,
		);
	if (!updates.url || new URL(updates.url).origin !== environment.apiOrigin)
		throw new Error(
			`the binary's update address (${updates.url}) and the bundle's API origin (${environment.apiOrigin}) disagree`,
		);
	if (updates.requestHeaders?.["rowcat-update-channel"] !== environment.channel)
		throw new Error("the evaluated config's channel header differs from the publish channel");
	const keyId = updates.codeSigningMetadata?.keyid;
	if (!keyId) throw new Error("the evaluated config has no signing key id");
	return { keyId };
}

function releaseBundle(input: {
	id: string;
	kind: "update" | "rollback_to_embedded";
	platform: MobileUpdatePlatform;
	channel: MobileUpdateChannel;
	runtimeVersion: string;
	createdAt: string;
	apiOrigin: string;
	republishOf: string | null;
	sourceCommit: string;
	body: string;
	signature: MobileUpdateSignature;
	assets: MobileUpdateStoredAsset[];
}): MobileUpdateReleaseBundle {
	return MobileUpdateReleaseBundle.parse({
		formatVersion: 1,
		release: {
			id: input.id,
			kind: input.kind,
			platform: input.platform,
			channel: input.channel,
			runtimeVersion: input.runtimeVersion,
			createdAt: input.createdAt,
			apiOrigin: input.apiOrigin,
			republishOf: input.republishOf,
			sourceCommit: input.sourceCommit,
		},
		body: input.body,
		signatures: [input.signature],
		assets: input.assets,
	});
}

async function storeBundle(
	store: UpdateArtifactStore,
	workDir: string,
	bundle: MobileUpdateReleaseBundle,
): Promise<string> {
	const text = `${JSON.stringify(bundle, null, 2)}\n`;
	const file = join(
		workDir,
		`${bundle.release.platform}-${bundle.release.id}.release.json`,
	);
	writeFileSync(file, text);
	await store.putReleaseArchive(
		`${RELEASE_KEY_PREFIX}${bundle.release.channel}/${bundle.release.platform}/${bundle.release.id}.json`,
		text,
	);
	return file;
}

interface RegisterJson {
	created: boolean;
	id: string;
	status: string;
	rolloutPercentage: number;
}

function registerBundle(
	file: string,
	keyId: string,
	certificatePath: string,
	options: { rollout: number | null; draft: boolean; reason: string },
	extra: string[] = [],
): RegisterJson {
	const args = [
		"register",
		file,
		"--certificate",
		`${keyId}=${certificatePath}`,
		...(options.rollout !== null ? ["--rollout", String(options.rollout)] : []),
		...(options.draft ? ["--draft"] : []),
		...(options.reason ? ["--reason", options.reason] : []),
		...extra,
	];
	return apiCliJson<RegisterJson>(args);
}

export async function publish(
	options: PublishOptions,
): Promise<RegisteredRelease[]> {
	const { mobileRoot, repoRoot, channel } = options;
	const stage = (name: Parameters<StageTracker["enter"]>[0]) =>
		options.stages?.enter(name);
	stage("environment");

	if (channel === "production") {
		if (options.allowDirty)
			throw new Error("the production channel publishes only from a clean working tree (no --allow-dirty)");
		if (options.skipChecks)
			throw new Error("the production channel doesn't skip checks (no --skip-checks)");
		if (!options.note && !options.noNote)
			throw new Error(
				"a production release states its update note — --note <YYYY-MM-DD> or --no-note",
			);
	}

	const sourceCommit = sourceCommitOf(repoRoot, options.allowDirty);
	log(`commit ${sourceCommit.slice(0, 12)}`);

	const resolved = resolveChannelEnvironment({
		channel,
		easJson: readEasJson(mobileRoot),
		shellEnv: process.env,
		apiOriginFlag: options.apiOrigin,
	});
	if (!resolved.ok)
		throw new Error(`the channel environment doesn't match the binary:\n  · ${resolved.problems.join("\n  · ")}`);
	const environment = resolved.environment;
	log(`channel ${channel} · API ${environment.apiOrigin}`);

	stage("runtime");
	const runtimeVersion = await configuredRuntimeVersion();
	const runtime = await requireRuntime(mobileRoot, runtimeVersion);
	log(`runtime ${runtimeVersion} · fingerprint ${runtime.fingerprint.slice(0, 12)}`);

	stage("update_note");
	if (options.note) {
		// The note is the repository's authored original; only check that it exists, never build it.
		const note = updateNotesFor("mobile").find(
			(entry) => entry.id === options.note,
		);
		if (!note)
			throw new Error(
				`the mobile surface's update note ${options.note} isn't in the generated registry — ` +
					"write the note and commit pnpm updates:generate",
			);
		log(`update note ${note.id}`);
	}

	stage("checks");
	if (!options.skipChecks) {
		log("checks — generated artifact freshness · types · tests");
		run("pnpm", ["runtime-vm:harness:check"], repoRoot);
		run("pnpm", ["runtime:sandbox:check"], repoRoot);
		run("pnpm", ["updates:check"], repoRoot);
		run("pnpm", ["--filter", "@rowcat/mobile", "typecheck"], repoRoot);
		run("pnpm", ["--filter", "@rowcat/mobile", "test"], repoRoot);
	}

	stage("environment");
	const exportEnv = exportProcessEnv(process.env, environment);
	const config = evaluateConfig(mobileRoot, exportEnv, "public");
	const { keyId } = checkEvaluatedConfig(
		evaluateConfig(mobileRoot, exportEnv, "full"),
		environment,
		runtimeVersion,
	);
	stage("signing");
	const certificatePath = certificatePathFor(mobileRoot, keyId);
	const certificatePem = readFileSync(certificatePath, "utf8");
	const signingKey = loadSigningKey(process.env);
	// Learn before exporting whether the key belongs to this channel, so a minutes-long export is not
	// wasted.
	signForKeyId({ body: "probe", key: signingKey, keyId, certificatePem });
	log(`signing key ${keyId}`);

	stage("assets");
	const assetBaseUrl = process.env.ROWCAT_OTA_ASSET_BASE_URL?.trim() ?? "";
	const assetProblem = checkAssetBaseUrl(assetBaseUrl);
	if (assetProblem) throw new Error(`ROWCAT_OTA_ASSET_BASE_URL: ${assetProblem}`);
	const store = artifactStoreFromEnv(process.env);
	log(`storage ${store.description} · assets ${assetBaseUrl}`);

	const stamp = options.now.toISOString().replaceAll(/[:.]/g, "-");
	const workDir = join(mobileRoot, ".ota", `${stamp}-${channel}`);
	const exportDir = join(workDir, "export");
	mkdirSync(workDir, { recursive: true });
	stage("export");
	log(`export → ${exportDir}`);
	run(
		"npx",
		[
			"expo",
			"export",
			"--output-dir",
			exportDir,
			...options.platforms.flatMap((platform) => ["--platform", platform]),
		],
		mobileRoot,
		exportEnv as NodeJS.ProcessEnv,
	);

	const results: { platform: MobileUpdatePlatform; id: string; line: string }[] = [];
	const registeredReleases: RegisteredRelease[] = [];
	for (const platform of options.platforms) {
		stage("export");
		const exported = readPlatformExport(exportDir, platform);
		assertNoSecretsInBundle(exported.launch.bytes, process.env);

		stage("assets");
		let created = 0;
		for (const file of [exported.launch, ...exported.assets])
			if (
				(await store.putAsset(
					file.bytes,
					file === exported.launch
						? "application/javascript"
						: contentTypeFor(file.ext),
				)) === "created"
			)
				created++;
		log(
			`${platform}: uploaded ${created} new of ${exported.assets.length + 1} assets`,
		);

		stage("signing");
		const built = buildManifest({
			exported,
			channel,
			runtimeVersion,
			apiOrigin: environment.apiOrigin,
			assetBaseUrl,
			expoClient: config as Record<string, unknown>,
			now: options.now,
		});
		const signature = signForKeyId({
			body: built.body,
			key: signingKey,
			keyId,
			certificatePem,
		});
		const bundle = releaseBundle({
			id: built.id,
			kind: "update",
			platform,
			channel,
			runtimeVersion,
			createdAt: built.createdAt,
			apiOrigin: environment.apiOrigin,
			republishOf: null,
			sourceCommit,
			body: built.body,
			signature,
			assets: built.assets,
		});
		const file = await storeBundle(store, workDir, bundle);
		log(`${platform}: bundle ${file}`);

		if (!options.register) {
			results.push({ platform, id: built.id, line: "not registered (--no-register)" });
			continue;
		}
		stage("registration");
		let registered: RegisterJson;
		try {
			registered = registerBundle(file, keyId, certificatePath, {
				rollout: options.rollout,
				draft: options.draft,
				reason: options.reason,
			});
		} catch (error) {
			// The bundle is already signed and in the work folder and store. Rerunning the whole publish
			// would be refused for the earlier platform as "same code", so point to re-registering only the
			// failed bundle.
			console.error(
				`\n${platform} registration failed — the signed bundle remains. After fixing, register only this:\n` +
					`  pnpm mobile:update register ${file}${options.rollout !== null ? ` --rollout ${options.rollout}` : options.draft ? " --draft" : ""}\n`,
			);
			if (results.length > 0)
				console.error(
					`already registered: ${results.map((result) =>`${result.platform} ${result.id}`).join(", ")}`,
				);
			throw error;
		}
		results.push({
			platform,
			id: registered.id,
			line: `${registered.status} ${registered.rolloutPercentage}%${registered.created ? "" : " (was already registered)"}`,
		});
		registeredReleases.push({
			platform,
			id: registered.id,
			status: registered.status,
			rolloutPercentage: registered.rolloutPercentage,
		});
	}

	console.log("\npublished:");
	for (const result of results)
		console.log(`  ${result.platform}\t${result.id}\t${result.line}`);
	const ids = results.map((result) => result.id).join(",");
	console.log("\nnext:");
	if (channel === "production" && options.rollout === null)
		console.log(`  pnpm mobile:update rollout ${ids} 10   # canary`);
	else console.log(`  pnpm mobile:update rollout ${ids} <rollout>`);
	console.log(`  pnpm mobile:update pause ${ids} --reason "…"`);
	console.log(`  pnpm mobile:update rollback <id> --reason "…"`);
	return registeredReleases;
}

interface PlanJson {
	release: {
		id: string;
		platform: MobileUpdatePlatform;
		channel: MobileUpdateChannel;
		runtimeVersion: string;
		apiOrigin: string;
		keyIds: string[];
		status: string;
	};
	newerActive: { id: string }[];
	previousGood: { id: string } | null;
}

interface ShowJson {
	body: string;
	assets: { hash: string; byteSize: number }[];
}

/**
 * Rollback: the only way to move back installs that already took the bad release.
 *
 * ```text
 * 1 mark the bad release rolled_back   immediately, no signing - new checks stop receiving it
 * 2 re-sign the target with a new time the previous good OTA's code as-is (republish),
 *   or, if there is none,               a rollBackToEmbedded directive (the store bundle)
 * 3 register at 100%
 * ```
 *
 * Step 2 is needed because clients accept only a response newer than what they currently run, so
 * re-enabling A does not move an install that took B. That install downloads the republish on its
 * next cold start and runs it on the one after (expo-updates never swaps the running bundle). An
 * update that crashes at launch is first reverted by expo-updates' own error recovery; any other
 * defect (one wrong screen) is fixed only by this path.
 *
 * Step 1 comes first because it needs no key, and even if step 2 fails the spread is stopped.
 */
export async function rollback(input: {
	mobileRoot: string;
	repoRoot: string;
	id: string;
	reason: string;
	toEmbedded: boolean;
	now: Date;
	stages?: StageTracker;
}): Promise<RegisteredRelease[]> {
	const stage = (name: Parameters<StageTracker["enter"]>[0]) =>
		input.stages?.enter(name);
	stage("plan");
	if (!input.reason.trim()) throw new Error("a rollback needs --reason");
	const plan = apiCliJson<PlanJson>(["rollback-plan", input.id]);
	if (plan.newerActive.length > 0)
		throw new Error(
			`there is an active release newer than this one (${plan.newerActive.map((release) => release.id).join(", ")}) — ` +
				"clients already receive it. Stop that release first, or pausing this one is enough.",
		);
	stage("signing");
	const keyId = plan.release.keyIds[0];
	if (!keyId) throw new Error("the release to roll back has no signing key id");
	const certificatePath = certificatePathFor(input.mobileRoot, keyId);
	const certificatePem = readFileSync(certificatePath, "utf8");
	const signingKey = loadSigningKey(process.env);
	signForKeyId({ body: "probe", key: signingKey, keyId, certificatePem });

	stage("registration");
	apiCliJson(["mark-rolled-back", input.id, "--reason", input.reason]);
	console.log(`· rolled back ${input.id} — installs asking from now on don't receive it`);

	// A draft never reached anyone: no installs to restore, so no recovery release.
	if (plan.release.status === "draft") {
		console.log("· it was a draft — no install received it, so no recovery release goes out");
		return [];
	}

	const store = artifactStoreFromEnv(process.env);
	const workDir = join(
		input.mobileRoot,
		".ota",
		`${input.now.toISOString().replaceAll(/[:.]/g, "-")}-rollback`,
	);
	mkdirSync(workDir, { recursive: true });
	const sourceCommit = git(input.repoRoot, ["rev-parse", "HEAD"]);
	const { platform, channel, runtimeVersion, apiOrigin } = plan.release;

	stage("signing");
	let bundle: MobileUpdateReleaseBundle;
	if (plan.previousGood && !input.toEmbedded) {
		const previous = apiCliJson<ShowJson>(["show", plan.previousGood.id]);
		const sizes = new Map(previous.assets.map((asset) => [asset.hash, asset.byteSize]));
		const built = buildRepublishedManifest({
			previousBody: previous.body,
			now: input.now,
		});
		const manifest: MobileUpdateManifest = built.manifest;
		const assets = [manifest.launchAsset, ...manifest.assets].map((asset) => {
			const byteSize = sizes.get(asset.hash);
			if (!byteSize) throw new Error(`don't know the size of the asset to republish: ${asset.hash}`);
			return { ...asset, byteSize };
		});
		bundle = releaseBundle({
			id: built.id,
			kind: "update",
			platform,
			channel,
			runtimeVersion,
			createdAt: built.createdAt,
			apiOrigin,
			republishOf: plan.previousGood.id,
			sourceCommit,
			body: built.body,
			signature: signForKeyId({
				body: built.body,
				key: signingKey,
				keyId,
				certificatePem,
			}),
			assets,
		});
		console.log(`· re-signed ${plan.previousGood.id}'s code with a new time`);
	} else {
		const built = buildRollbackDirective({
			channel,
			platform,
			runtimeVersion,
			now: input.now,
		});
		bundle = releaseBundle({
			id: built.id,
			kind: "rollback_to_embedded",
			platform,
			channel,
			runtimeVersion,
			createdAt: built.createdAt,
			apiOrigin,
			republishOf: null,
			sourceCommit,
			body: built.body,
			signature: signForKeyId({
				body: built.body,
				key: signingKey,
				keyId,
				certificatePem,
			}),
			assets: [],
		});
		console.log("· signed an instruction to go back to the store bundle (rollBackToEmbedded)");
	}

	stage("assets");
	const file = await storeBundle(store, workDir, bundle);
	stage("registration");
	const registered = registerBundle(file, keyId, certificatePath, {
		rollout: 100,
		draft: false,
		reason: `rollback of ${input.id}: ${input.reason}`,
	});
	console.log(
		`\nrollback release ${registered.id} — ${registered.status} ${registered.rolloutPercentage}%`,
	);
	console.log(
		"installs that already received the bad release download this on the next cold start and run it on the one after.",
	);
	return [
		{
			platform,
			id: registered.id,
			status: registered.status,
			rolloutPercentage: registered.rolloutPercentage,
		},
	];
}
