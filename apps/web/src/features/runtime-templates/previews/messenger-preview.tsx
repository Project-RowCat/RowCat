import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

export function MessengerPreview() {
	return (
		<PreviewFrame>
			<div className="flex items-center gap-1.5">
				<div className="size-3 rounded-full bg-primary/70" />
				<PreviewLine className="h-1.5" width="w-1/3" />
			</div>
			<div className="flex flex-1 flex-col justify-center gap-1.5">
				<div className="h-3.5 w-2/3 rounded-md rounded-bl-sm bg-foreground/12" />
				<div className="ml-auto h-3.5 w-1/2 rounded-md rounded-br-sm bg-primary/60" />
				<div className="h-3.5 w-3/5 rounded-md rounded-bl-sm bg-foreground/12" />
			</div>
			<div className="flex gap-1">
				<div className="h-2.5 flex-1 rounded-sm bg-foreground/20" />
				<div className="h-2.5 flex-1 rounded-sm bg-foreground/8" />
				<div className="h-2.5 flex-1 rounded-sm bg-foreground/8" />
			</div>
		</PreviewFrame>
	);
}
