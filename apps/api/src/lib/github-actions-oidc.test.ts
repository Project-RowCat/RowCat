import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	type GitHubActionsOidcExpectation,
	type Jwk,
	verifyGitHubActionsOidcToken,
} from "./github-actions-oidc.ts";

/**
 * GitHub Actions OIDC verification: each checked claim must really reject. The key is generated
 * in-process and the JWKS is injected with that one public key; the file only watches tokens with a
 * single claim changed fail one by one, so a missing check turns its case into a pass.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1" };
const jwks = async () => [jwk];

const NOW = 1_800_000_000_000;
const now = () => NOW;

const expected: GitHubActionsOidcExpectation = {
	audience: "https://api.example.test/v2/mobile/update-jobs",
	repository: "rowcat/rowcat",
	workflowPath: ".github/workflows/mobile-ota.yml",
	workflowRef: "refs/heads/main",
};

const base = {
	iss: "https://token.actions.githubusercontent.com",
	aud: expected.audience,
	repository: "rowcat/rowcat",
	workflow_ref:
		"rowcat/rowcat/.github/workflows/mobile-ota.yml@refs/heads/main",
	job_workflow_ref:
		"rowcat/rowcat/.github/workflows/mobile-ota.yml@refs/heads/main",
	event_name: "workflow_dispatch",
	ref: "refs/heads/main",
	environment: "ota-production",
	run_id: "123456789",
	iat: NOW / 1000 - 10,
	nbf: NOW / 1000 - 10,
	exp: NOW / 1000 + 300,
};

const b64 = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
	claims: Record<string, unknown>,
	header: Record<string, unknown> = { alg: "RS256", kid: "k1" },
) {
	const signing = `${b64(header)}.${b64(claims)}`;
	const signature = sign("sha256", Buffer.from(signing), privateKey).toString(
		"base64url",
	);
	return `${signing}.${signature}`;
}

const verify = (value: string) =>
	verifyGitHubActionsOidcToken(value, expected, { now, jwks });

describe("GitHub Actions OIDC", () => {
	test("returns the run id and environment when it is that workflow's run", async () => {
		expect(await verify(token(base))).toEqual({
			runId: "123456789",
			environment: "ota-production",
		});
	});

	test.each([
		["aud", { aud: "https://other.example/v2/mobile/update-jobs" }],
		["repository", { repository: "someone/fork" }],
		[
			"a workflow on another branch",
			{
				workflow_ref:
					"rowcat/rowcat/.github/workflows/mobile-ota.yml@refs/heads/feature",
			},
		],
		[
			"another workflow",
			{
				workflow_ref: "rowcat/rowcat/.github/workflows/ci.yml@refs/heads/main",
			},
		],
		["event_name", { event_name: "push" }],
		["ref", { ref: "refs/heads/feature" }],
		["iss", { iss: "https://accounts.google.com" }],
		["expiry", { exp: NOW / 1000 - 3600 }],
		["run id shape", { run_id: "12; rm" }],
	])("rejects when %s mismatches", async (_, override) => {
		expect(await verify(token({ ...base, ...override }))).toBeNull();
	});

	test("rejects a wrong signature", async () => {
		const value = token(base);
		const tampered = `${value.split(".").slice(0, 2).join(".")}.${Buffer.from("x").toString("base64url")}`;
		expect(await verify(tampered)).toBeNull();
	});

	test("cuts anything that isn't RS256 before looking at the signature", async () => {
		expect(await verify(token(base, { alg: "none", kid: "k1" }))).toBeNull();
		expect(await verify(token(base, { alg: "HS256", kid: "k1" }))).toBeNull();
	});

	test("failing to fetch the key is a rejection, not a pass", async () => {
		expect(
			await verifyGitHubActionsOidcToken(token(base), expected, {
				now,
				jwks: async () => {
					throw new Error("network");
				},
			}),
		).toBeNull();
	});
});
