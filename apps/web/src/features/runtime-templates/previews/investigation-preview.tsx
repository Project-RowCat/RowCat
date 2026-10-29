import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

export function InvestigationPreview() {
	return (
		<PreviewFrame>
			<PreviewLine className="h-1.5 bg-primary/60" width="w-1/3" />
			<PreviewLine className="h-2 bg-foreground/30" width="w-2/3" />
			<div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
				<div className="h-full w-2/5 rounded-full bg-primary/70" />
			</div>
			<div className="mt-auto grid grid-cols-2 gap-1.5">
				<div className="h-6 rounded-sm bg-foreground/15" />
				<div className="h-6 rounded-sm bg-foreground/15" />
				<div className="h-6 rounded-sm bg-foreground/8" />
				<div className="h-6 rounded-sm bg-foreground/8" />
			</div>
		</PreviewFrame>
	);
}
