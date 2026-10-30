import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Statically scans that secrets do not leak into logs. The mistake always looks the same: a
 * `console.log(dek)` added while debugging and never removed, which no review or test catches and
 * which leaks a user's key into production logs.
 *
 * It lives in apps/api because it must read the file system and `@rowcat/sync` deliberately knows
 * no Node APIs; two of the scan targets are already this app's.
 *
 * The scan does not catch declarations (`const dek = ...` is normal); only logging calls and their
 * arguments, where the value flows toward logging or serialization.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");

/** Names that fail the scan when they appear in a logging call argument. */
const RISKY = [
	"dek",
	"plaintext",
	"ciphertext",
	"recoverycode",
	"recoverysecret",
	"payload",
	"authkey",
	"auth_key",
	"proof",
	"wrapkey",
	"privatekey",
	"sharedsecret",
	"keyring",
	"secret",
	/**
	 * User-uploaded images are not secrets but other people's creations and personal data with no
	 * reason to be logged. Three names because the value travels in three shapes: the raw request body
	 * (`rawBody`), the normalized result (`coverBytes`) and the base64 copy (`dataurl`, the legacy
	 * shape, easy to revive).
	 */
	"rawbody",
	"coverbytes",
	"dataurl",
	/** BYO credentials. Listed because the scan now also covers the browser provider store and the direct-call adapters (`sourceFiles`). */
	"apikey",
	"credential",
	/** Pairing. The first three open the DEK directly if leaked; `codehash` cannot open the envelope but is the only key to an in-flight session. */
	"pairingcode",
	"normalizedcode",
	"ephemeral",
	"codehash",
	/**
	 * Values notifications show to people. Not secrets but personal data with no reason to be logged:
	 * the public reason is the text of someone's sanction, and finished notification copy contains
	 * names and story titles. Diagnostics need only the notification id, kind and recipient id, none
	 * of which are listed.
	 */
	"publicreason",
	"public_reason",
	"notificationmessage",
	/**
	 * Managed generation billing. These are the conversation itself (user prompts and model output),
	 * the tempting "log what the meter is counting" spot. One log line would break the promise that
	 * the server does not store conversations; diagnostics need only the attempt id and public model
	 * identity.
	 */
	"systemprompt",
	"promptbody",
	"producedtext",
	"deltatext",
	/**
	 * Membership eligibility. The first two are a child's personal data (birth dates are never stored,
	 * so logs must not become the only path that revives them); the other four are the guardian's:
	 * name and contact are third-party personal data, the verification reference is the identity
	 * authority's transaction id, and the consent token is a bearer credential for that screen.
	 * `consentPath` is caught too (it contains `consent`) because the path holds the token.
	 */
	"birthdate",
	"birth_date",
	"guardianname",
	"guardiancontact",
	"guardian_name",
	"guardian_contact",
	"verificationref",
	"verification_ref",
	"consenttoken",
	"consentpath",
	/**
	 * Identity verification. `apisecret` is the only key to a verification result (name, birth date,
	 * CI), and `verifiedcustomer` names the response object, the "just see what came" temptation this
	 * scan targets.
	 */
	"apisecret",
	"api_secret",
	"verifiedcustomer",
	"identityverificationid",
	/**
	 * Account security. `sessiontoken` is another device's session itself; a logged line lets its
	 * reader become that account, voiding the reason session cookies are HttpOnly. `newpassword` and
	 * `currentpassword` are plaintext passwords; bare `password` would also block legitimate
	 * diagnostics like `hasPassword`, and then the next person turns the rule off or drops the file
	 * from the list.
	 */
	"sessiontoken",
	"session_token",
	"newpassword",
	"currentpassword",
	/**
	 * Authentication mail. `verificationurl` and `verificationtoken` confirm an account's email by
	 * themselves; a logged line lets its reader confirm someone else's address, or move an account's
	 * address to their own via a change link. `mailhtml` and `mailtext` name the bodies carrying those
	 * links (the "log everything we tried to send" temptation). `smtppassword` is already caught by
	 * `password`; listing it tells readers the value passes through here.
	 */
	"verificationurl",
	"verification_url",
	"verificationtoken",
	"verification_token",
	"mailhtml",
	"mailtext",
	"smtppassword",
	"smtp_password",
	/**
	 * Passkeys. Public keys are not secret, but paired with the credential id they become a stable
	 * identifier of someone's authenticator, with no reason to be logged (diagnostics need only the
	 * passkey row id and member id). `challenge` is the one nonce of an in-flight ceremony; leaking it
	 * removes replay protection.
	 */
	"credentialid",
	"credential_id",
	"publickey",
	"public_key",
	"aaguid",
	"challenge",
	/**
	 * Push tokens. Holding one lets a reader send banners to that installation, the "just log which
	 * token" temptation on delivery failure. `accesstoken` is the Expo access token, enough to send
	 * push under this project's name.
	 */
	"pushtoken",
	"push_token",
	"expopushtoken",
	"devicetoken",
	"accesstoken",
	"access_token",
	/**
	 * First-run setup. The code makes whoever holds it an admin, and the salt plus the session secret
	 * derives it. `services/setup/announce.ts` prints the code on purpose and is the one file left out
	 * of the scan.
	 */
	"setupcode",
	"salt",
];

/** Calls that send values out through logging or serialization. */
const SINK = /\b(console\.(log|info|warn|error|debug|trace)|logger\.\w+)\s*\(/g;

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === "__fixtures__")
					continue;
				walk(full);
				continue;
			}
			/** Includes `.tsx` (mail copy became React components): a file dropped from the scan by extension would be silent, and this check guards exactly against omission. */
			if (
				(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
				!entry.name.endsWith(".test.ts") &&
				!entry.name.endsWith(".test.tsx")
			)
				files.push(full);
		}
	};
	walk(join(REPO, "packages", "sync", "src"));
	files.push(join(REPO, "apps", "api", "src", "services", "sync", "index.ts"));
	/**
	 * Also scans the pairing relay: it handles key-material envelopes and session lookup keys, so the
	 * diagnostic temptation ("log which codeHash came") is exactly what this scan catches. `payload`
	 * and `codehash` are both in `RISKY`.
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "sync", "pairing.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "sync.ts"));
	/**
	 * Also scans the account-deletion path: it passes passwords, keyrings and ciphertext in one
	 * request and is irreversible, the biggest diagnostic temptation. A deleted account's email in a
	 * log is not a deletion.
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "account", "deletion.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "auth", "index.ts"));
	/**
	 * Also scans the account-security path, which touches plaintext passwords, other devices' session
	 * tokens (the library's session list returns them) and auth account row ids; the first two are
	 * account access by themselves. `sessiontoken` is added for this slice, which is the first to hold
	 * that value in server code. The browser side is scanned too (password change form, provider
	 * connection); the console leaks wider than server logs.
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "account", "index.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "account.ts"));
	/**
	 * Also scans the authentication-mail path, the biggest temptation here: it carries links that
	 * confirm an account's email, and logging "what we tried to send" on failure lets a reader confirm
	 * the address (signup link) or move it to their own (change link). `dev.ts` is excluded on
	 * purpose: writing the link to the console is the only way to walk the verification flow in
	 * development; `env.ts` blocks boot on a production deployment running it and the adapter throws
	 * again. A scan that blocks correct code gets the rule turned off or the file removed.
	 */
	files.push(join(REPO, "apps", "api", "src", "services", "mail", "index.ts"));
	files.push(join(REPO, "apps", "api", "src", "services", "mail", "smtp.ts"));
	files.push(
		join(REPO, "apps", "api", "src", "services", "mail", "templates.tsx"),
	);
	/**
	 * Also scans the mail components, whole folder: listing files one by one drops a file silently
	 * when copy is added. Values here are link tokens and user display names, the diagnostic
	 * temptation this scan catches.
	 */
	walk(join(REPO, "apps", "api", "src", "services", "mail", "emails"));
	files.push(
		join(REPO, "apps", "api", "src", "services", "mail", "components.tsx"),
	);
	files.push(join(REPO, "apps", "api", "src", "services", "mail", "types.ts"));
	files.push(
		join(REPO, "apps", "api", "src", "auth", "verification-target.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "auth", "auth-user.ts"));
	files.push(join(REPO, "apps", "api", "src", "lib", "mail-config.ts"));
	/**
	 * Also scans Apple sign-in's signing key: it holds the `.p8` private key (impersonates our app to
	 * Apple) and the signed `client_secret` (can perform token exchange), and key-parse failure
	 * invites "log what came in". `privatekey` and `secret` are already risky names, so this adds a
	 * scan target, not a rule.
	 */
	files.push(join(REPO, "apps", "api", "src", "lib", "apple-signin-config.ts"));
	/**
	 * Also scans the passkey path, which handles credential rows whole (public key, credential id,
	 * counter, AAGUID in one object) and invites logging them wholesale. Our projection dropping those
	 * values from responses guarantees nothing about logs.
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "account", "passkeys.ts"),
	);
	/**
	 * Also scans the push delivery path whole: it holds registration rows with Expo push tokens and
	 * the access token in one function, and failures invite logging what was being sent. A folder walk
	 * is used (as with mail copy) so a new adapter cannot silently drop out of the scan.
	 */
	walk(join(REPO, "apps", "api", "src", "services", "push"));
	files.push(
		join(REPO, "apps", "api", "src", "jobs", "push", "deliver-push.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "push.ts"));
	files.push(join(REPO, "apps", "api", "src", "lib", "push-config.ts"));
	walk(join(REPO, "apps", "web", "src", "features", "account"));
	/** Also scans browser auth screens (resend verification mail, passkey ceremony): the console leaks wider than server logs (extensions read it, error reporters collect breadcrumbs, users share screenshots). */
	walk(join(REPO, "apps", "web", "src", "features", "auth"));
	/**
	 * Also scans the moderation path, which carries report evidence: conversation plaintext the user
	 * explicitly took out of E2EE, and other people's writing (comment and appeal bodies, story
	 * descriptions). Logging it would keep exactly the data we decided not to retain. `payload`,
	 * `plaintext` and `secret` are already risky names, so this adds a scan target, not a rule.
	 */
	files.push(join(REPO, "apps", "api", "src", "services", "moderation.ts"));
	files.push(
		join(REPO, "apps", "api", "src", "services", "moderation-capability.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "routes", "moderation.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "reports.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "moderation.ts"));
	/**
	 * Also scans the notification path. Notifications hold no content, but two spots can break that:
	 * joined story titles and actor nicknames, and moderation public reasons. A diagnostic line saying
	 * who followed whom would keep data we decided not to retain, and it produces no symptom until an
	 * incident. The browser copy assembly is scanned too.
	 */
	files.push(join(REPO, "apps", "api", "src", "services", "notifications.ts"));
	files.push(
		join(REPO, "apps", "api", "src", "routes", "me", "notifications.ts"),
	);
	/** The app-update announcement joins the same net: that path sweeps every member in one statement, so "log who we sent to" is a strong temptation and would record the member roster. */
	files.push(
		join(
			REPO,
			"apps",
			"api",
			"src",
			"services",
			"admin",
			"app-update-notice.ts",
		),
	);
	walk(join(REPO, "apps", "web", "src", "features", "notifications"));
	/** Browser-side moderation is scanned for the same reason (the console leaks wider than server logs). */
	walk(join(REPO, "apps", "web", "src", "features", "moderation"));
	/**
	 * Also scans the browser side: with BYO, credentials and prompts take a path that never crosses
	 * the server, so the rule binds client code too. The console can be worse than server logs
	 * (extensions read it, error reporters collect breadcrumbs, users share screenshots). These two
	 * folders have no `.tsx` because the screen-facing port has no method reading secrets
	 * (`local-provider/store.ts`); the `walk` above would include one if it appeared.
	 */
	walk(join(REPO, "apps", "web", "src", "lib", "local-provider"));
	walk(join(REPO, "apps", "web", "src", "lib", "generation"));
	/** Also scans the sync path: recovery, pairing and unlock codes pass through `features/sync`, and DEK wrapping, keyring relay and plaintext pull/push through `lib/local-sync`. These were missing while the BYO path was scanned from the start. */
	walk(join(REPO, "apps", "web", "src", "features", "sync"));
	walk(join(REPO, "apps", "web", "src", "lib", "local-sync"));
	files.push(join(REPO, "apps", "api", "src", "services", "sync", "wake.ts"));
	/**
	 * Also scans the managed generation path, which holds prompts and model responses. The easiest way
	 * to break the promise that the server does not store conversations is logging "what passes
	 * through" here, and that line produces no symptom until an incident.
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "generation", "chat.ts"),
	);
	/**
	 * Also scans the membership-eligibility path, which carries a child's birth date (stored nowhere),
	 * the guardian's name and contact (third-party personal data) and the consent link token (bearer
	 * credential for that screen). A logged birth date would become the only copy we keep. The browser
	 * side is scanned too (the console leaks wider than server logs).
	 */
	files.push(join(REPO, "apps", "api", "src", "services", "guardian.ts"));
	/** Also scans where the access log is assembled: request URLs can carry guardian tokens and Better Auth verification tokens, so reverting to the default logger or logging raw URLs breaks this boundary. */
	files.push(join(REPO, "apps", "api", "src", "app.ts"));
	files.push(join(REPO, "apps", "api", "src", "lib", "request-logger.ts"));
	/** Also scans the identity-verification adapter, where the authority's raw answer (including `ci`, `di` and birth date) passes; we use three fields and discard the rest, and a log line would void that decision. */
	walk(join(REPO, "apps", "api", "src", "services", "identity"));
	files.push(join(REPO, "apps", "api", "src", "services", "membership.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "guardian.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "membership.ts"));
	walk(join(REPO, "apps", "web", "src", "features", "onboarding"));
	/**
	 * Also scans the adult-verification path: the server side handles authority references and
	 * results, the browser side performs the handoff (the verification id is in its arguments).
	 * Nothing identifying is stored but values pass through, which invites "log which verification
	 * came". `identityverificationid`, `verifiedcustomer` and `apisecret` are already risky names, so
	 * this adds scan targets, not rules. The handoff helper moved to `lib/identity/`, which is why
	 * this needs its own line (it used to sit under `features/onboarding`).
	 */
	files.push(
		join(REPO, "apps", "api", "src", "services", "adult-verification.ts"),
	);
	files.push(
		join(REPO, "apps", "api", "src", "routes", "me", "adult-verification.ts"),
	);
	walk(join(REPO, "apps", "web", "src", "lib", "identity"));
	/**
	 * Also scans the cover upload path. The values are other people's pictures rather than secrets,
	 * but the temptation is the same: on decode failure, "log what was uploaded" would put image bytes
	 * (or their base64) in server logs. Diagnostics need only story id, member id, claimed format and
	 * byte count, none of which are risky names. `routes/stories/index.ts` is left out on purpose: it
	 * has a legitimate `[stories] play payload contract violation` log whose string trips `payload`, and a scan
	 * that blocks correct code gets the rule disabled or the file dropped.
	 */
	files.push(join(REPO, "apps", "api", "src", "lib", "cover-image.ts"));
	files.push(join(REPO, "apps", "api", "src", "services", "story", "cover.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "stories", "cover.ts"));
	/**
	 * Also scans the shared media pipeline, same reason as covers with a bigger temptation: the
	 * storage adapter invites "log what we tried to write" on failure, and avatars are face photos.
	 * The existing diagnostic logs (`[media] failed to store` etc.) carry only member id, kind, byte count,
	 * stage and error string, none of which are risky names, so the scan passing confirms that
	 * boundary.
	 */
	walk(join(REPO, "apps", "api", "src", "lib", "media"));
	files.push(join(REPO, "apps", "api", "src", "services", "media.ts"));
	files.push(
		join(REPO, "apps", "api", "src", "services", "account", "avatar.ts"),
	);
	files.push(join(REPO, "apps", "api", "src", "routes", "media.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "me", "avatar.ts"));
	/**
	 * Background jobs hold media rows, expired auth tokens and push tokens and run unattended, the
	 * biggest "log what is being processed" temptation. Diagnostics need only our row ids and counts;
	 * tokens and guardian identity are all in `RISKY`.
	 */
	walk(join(REPO, "apps", "api", "src", "jobs"));
	/**
	 * First-run setup: the claim compares the one value that grants admin. `announce.ts` is excluded on
	 * purpose — printing the code to this process's log is how the operator receives it, the same
	 * exception as the dev mail transport. The console's setup screen is scanned too (the code is
	 * typed there).
	 */
	files.push(join(REPO, "apps", "api", "src", "services", "setup", "index.ts"));
	files.push(join(REPO, "apps", "api", "src", "routes", "setup.ts"));
	walk(join(REPO, "apps", "admin", "src", "features", "setup"));

	return files;
}

/** Cuts one call's argument text by bracket balance. Not line by line: multi-line calls are common and a first-line check passes `console.error(\n  "…", dek,\n)`. */
function callArguments(source: string, openIndex: number): string {
	let depth = 0;
	for (let i = openIndex; i < source.length; i++) {
		if (source[i] === "(") depth++;
		else if (source[i] === ")") {
			depth--;
			if (depth === 0) return source.slice(openIndex + 1, i);
		}
	}
	return source.slice(openIndex + 1);
}

/** Comments are not scanned: these files' comments describe those very secrets. */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("static scan for secret logging", () => {
	const files = sourceFiles();

	test("the scan targets actually exist", () => {
		// Guards the worst failure mode: a moved path scanning zero files and passing.
		expect(files.length).toBeGreaterThan(10);
		for (const file of files)
			expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
	});

	test("no secret name appears in logging call arguments", () => {
		const offences: string[] = [];
		for (const file of files) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const match of source.matchAll(SINK)) {
				const args = callArguments(source, match.index + match[0].length - 1);
				const lower = args.toLowerCase();
				for (const name of RISKY)
					if (lower.includes(name))
						offences.push(`${relative(REPO, file)}: ${match[1]}(… ${name} …)`);
			}
		}
		expect(offences).toEqual([]);
	});

	test("paths that fold crypto material into strings never meet logging", () => {
		/** `JSON.stringify` is also on normal paths (envelope assembly, response cache); only one inside a logging call is an offence. */
		const offences: string[] = [];
		for (const file of files) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const match of source.matchAll(SINK)) {
				const args = callArguments(source, match.index + match[0].length - 1);
				if (/JSON\.stringify/.test(args))
					offences.push(
						`${relative(REPO, file)}: JSON.stringify inside logging`,
					);
			}
		}
		expect(offences).toEqual([]);
	});

	test("the scan actually works — it catches a deliberate violation", () => {
		/** Second dangerous failure mode of a static scan: the regex silently matching nothing. A synthetic input confirms detection itself. */
		const bad =
			'export function f(dek: Uint8Array) {\n  console.log("k", dek);\n}\n';
		const source = stripComments(bad);
		const matches = [...source.matchAll(SINK)];
		expect(matches).toHaveLength(1);
		const args = callArguments(
			source,
			matches[0].index + matches[0][0].length - 1,
		);
		expect(args.toLowerCase()).toContain("dek");
	});
});
