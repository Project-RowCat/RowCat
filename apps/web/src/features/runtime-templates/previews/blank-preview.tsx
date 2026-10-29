import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

/** Blank project: one file and a few lines of text. The illustration says no more than that. */
export function BlankPreview() {
	return (
		<PreviewFrame className="justify-center">
			<div className="mx-auto flex w-2/3 flex-col gap-2">
				<PreviewLine className="h-2 bg-foreground/30" width="w-2/3" />
				<PreviewLine width="w-full" />
				<PreviewLine width="w-4/5" />
			</div>
		</PreviewFrame>
	);
}
