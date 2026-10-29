import { Button } from "@rowcat/ui-web/components/button";
import type { LucideIcon } from "lucide-react";
import { RuntimeDocsEntryLink } from "#/features/docs/runtime-docs-entry.tsx";
import { RUNTIME_INTRO } from "./runtime-copy.ts";

/**
 * Shown to a draft that has not enabled the runtime. This is an introduction, not an empty editor.
 *
 * Most drafts never enable the runtime, and turning it on is reversible: it does not replace the
 * existing authoring surface. That fact is stated first.
 *
 * Not a landing page. No large title, screenshot, background art, or tier badge. This is still one
 * section of the editor and shares its card with the sections around it. Raising the visual
 * hierarchy here would make this optional feature look bigger than the authoring.
 *
 * The four capabilities say what each one is used for. Do not add generic claims, and do not repeat
 * that no execution engine exists here; the studio preview and the Runtime row say so.
 */
export function RuntimeIntro({
	capabilityIcons,
	onStart,
}: {
	/**
	 * Icons for the four capabilities are passed in by the caller. Keeping them in the copy constant
	 * (runtime-copy.ts) would make that pure module import lucide-react, so a test that checks the
	 * copy as values would also load the icon library.
	 */
	capabilityIcons: readonly LucideIcon[];
	/**
	 * Opens the template gallery. This is where `pending` used to be: the button once started a
	 * transaction and had to be disabled while it ran. It now only opens a window, so there is nothing
	 * to wait for. A disabled state for a wait that no longer exists would be a permanently false
	 * promise.
	 */
	onStart: () => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div>
				<p className="text-sm font-medium">{RUNTIME_INTRO.title}</p>
				<p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
					{RUNTIME_INTRO.body}
				</p>
			</div>

			{/*
			 * The four capabilities. Not wrapped in a card: this section is already a card, and four more
			 * boxes inside it would make three layers of surface (design rule: no border around every
			 * section).
			 */}
			<ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
				{RUNTIME_INTRO.capabilities.map((capability, index) => {
					const Icon = capabilityIcons[index];
					return (
						<li key={capability} className="flex items-center gap-2">
							{Icon && (
								<Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />
							)}
							{capability}
						</li>
					);
				})}
			</ul>

			{/*
			 * Documentation link beside the start button. Some people want to read what this is before
			 * enabling it, and the answer is the doc, not the four sentences in this section. It is not
			 * given the same weight as the button; the primary action remains the single start button.
			 */}
			<div className="flex flex-wrap items-center gap-4">
				<Button onClick={onStart}>{RUNTIME_INTRO.action}</Button>
				<RuntimeDocsEntryLink />
			</div>
		</div>
	);
}
