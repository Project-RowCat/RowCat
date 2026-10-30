import type {
	DeploymentCapabilityDto,
	DeploymentCapabilityGroup,
	DeploymentCapabilityStatus,
	DeploymentReadinessDto,
} from "@rowcat/contracts";
import { Badge } from "@rowcat/ui-web/components/badge";

/**
 * What this deployment can do, as the API's `env:doctor` sees its own environment.
 *
 * States and variable names only — the response carries no values, so there is nothing here to
 * redact. For the specifics (which host, which origin) the footer points at the CLI, which reads
 * the same report.
 *
 * Variables are shown only for capabilities that are not ready. On a ready row they are noise; on
 * an off row they are the answer to "what do I set".
 */

const GROUP_LABEL: Record<DeploymentCapabilityGroup, string> = {
	core: "Core",
	auth: "Sign-in",
	infra: "Infrastructure",
	mail: "Mail",
	push: "Push",
	identity: "Identity verification",
	generation: "AI generation",
	membership: "Membership",
};

const GROUP_ORDER = Object.keys(GROUP_LABEL) as DeploymentCapabilityGroup[];

const STATUS_BADGE: Record<
	DeploymentCapabilityStatus,
	{ label: string; variant: "secondary" | "outline" | "destructive" }
> = {
	ready: { label: "Ready", variant: "secondary" },
	disabled: { label: "Off", variant: "outline" },
	degraded: { label: "Degraded", variant: "outline" },
	blocked: { label: "Blocked", variant: "destructive" },
	invalid: { label: "Invalid", variant: "destructive" },
	"n/a": { label: "N/A", variant: "outline" },
};

function CapabilityRow({
	capability,
}: {
	capability: DeploymentCapabilityDto;
}) {
	const badge = STATUS_BADGE[capability.status];
	const showVariables =
		capability.status !== "ready" && capability.status !== "n/a";
	return (
		<li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
			<div className="min-w-0 flex-1">
				<p className="text-sm">{capability.label}</p>
				{showVariables ? (
					<p className="mt-0.5 break-words font-mono text-muted-foreground text-xs">
						{capability.variables.join(" · ")}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{capability.blocksRelease ? (
					<Badge variant="destructive">Blocks production</Badge>
				) : null}
				<Badge variant={badge.variant}>{badge.label}</Badge>
			</div>
		</li>
	);
}

export function ReadinessList({ data }: { data: DeploymentReadinessDto }) {
	const groups = GROUP_ORDER.map((group) => ({
		group,
		items: data.capabilities.filter((item) => item.group === group),
	})).filter((entry) => entry.items.length > 0);

	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-xs">
				Read from the API's environment ({data.mode}). Values aren't shown here;
				set variables in the API's environment and restart it.
			</p>
			{groups.map(({ group, items }) => (
				<section key={group} aria-labelledby={`readiness-${group}`}>
					<h3
						id={`readiness-${group}`}
						className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
					>
						{GROUP_LABEL[group]}
					</h3>
					<ul className="divide-y divide-border">
						{items.map((capability) => (
							<CapabilityRow key={capability.id} capability={capability} />
						))}
					</ul>
				</section>
			))}
			<p className="text-muted-foreground text-xs">
				For the full report, including what each state means, run{" "}
				<code className="font-mono">
					pnpm env:doctor --mode production --file &lt;env file&gt;
				</code>
				. The guide is{" "}
				<code className="font-mono">docs/ops/CONFIGURATION.md</code>.
			</p>
		</div>
	);
}
