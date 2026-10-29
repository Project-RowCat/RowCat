import { APP_NAME } from "@rowcat/domain";
import type {
	CapabilityFact,
	CapabilityGroup,
	CapabilityStatus,
	DoctorReport,
} from "./env-doctor.ts";

/**
 * Renders the diagnosis as text and JSON. The renderer invents no values: anything absent from the
 * report model is absent here, which is what guarantees secrets never reach the output
 * (`env-doctor.ts` header).
 */

const GROUP_LABEL: Record<CapabilityGroup, string> = {
	core: "Core",
	auth: "Auth",
	infra: "Infrastructure",
	mail: "Outgoing mail",
	push: "Native push",
	identity: "Identity verification",
	generation: "Conversation generation",
	membership: "Membership",
};

const GROUP_ORDER: readonly CapabilityGroup[] = [
	"core",
	"auth",
	"infra",
	"mail",
	"push",
	"identity",
	"generation",
	"membership",
];

const STATUS_GLYPH: Record<CapabilityStatus, string> = {
	ready: "✓",
	disabled: "-",
	degraded: "!",
	blocked: "✗",
	invalid: "✗",
	"n/a": "·",
};

/**
 * Hangul takes two terminal columns while `padEnd` counts code units, so the table would misalign.
 * An approximation for alignment only, not exact grapheme width.
 */
function displayWidth(text: string): number {
	let width = 0;
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		width +=
			(code >= 0x1100 && code <= 0x115f) ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe30 && code <= 0xfe6f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0xffe0 && code <= 0xffe6)
				? 2
				: 1;
	}
	return width;
}

const pad = (text: string, width: number): string =>
	text + " ".repeat(Math.max(0, width - displayWidth(text)));

function renderCapability(
	capability: CapabilityFact,
	labelWidth: number,
): string[] {
	const lines = [
		`  ${STATUS_GLYPH[capability.status]} ${pad(capability.label, labelWidth)}  ${capability.summary}`,
	];
	for (const detail of capability.detail)
		lines.push(`      ${pad("", labelWidth)}${detail}`);
	return lines;
}

export function renderDoctorText(report: DoctorReport): string {
	const lines: string[] = [
		`${APP_NAME} config diagnosis`,
		`mode: ${report.mode === "production" ? "production (read as a production deployment)" : "development"}`,
		`config source: ${report.source}`,
		"",
	];

	if (!report.valid) {
		for (const warning of report.warnings) lines.push(`! ${warning}`, "");
		lines.push("✗ the API won't start with this config", "");
		lines.push(report.invalidMessage ?? "");
		return lines.join("\n");
	}

	const labelWidth = Math.max(
		...report.capabilities.map((capability) => displayWidth(capability.label)),
	);

	for (const group of GROUP_ORDER) {
		const capabilities = report.capabilities.filter(
			(capability) => capability.group === group,
		);
		if (capabilities.length === 0) continue;
		lines.push(GROUP_LABEL[group]);
		for (const capability of capabilities)
			lines.push(...renderCapability(capability, labelWidth));
		lines.push("");
	}

	if (report.warnings.length > 0) {
		lines.push("Boot warnings");
		for (const warning of report.warnings) lines.push(`  ! ${warning}`);
		lines.push("");
	}

	if (report.blockers.length > 0) {
		lines.push("States that block a production deployment");
		for (const blocker of report.blockers) {
			const capability = report.capabilities.find(
				(entry) => entry.id === blocker,
			);
			lines.push(
				`  ✗ ${capability?.label ?? blocker} — ${capability?.summary}`,
			);
		}
		lines.push("");
	}

	lines.push(
		"this diagnosis looks at the config's **structure** — it does not check live connections.",
		"SMTP auth, provider keys, PortOne channels and DNS/proxy paths are still checked outside.",
	);

	return lines.join("\n");
}

export function renderDoctorJson(report: DoctorReport): string {
	return `${JSON.stringify(
		{
			mode: report.mode,
			source: report.source,
			valid: report.valid,
			invalidMessage: report.invalidMessage,
			warnings: report.warnings,
			blockers: report.blockers,
			capabilities: Object.fromEntries(
				report.capabilities.map((capability) => [
					capability.id,
					{
						group: capability.group,
						label: capability.label,
						status: capability.status,
						summary: capability.summary,
						detail: capability.detail,
						...(capability.blocksRelease ? { blocksRelease: true } : {}),
					},
				]),
			),
		},
		null,
		2,
	)}\n`;
}
