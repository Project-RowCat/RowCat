#!/usr/bin/env node
// Replace `eas submit -p ios` with a pure-REST upload to App Store Connect using the Build Upload
// API (WWDC25). No EAS submit, no Xcode/altool/Transporter — just HTTP + an App Store Connect API
// key, so this runs anywhere (incl. Linux CI).
//
// `eas build` still produces the signed IPA (decision: keep eas build, replace only the submit
// step). Flow (all authed with an ES256 JWT from the ASC key):
//   1. POST /v1/buildUploads          {cfBundleShortVersionString, cfBundleVersion, platform, app}
//   2. POST /v1/buildUploadFiles      {assetType: ASSET, uti: com.apple.ipa, fileName, fileSize}
//      -> response carries uploadOperations (presigned chunked PUTs)
//   3. PUT each operation's byte range to its url with the given headers
//   4. PATCH /v1/buildUploadFiles/{id} {uploaded: true, sourceFileChecksums}
//      -> the IPA is now on Apple's servers; ASC processing is async, so we stop here
//
// Auth (App Store Connect API key) — App Store Connect > Users and Access > Integrations. Set via
// env or apps/mobile/.env (secrets in CI, never committed):
//   ASC_KEY_ID           Key ID
//   ASC_ISSUER_ID        Issuer ID (UUID)
//   ASC_API_KEY_PATH     path to AuthKey_<KEY_ID>.p8   (local)  \_ one of these
//   ASC_API_KEY_BASE64   base64 of the .p8 contents    (CI)     /
//   ASC_APP_ID           (optional) ASC app id; else resolved from the bundle id
//   ASC_BUNDLE_ID        (optional) defaults to app.config.ts ios.bundleIdentifier
//   EXPO_TOKEN           (CI) expo.dev token, to download the EAS artifact
//
// IPA source (pick one):
//   --path <file>        explicit .ipa (also requires --short-version/--build-version)
//   --build-id <id>      download this EAS build's artifact + version metadata
//   (default)            latest finished iOS store build on EAS
//
// Usage (from apps/mobile; no package script stands in front of it, so the one file below is the
// whole dependency surface):
//   node scripts/submit-ios.mjs                                   # latest EAS build
//   node scripts/submit-ios.mjs --build-id <id>
//   node scripts/submit-ios.mjs --path ios/App.ipa --short-version 0.1.0 --build-version 1
//   node scripts/submit-ios.mjs --dry-run                         # resolve + auth, no upload

import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = resolve(HERE, "..");
const API = "https://api.appstoreconnect.apple.com";

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Minimal .env loader so ASC_* can live in apps/mobile/.env (gitignored); never overrides values
// already present in the environment (CI secrets win).
function loadDotEnv() {
  const p = resolve(MOBILE_DIR, ".env");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--path") args.path = argv[++i];
    else if (a === "--build-id") args.buildId = argv[++i];
    else if (a === "--short-version") args.shortVersion = argv[++i];
    else if (a === "--build-version") args.buildVersion = argv[++i];
    // Release-gate escape hatch for a raw local upload (see the guard in main()).
    else if (a === "--acknowledge-ungated") args.acknowledgeUngated = argv[++i];
    else if (a === "-h" || a === "--help") {
      // The header block is the help text, taken up to the first line that is not a comment. A
      // fixed line count goes stale the next time someone edits the header — and silently: help
      // just starts printing the import statements.
      const lines = readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(1);
      const end = lines.findIndex((l) => !l.startsWith("//"));
      console.log(
        lines
          .slice(0, end === -1 ? lines.length : end)
          .join("\n")
          .replace(/^\/\/ ?/gm, ""),
      );
      process.exit(0);
    } else die(`unknown arg: ${a}`);
  }
  return args;
}

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

// ES256 JWT for the App Store Connect API. exp must be <= 20 min out; iss = issuer, kid = key id,
// aud = appstoreconnect-v1. dsaEncoding ieee-p1363 yields the raw r||s signature JOSE requires
// (node's default is DER, which ASC rejects).
function makeToken({ keyId, issuerId, privateKeyPem }) {
  const key = createPrivateKey(privateKeyPem);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  );
  const payload = b64url(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + 15 * 60,
      aud: "appstoreconnect-v1",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(sig)}`;
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail =
        (j.errors || []).map((e) => `${e.title}: ${e.detail}`).join("; ") ||
        text;
    } catch {}
    die(`ASC API ${method} ${path} -> ${res.status}\n  ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

function eas(subargs) {
  // Prefer a globally installed eas (CI's expo-github-action) over an npx download.
  let bin = "eas";
  let pre = [];
  try {
    execFileSync("eas", ["--version"], { stdio: "ignore" });
  } catch {
    bin = "npx";
    pre = ["--yes", "eas-cli"];
  }
  const out = execFileSync(bin, [...pre, ...subargs], {
    cwd: MOBILE_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function resolveIpaFromEas(buildId) {
  // --json + CI env (no TTY) already force non-interactive on these read commands; the current
  // eas-cli rejects --non-interactive on build:view ("Nonexistent flag").
  const build = buildId
    ? eas(["build:view", buildId, "--json"])
    : eas([
        "build:list",
        "--platform",
        "ios",
        "--status",
        "finished",
        "--distribution",
        "store",
        "--limit",
        "1",
        "--json",
      ]);
  const b = Array.isArray(build) ? build[0] : build;
  if (!b) die("no matching iOS build found on EAS.");
  const url = b.artifacts?.applicationArchiveUrl || b.artifacts?.buildUrl;
  if (!url) die(`EAS build ${b.id} has no downloadable application archive.`);
  return {
    url,
    shortVersion: b.appVersion,
    buildVersion: b.appBuildVersion,
    id: b.id,
  };
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) die(`failed to download IPA: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("node:fs");
  writeFileSync(dest, buf);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();

  // Sanctioned-path guard: this is the lowest-level TestFlight uploader, and the one path that
  // leaves a record of who shipped what is a manual CI workflow (workflow_dispatch names its actor,
  // and GITHUB_ACTIONS is how we recognise it here). The public repository does not ship that
  // workflow — an example lives in `docs/ota/example-workflows.md` for a deployment to adapt. A
  // local run leaves no such record, so it is refused unless the reason is stated out loud.
  //
  // ⚠️ It is a record, not a gate: nothing in this repo verifies that the IPA's commit passed
  // anything. That check used to live in a `verify-provenance.mjs` this repo does not have — see
  // the same note on the ITMS-90111 gate below. --dry-run (no upload) is always allowed.
  if (!args.dryRun && !process.env.GITHUB_ACTIONS && !args.acknowledgeUngated) {
    die(
      'refusing an unrecorded local TestFlight upload. Run it from a CI workflow instead (example: docs/ota/example-workflows.md), or, for an audited emergency, pass --acknowledge-ungated "<reason>".',
    );
  }
  if (args.acknowledgeUngated) {
    console.warn(
      `⚠ unrecorded local upload — reason: ${args.acknowledgeUngated}`,
    );
  }

  const keyId = process.env.ASC_KEY_ID || die("ASC_KEY_ID is required");
  const issuerId =
    process.env.ASC_ISSUER_ID || die("ASC_ISSUER_ID is required");

  let privateKeyPem;
  if (process.env.ASC_API_KEY_BASE64) {
    privateKeyPem = Buffer.from(
      process.env.ASC_API_KEY_BASE64.replace(/\s/g, ""),
      "base64",
    ).toString("utf8");
  } else if (process.env.ASC_API_KEY_PATH) {
    // Nothing expands `~` in a .env value: the loader reads it literally and the key is never
    // found, which surfaces only at submit time — after the archive.
    const keyPath = process.env.ASC_API_KEY_PATH.startsWith("~/")
      ? resolve(homedir(), process.env.ASC_API_KEY_PATH.slice(2))
      : process.env.ASC_API_KEY_PATH;
    if (!existsSync(keyPath)) die(`ASC_API_KEY_PATH not found: ${keyPath}`);
    privateKeyPem = readFileSync(keyPath, "utf8");
  } else {
    die("provide ASC_API_KEY_BASE64 or ASC_API_KEY_PATH (the .p8 key)");
  }

  const token = makeToken({ keyId, issuerId, privateKeyPem });

  // Resolve the IPA path + version metadata.
  let ipaPath;
  let shortVersion = args.shortVersion;
  let buildVersion = args.buildVersion;
  let tmpDir;
  if (args.path) {
    ipaPath = resolve(process.cwd(), args.path);
    if (!existsSync(ipaPath)) die(`IPA not found: ${ipaPath}`);
    if (!shortVersion || !buildVersion) {
      die(
        "--path also needs --short-version and --build-version (must match the IPA's Info.plist)",
      );
    }
  } else {
    const r = resolveIpaFromEas(args.buildId);
    shortVersion = shortVersion || r.shortVersion;
    buildVersion = buildVersion || r.buildVersion;
    if (!shortVersion || !buildVersion)
      die("EAS build metadata is missing appVersion/appBuildVersion");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(resolve(tmpdir(), "rowcat-ipa-"));
    ipaPath = resolve(tmpDir, "app.ipa");
    console.log(
      `↓ downloading EAS artifact (build ${r.id}, v${shortVersion} (${buildVersion}))…`,
    );
    await downloadTo(r.url, ipaPath);
  }

  // ⚠️ There is no ITMS-90111 SDK gate here. It used to spawn a sibling `verify-ios-sdk.mjs`, and
  // that file is not in this repo — spawning a missing one fails *every* upload, so the gate is
  // removed rather than skipped when absent (a gate that passes because its checker is gone is
  // worse than no gate: it reads as verified). The cost is real and asynchronous: App Store Connect
  // answers ITMS-90111 only after the whole IPA is uploaded and processed, so a too-old Xcode/SDK
  // surfaces minutes later and by hand. Bring the checker back together with the gate — not one
  // without the other.

  const fileSize = statSync(ipaPath).size;
  const fileName = `RowCat-${shortVersion}-${buildVersion}.ipa`;

  // Resolve the ASC app id from the bundle id unless given explicitly.
  const bundleId = process.env.ASC_BUNDLE_ID || readAppBundleId();
  let appId = process.env.ASC_APP_ID;
  if (!appId) {
    const apps = await api(
      token,
      "GET",
      `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    );
    appId = apps.data?.[0]?.id;
    if (!appId)
      die(
        `no App Store Connect app found for bundle id ${bundleId} (set ASC_APP_ID?)`,
      );
  }

  console.log(
    `→ ${args.dryRun ? "[dry-run] " : ""}submit ${fileName} (${fileSize} bytes) ` +
      `to app ${appId} (${bundleId}) as v${shortVersion} (${buildVersion})`,
  );
  if (args.dryRun) {
    console.log(
      "dry-run: auth OK, IPA + app resolved. Skipping create/upload/commit.",
    );
    return;
  }

  // 1. Create the build upload.
  const upload = await api(token, "POST", "/v1/buildUploads", {
    data: {
      type: "buildUploads",
      attributes: {
        cfBundleShortVersionString: shortVersion,
        cfBundleVersion: buildVersion,
        platform: "IOS",
      },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  });
  const uploadId = upload.data.id;

  // 2. Reserve the file; the response carries the presigned upload operations.
  const fileRes = await api(token, "POST", "/v1/buildUploadFiles", {
    data: {
      type: "buildUploadFiles",
      attributes: {
        assetType: "ASSET",
        uti: "com.apple.ipa",
        fileName,
        fileSize,
      },
      relationships: {
        buildUpload: { data: { type: "buildUploads", id: uploadId } },
      },
    },
  });
  const fileId = fileRes.data.id;
  const ops = fileRes.data.attributes.uploadOperations || [];
  if (ops.length === 0) die("ASC returned no upload operations");

  // 3. PUT each byte range. Large builds come back as multiple operations.
  const bytes = readFileSync(ipaPath);
  console.log(`↑ uploading ${ops.length} part(s)…`);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const headers = {};
    for (const h of op.requestHeaders || []) {
      // Let undici set these from the body; a stale Content-Length breaks the PUT.
      if (["content-length", "host"].includes(h.name.toLowerCase())) continue;
      headers[h.name] = h.value;
    }
    const res = await fetch(op.url, {
      method: op.method || "PUT",
      headers,
      body: chunk,
    });
    if (!res.ok)
      die(
        `upload part ${i + 1}/${ops.length} failed: ${res.status} ${await res.text()}`,
      );
    console.log(`  part ${i + 1}/${ops.length} ok (${chunk.length} bytes)`);
  }

  // 4. Commit. sourceFileChecksums is optional and ASC rejects a file-level checksum for
  //    multipart uploads (409), so send only `uploaded: true` — each part was already
  //    integrity-checked via the Content-MD5 in its upload headers.
  await api(token, "PATCH", `/v1/buildUploadFiles/${fileId}`, {
    data: {
      type: "buildUploadFiles",
      id: fileId,
      attributes: { uploaded: true },
    },
  });
  // The bytes are on Apple's servers now; ASC processing (TestFlight availability) happens
  // asynchronously on their side, so we finish here instead of polling.
  console.log(
    "✓ uploaded to App Store Connect; it will process the build and it will appear in TestFlight shortly.",
  );
}

// The bundle id is read from `app.config.ts` — this app has no `app.json` (the config is dynamic),
// and writing one to satisfy this function would put a second copy of the bundle id in the repo
// with nothing guarding it. The literal in app.config.ts is the one `src/lib/app-identity.test.ts`
// pins to `@rowcat/domain`'s APP_BUNDLE_ID, so reading it stays on the guarded side of that single
// source. Importing the package instead would mean resolving TypeScript from a plain .mjs, which is
// exactly the dependency this script is meant not to have.
function readAppBundleId() {
  const source = readFileSync(resolve(MOBILE_DIR, "app.config.ts"), "utf8");
  const id = source.match(/bundleIdentifier:\s*"([^"]+)"/)?.[1];
  if (!id)
    die(
      "could not read ios.bundleIdentifier from app.config.ts (set ASC_BUNDLE_ID)",
    );
  return id;
}

main().catch((e) => die(e?.stack || String(e)));