import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import {
	MobileUpdateChannel,
	MobileUpdateKeyId,
	MobileUpdatePlatform,
} from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";
import { closeDb } from "../../db/client.ts";
import { env } from "../../env.ts";
import {
	getRelease,
	listReleases,
	MobileUpdateError,
	planRollback,
	registerRelease,
	reportAssetReachability,
	type TransitionAction,
	type TransitionResult,
	transitionRelease,
} from "./index.ts";
import { validateReleaseBundle } from "./registration.ts";

/**
 * Mobile OTA release operations: a process, not HTTP. The release tool (`pnpm mobile:update …`,
 * `apps/mobile/scripts/ota/`) calls it, and a person calls it directly during an incident.
 *
 * This process holds only the target deployment's `DATABASE_URL` and `API_ORIGIN`; signing keys
 * never reach it (registration only validates an already-signed bundle).
 *
 * ```bash
 * pnpm --filter @rowcat/api mobile-updates register <bundle.json> [--rollout N | --draft]
 * pnpm --filter @rowcat/api mobile-updates list [--channel c] [--platform p]
 * pnpm --filter @rowcat/api mobile-updates rollout <id[,id]> <percent>
 * pnpm --filter @rowcat/api mobile-updates pause <id[,id]> --reason "…"
 * ```
 *
 * In a deployment image, call the bundled entry point: `node dist/services/mobile-updates/cli.mjs
 * …`.
 */

const USAGE = `${APP_NAME} mobile OTA releases

  register <bundle.json> [--rollout N | --draft] [--certificate <keyId>=<pem>]
                         [--allow-duplicate-content] [--reason "…"]
      verifies and registers a signed bundle. Default: draft for production, 100% elsewhere.
  list [--channel c] [--platform p] [--runtime r] [--limit n] [--json]
  show <id> [--json]
  rollout <id[,id…]> <percent> [--reason "…"]     raises the rollout (it never shrinks)
  pause <id[,id…]> --reason "…"                   new installs stop receiving it
  resume <id[,id…]> [--reason "…"]                reopens at the paused rollout
  mark-rolled-back <id> --reason "…"              never selected again (terminal)
  rollback-plan <id> --json                       asks where it would go back to (changes nothing)
  gc-report [--json]                              counts asset reachability (deletes nothing)

  common: --actor <name> (default ROWCAT_RELEASE_ACTOR or the shell user)
`;

interface ParsedArgs {
	positional: string[];
	flags: Map<string, string[]>;
}

const BOOLEAN_FLAGS = new Set(["json", "draft", "allow-duplicate-content"]);

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const flags = new Map<string, string[]>();
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index] as string;
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const [rawName, inline] = token.slice(2).split(/=(.*)/s, 2);
		const name = rawName as string;
		let value: string;
		if (inline !== undefined) value = inline;
		else if (BOOLEAN_FLAGS.has(name)) value = "true";
		else {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--"))
				throw new UsageError(`--${name} has no value`);
			value = next;
			index++;
		}
		flags.set(name, [...(flags.get(name) ?? []), value]);
	}
	return { positional, flags };
}

class UsageError extends Error {}

const flag = (args: ParsedArgs, name: string): string | undefined =>
	args.flags.get(name)?.at(-1);

const actorOf = (args: ParsedArgs): string => {
	const actor =
		flag(args, "actor") ??
		process.env.ROWCAT_RELEASE_ACTOR?.trim() ??
		userInfo().username;
	if (!actor) throw new UsageError("--actor is required");
	return actor.slice(0, 120);
};

const idsOf = (raw: string | undefined): string[] => {
	const ids = (raw ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	if (ids.length === 0) throw new UsageError("a release id is required");
	return ids;
};

/**
 * Trusted certificate per key id; the file committed in the repository is the default. The binary
 * embeds `apps/mobile/certs/<keyId>.pem` and registration must compare against that same file.
 * Where the path does not exist (e.g. a deployment image), pass `--certificate`.
 */
function certificatesFor(
	keyIds: readonly string[],
	args: ParsedArgs,
): Map<string, string> {
	const explicit = new Map<string, string>();
	for (const entry of args.flags.get("certificate") ?? []) {
		const [keyId, path] = entry.split(/=(.*)/s, 2);
		if (!keyId || !path || !MobileUpdateKeyId.safeParse(keyId).success)
			throw new UsageError(`--certificate is <keyId>=<pem path>: ${entry}`);
		explicit.set(keyId, path);
	}
	const certificates = new Map<string, string>();
	for (const keyId of keyIds) {
		const path =
			explicit.get(keyId) ??
			fileURLToPath(
				new URL(`../../../../mobile/certs/${keyId}.pem`, import.meta.url),
			);
		try {
			certificates.set(keyId, readFileSync(path, "utf8"));
		} catch {
			/** A missing certificate is rejected by the validation as "not provided"; no guessing here. */
		}
	}
	return certificates;
}

const print = (args: ParsedArgs, value: unknown, human: () => string) => {
	console.log(
		flag(args, "json") === "true" ? JSON.stringify(value, null, 2) : human(),
	);
};

async function register(args: ParsedArgs): Promise<number> {
	const path = args.positional[1];
	if (!path) throw new UsageError("a bundle file path is required");
	const raw = JSON.parse(readFileSync(path, "utf8")) as {
		signatures?: { keyId?: unknown }[];
		release?: { channel?: unknown };
	};
	const keyIds = (raw.signatures ?? [])
		.map((signature) => signature.keyId)
		.filter((keyId): keyId is string => typeof keyId === "string");

	const validation = validateReleaseBundle(raw, {
		deploymentApiOrigin: env.API_ORIGIN,
		certificates: certificatesFor(keyIds, args),
		now: new Date(),
	});
	if (!validation.ok) {
		console.error("not registering the bundle:");
		for (const problem of validation.problems) console.error(`  · ${problem}`);
		return 1;
	}

	const channel = validation.release.bundle.release.channel;
	const explicitRollout = flag(args, "rollout");
	if (explicitRollout !== undefined && flag(args, "draft") === "true")
		throw new UsageError("--rollout and --draft can't be used together");
	/** A production channel is `draft` unless a percentage is given: widening a production update is always a person typing a number, and the default must not pick it. */
	const rolloutPercentage =
		explicitRollout !== undefined
			? Number(explicitRollout)
			: flag(args, "draft") === "true" || channel === "production"
				? null
				: 100;
	if (rolloutPercentage !== null && !Number.isInteger(rolloutPercentage))
		throw new UsageError("--rollout is an integer");

	const result = await registerRelease(validation.release, {
		rolloutPercentage,
		actor: actorOf(args),
		reason: flag(args, "reason") ?? "",
		allowDuplicateContent: flag(args, "allow-duplicate-content") === "true",
	});
	print(args, result, () =>
		result.created
			? `registered ${result.id} — ${result.status} ${result.rolloutPercentage}%`
			: `already registered ${result.id} — ${result.status} ${result.rolloutPercentage}% (nothing changed)`,
	);
	return 0;
}

async function transition(
	args: ParsedArgs,
	action: TransitionAction,
): Promise<number> {
	const ids = idsOf(args.positional[1]);
	const reason = flag(args, "reason") ?? "";
	/** Pausing and rolling back are incident response; the history must record why. */
	if ((action === "pause" || action === "rollback") && !reason.trim())
		throw new UsageError(`${action} needs --reason`);
	let rolloutPercentage: number | undefined;
	if (action === "rollout") {
		rolloutPercentage = Number(args.positional[2]);
		if (!Number.isInteger(rolloutPercentage))
			throw new UsageError("a rollout (integer percent) is required");
	}
	const actor = actorOf(args);
	const results: TransitionResult[] = [];
	for (const id of ids)
		results.push(
			await transitionRelease(id, {
				action,
				rolloutPercentage,
				actor,
				reason,
			}),
		);
	print(args, results, () =>
		results
			.map(
				(result) =>
					`${result.id} — ${result.status} ${result.rolloutPercentage}%${result.changed ? "" : " (already in that state)"}`,
			)
			.join("\n"),
	);
	return 0;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const command = args.positional[0];

	switch (command) {
		case undefined:
		case "help":
			console.log(USAGE);
			return 0;
		case "register":
			return register(args);
		case "list": {
			const channel = flag(args, "channel");
			const platform = flag(args, "platform");
			const releases = await listReleases({
				channel: channel ? MobileUpdateChannel.parse(channel) : undefined,
				platform: platform ? MobileUpdatePlatform.parse(platform) : undefined,
				runtimeVersion: flag(args, "runtime"),
				limit: Number(flag(args, "limit") ?? 30),
			});
			print(
				args,
				releases,
				() =>
					releases
						.map(
							(release) =>
								`${release.id}\t${release.platform}\t${release.channel}\t${release.runtimeVersion}\t${release.createdAt}\t${release.kind === "update" ? "" : `${release.kind} `}${release.status} ${release.rolloutPercentage}%`,
						)
						.join("\n") || "no releases",
			);
			return 0;
		}
		case "show": {
			const id = args.positional[1];
			if (!id) throw new UsageError("a release id is required");
			const release = await getRelease(id);
			if (!release) {
				console.error(`no release ${id}`);
				return 1;
			}
			print(args, release, () =>
				[
					`${release.id} ${release.platform}/${release.channel}/${release.runtimeVersion}`,
					`  ${release.kind} · ${release.status} ${release.rolloutPercentage}% · ${release.createdAt}`,
					`  keys ${release.keyIds.join(", ")} · commit ${release.sourceCommit}${release.republishOf ? ` · republish ← ${release.republishOf}` : ""}`,
					...release.events.map(
						(event) =>
							`  ${event.createdAt} ${event.action} ${event.fromStatus ?? "∅"}→${event.toStatus} ${event.fromRollout ?? "∅"}→${event.toRollout}% (${event.actor})${event.reason ? ` — ${event.reason}` : ""}`,
					),
				].join("\n"),
			);
			return 0;
		}
		case "rollout":
			return transition(args, "rollout");
		case "pause":
			return transition(args, "pause");
		case "resume":
			return transition(args, "resume");
		case "mark-rolled-back":
			return transition(args, "rollback");
		case "rollback-plan": {
			const id = args.positional[1];
			if (!id) throw new UsageError("a release id is required");
			const plan = await planRollback(id);
			if (!plan) {
				console.error(`no release ${id}`);
				return 1;
			}
			print(args, plan, () =>
				[
					`to roll back   ${plan.release.id} (${plan.release.status} ${plan.release.rolloutPercentage}%)`,
					`goes back to ${plan.previousGood ? plan.previousGood.id : "the store binary's bundle (rollBackToEmbedded)"}`,
					...plan.newerActive.map(
						(release) => `⚠︎ newer active release ${release.id}`,
					),
				].join("\n"),
			);
			return 0;
		}
		case "gc-report": {
			const report = await reportAssetReachability();
			print(args, report, () =>
				[
					`releases ${report.releases}`,
					`reachable  assets ${report.reachable.assets} · ${report.reachable.bytes} B`,
					`pointed at only by rolled-back releases  assets ${report.retiredOnly.assets} · ${report.retiredOnly.bytes} B (not deleted)`,
				].join("\n"),
			);
			return 0;
		}
		default:
			throw new UsageError(`unknown command: ${command}`);
	}
}

main()
	.then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			if (error instanceof UsageError) {
				console.error(`${error.message}\n\n${USAGE}`);
				process.exitCode = 2;
			} else if (error instanceof MobileUpdateError) {
				console.error(`${error.code}: ${error.message}`);
				process.exitCode = 1;
			} else {
				console.error(error);
				process.exitCode = 1;
			}
		},
	)
	.finally(() => closeDb());
