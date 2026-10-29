import { Button } from "@rowcat/ui-web/components/button";
import { CircleAlert, FileCode, Play, X } from "lucide-react";
import { RuntimeDocsEntryLink } from "#/features/docs/runtime-docs-entry.tsx";
import { runtimeShortcutLabel } from "./commands/use-shortcuts.ts";
import { RUNTIME_ONBOARDING } from "./runtime-copy.ts";

/**
 * A line shown to first-time users. It does not block the workspace.
 *
 * It sits as one line under the header; closing it ends it, and it does not reappear on this
 * device. It is not a window, an overlay, or a step tour. The editor, explorer, and preview stay
 * usable while it is shown.
 *
 * Only one of the three hints is a press target: the entry file. The other two point to where
 * things are. The Run button is already at the top right and `Problems` is a bottom-panel tab, so
 * making them buttons here would create a second place for the same action. Run gets a key name
 * instead, since it is the most-used key here and a tooltip only shows on hover.
 *
 * On narrow screens it wraps rather than hiding, because first-time users need it most there.
 */
export function RuntimeOnboardingStrip({
	entry,
	onOpenEntry,
	onDismiss,
}: {
	entry: string;
	/**
	 * Opens the entry file. When there is no entry file this is `null`, and the sentence is shown as
	 * plain text. A button for a missing file would do nothing when pressed (the Runtime row makes the
	 * same decision).
	 */
	onOpenEntry: (() => void) | null;
	onDismiss: () => void;
}) {
	return (
		<aside
			/*
			 * A name is needed for the region to count as a landmark. It is the same value as the first
			 * visible word: other wording would give sighted users and screen-reader users different names
			 * for it.
			 */
			aria-label={RUNTIME_ONBOARDING.title}
			className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-accent/40 px-3 py-2 text-xs"
		>
			<span className="font-medium">{RUNTIME_ONBOARDING.title}</span>

			{onOpenEntry === null ? (
				<Step icon={FileCode}>{RUNTIME_ONBOARDING.edit(entry)}</Step>
			) : (
				<button
					type="button"
					className="inline-flex items-center gap-1.5 rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onClick={onOpenEntry}
				>
					<FileCode aria-hidden="true" className="size-3.5 shrink-0" />
					{RUNTIME_ONBOARDING.edit(entry)}
				</button>
			)}

			<Step icon={Play}>
				{RUNTIME_ONBOARDING.run}
				<span className="ms-1.5 font-mono text-[11px]">
					{runtimeShortcutLabel("Enter")}
				</span>
			</Step>
			<Step icon={CircleAlert}>{RUNTIME_ONBOARDING.problems}</Step>

			<RuntimeDocsEntryLink />

			{/*
			 * Close sits at the right edge. As an icon button it has no visible name, so `aria-label` says
			 * what it does (`Dismiss guide`). The label is not just `Close` because this screen already has a
			 * `Close` (the tab row).
			 */}
			<Button
				variant="ghost"
				size="icon"
				className="ms-auto size-6"
				aria-label={RUNTIME_ONBOARDING.dismiss}
				title={RUNTIME_ONBOARDING.dismiss}
				onClick={onDismiss}
			>
				<X className="size-3.5" />
			</Button>
		</aside>
	);
}

function Step({
	icon: Icon,
	children,
}: {
	icon: typeof Play;
	children: React.ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground">
			<Icon aria-hidden="true" className="size-3.5 shrink-0" />
			{children}
		</span>
	);
}
