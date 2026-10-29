import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

export function RelationshipPreview() {
	return (
		<PreviewFrame>
			<div className="flex items-center gap-2 rounded-md bg-background/70 p-2">
				<div className="size-6 rounded-full bg-primary/70" />
				<div className="flex flex-1 flex-col gap-1">
					<PreviewLine className="h-1.5 bg-foreground/30" width="w-1/2" />
					<PreviewLine width="w-1/3" />
				</div>
			</div>
			<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
				<div className="h-full w-3/5 rounded-full bg-primary/70" />
			</div>
			<div className="mt-auto flex flex-col gap-1.5">
				<div className="h-4 rounded-sm bg-foreground/12" />
				<div className="h-4 rounded-sm bg-foreground/12" />
			</div>
		</PreviewFrame>
	);
}
