import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

export function VisualNovelPreview() {
	return (
		<PreviewFrame className="justify-end bg-gradient-to-b from-primary/20 to-muted/60">
			<div className="flex flex-col gap-1.5 rounded-md bg-background/85 p-2">
				<PreviewLine className="h-1.5 bg-primary/60" width="w-1/4" />
				<PreviewLine width="w-full" />
				<PreviewLine width="w-3/4" />
				<div className="mt-1 flex flex-col gap-1">
					<div className="h-3 rounded-sm bg-foreground/12" />
					<div className="h-3 w-4/5 rounded-sm bg-foreground/12" />
				</div>
			</div>
		</PreviewFrame>
	);
}
