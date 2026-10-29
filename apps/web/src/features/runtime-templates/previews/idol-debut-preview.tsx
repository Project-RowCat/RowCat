import { PreviewFrame, PreviewLine } from "./preview-frame.tsx";

/**
 * Intentionally denser than the other cards. This one shows scope, not layout. A focused template's
 * illustration says 'you learn one thing'; the flagship's says 'this much fits inside one work'.
 */
export function IdolDebutPreview() {
	return (
		<PreviewFrame className="bg-gradient-to-br from-primary/25 via-muted/70 to-muted/60">
			<div className="flex items-center gap-1">
				{["skill", "sync", "buzz", "fit"].map((axis, index) => (
					<div
						key={axis}
						className="flex flex-1 flex-col gap-1 rounded-sm bg-background/70 p-1"
					>
						<div className="h-1 w-2/3 rounded-full bg-foreground/15" />
						<div
							className={
								index === 0
									? "h-1.5 w-3/4 rounded-full bg-primary/70"
									: "h-1.5 w-1/2 rounded-full bg-foreground/30"
							}
						/>
					</div>
				))}
			</div>

			<div className="flex gap-1">
				{["mon", "wed", "fri"].map((slot, index) => (
					<div
						key={slot}
						className="flex flex-1 flex-col gap-1 rounded-sm bg-background/60 p-1"
					>
						<div className="h-1 w-1/3 rounded-full bg-foreground/12" />
						<div
							className={
								index === 2
									? "h-1.5 w-full rounded-full bg-foreground/12"
									: "h-1.5 w-full rounded-full bg-primary/45"
							}
						/>
					</div>
				))}
			</div>

			<div className="flex items-center gap-1">
				{["a", "b", "c", "d", "e"].map((member, index) => (
					<div
						key={member}
						className={
							index < 2
								? "size-2.5 rounded-full bg-primary/60"
								: "size-2.5 rounded-full bg-foreground/20"
						}
					/>
				))}
			</div>

			<div className="mt-auto flex flex-col gap-1.5 rounded-md bg-background/85 p-2">
				<PreviewLine className="h-1.5 bg-primary/60" width="w-1/5" />
				<PreviewLine width="w-full" />
				<PreviewLine width="w-4/5" />
			</div>
		</PreviewFrame>
	);
}
