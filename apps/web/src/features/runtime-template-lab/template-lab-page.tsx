import {
	instantiateRuntimeTemplate,
	RUNTIME_TEMPLATES,
	type RuntimeTemplateId,
} from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { RuntimePreviewSurface } from "#/features/runtime-preview/runtime-preview-surface.tsx";
import { useRuntimePreview } from "#/features/runtime-preview/use-runtime-preview.ts";
import { resolveWebRuntimeAsset } from "#/lib/runtime-assets/web-asset-resolver.ts";

/**
 * Starter template lab: all six templates in one place, shown at two widths.
 *
 * The public beta checklist has two lines that need manual checks
 * (`docs/creator-runtime/public-beta.md` §3): the six starter templates look right on a wide
 * screen, and on a narrow screen (playback). The product path requires creating a new draft for
 * each template, opening the studio, and pressing run. The gallery only appears when the runtime is
 * first enabled (`runtime-templates/`), so six templates would mean six repetitions, and those
 * checks kept being deferred.
 *
 * The lab reduces only setup, not the run path. It uses the product's preview worker: the same
 * compiler, QuickJS host, and renderer (`useRuntimePreview`). The source is exactly what the
 * product writes into a draft (`instantiateRuntimeTemplate`). Copying templates here would prove
 * the copy, not the product.
 *
 * The gallery rule still holds. The product's template gallery must not run creator code while
 * drawing cards, because five VMs would start on one screen and opening the gallery would load the
 * compiler and WASM. The lab runs at most one VM, chosen by the person. This page is not in the
 * production bundle.
 *
 * Width is the axis. `390px` is the narrow reference width for this repo (`/visual-lab` uses the
 * same value). It is not a real device, but clipping, overflow, and unreachable controls show up at
 * that width. Real-device frames and performance remain manual checks.
 */

/** Narrow-width reference. Same value as `/visual-lab`. */
const NARROW_WIDTH = 390;

export function RuntimeTemplateLabPage() {
	const [templateId, setTemplateId] = useState<RuntimeTemplateId>(
		RUNTIME_TEMPLATES[0]?.id ?? "blank",
	);
	const [narrow, setNarrow] = useState(false);

	const template =
		RUNTIME_TEMPLATES.find((entry) => entry.id === templateId) ??
		RUNTIME_TEMPLATES[0];

	/** The same values the product writes into a draft. Ordering is also done by the same function. */
	const snapshot = useMemo(() => {
		const starter = instantiateRuntimeTemplate(template);
		/**
		 * Managed images belong to the draft and are not in the lab. Logical names become placeholders.
		 */
		return { entry: starter.entry, files: starter.files, assets: [] };
	}, [template]);

	const preview = useRuntimePreview({
		snapshot,
		/** The lab has no check status. The final authority is the worker's full compile in any case. */
		eligible: true,
		/** AI is not part of this lab. Browsing templates must not turn into paid generation requests. */
		generation: null,
		resolveAsset: resolveWebRuntimeAsset,
	});

	/**
	 * Runs the selected template immediately. This screen's only purpose is to show how that template
	 * looks. The last-run id is kept in a ref because `run` may be a new function on every render.
	 * Changing the width is not a run: the running session stays, and only the box is narrowed.
	 */
	const ranRef = useRef<string | null>(null);
	const { run } = preview;
	useEffect(() => {
		if (ranRef.current === template.id) return;
		ranRef.current = template.id;
		run();
	}, [template.id, run]);

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 bg-background p-6 text-foreground">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Starter template lab</h1>
				<p className="text-muted-foreground text-sm">
					Runs on the same compiler, VM and renderer as the product preview.
					Development builds only.
				</p>
			</header>

			{/*
			 * The picker uses plain buttons with `aria-pressed`, the same choice the product's template
			 * gallery made. `role="radiogroup"` brings roving tabindex and arrow-key movement with it.
			 * Implementing half of that would be worse for assistive-technology users.
			 */}
			<div className="flex flex-wrap gap-2">
				{RUNTIME_TEMPLATES.map((entry) => (
					<Button
						key={entry.id}
						type="button"
						size="sm"
						variant={entry.id === template.id ? "default" : "outline"}
						aria-pressed={entry.id === template.id}
						onClick={() => setTemplateId(entry.id)}
					>
						{entry.name}
					</Button>
				))}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant={narrow ? "default" : "outline"}
					aria-pressed={narrow}
					onClick={() => setNarrow((value) => !value)}
				>
					{`Narrow width (${NARROW_WIDTH}px)`}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => preview.restart()}
				>
					Restart
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => preview.resetPlaythrough()}
				>
					Reset play
				</Button>
				<p
					aria-live="polite"
					className="text-muted-foreground text-sm"
					data-testid="template-lab-status"
				>
					{`${template.id} · ${preview.state.status}`}
					{preview.state.status === "failed"
						? ` · failed (${preview.state.failure.stage})`
						: ""}
				</p>
			</div>

			{/*
			 * The box has a border so overflow is visible. A template spilling past its width only stands
			 * out if the boundary is drawn.
			 */}
			<div
				className="h-[640px] overflow-hidden rounded-lg border"
				style={narrow ? { width: NARROW_WIDTH } : undefined}
			>
				<RuntimePreviewSurface attach={preview.attachSurface} hidden={false} />
			</div>
		</div>
	);
}
