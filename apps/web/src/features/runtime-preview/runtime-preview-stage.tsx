import { cn } from "@rowcat/ui-web/lib/utils";
import { runtimeDocsCopy } from "#/features/docs/runtime-docs-copy.ts";
import { RuntimeDocsEntryLink } from "#/features/docs/runtime-docs-entry.tsx";
import { RuntimeAudioActivation } from "#/features/runtime-audio/runtime-audio-activation.tsx";
import type { PreviewErrorFrame, PreviewFailure } from "./protocol.ts";
import { RUNTIME_PREVIEW } from "./runtime-preview-copy.ts";
import type { PreviewRootError } from "./runtime-preview-state.ts";
import { RuntimePreviewSurface } from "./runtime-preview-surface.tsx";
import type { RuntimePreview } from "./use-runtime-preview.ts";

/**
 * The face where executed code is shown: the element the renderer attaches to, and the status lines
 * over it.
 *
 * Controls (`Run`, `Restart`, `Stop`, `Reset`, the AI toggle) are not here. Each surface places and words
 * them differently.
 *
 * The status lines (`not run yet`, `compiling`, `starting`, `creator exception`, `our failure`, `autoplay blocked`) are the same
 * on every surface, so they must not be duplicated per surface.
 *
 * A creator render exception is drawn over the previous screen, since the VM commits no new tree.
 * Clearing it would drop that atomicity. A renderer, worker or VM failure stops the screen and
 * requires a restart. One message for both would lead creators to fix platform failures in their
 * own code.
 */
/**
 * Fires when a creator stack line is clicked, to open that source position. Only the studio
 * provides this path; other surfaces show the stack as plain text.
 */
export type OpenRuntimeSource = (frame: PreviewErrorFrame) => void;

export function RuntimePreviewStage({
	preview,
	onOpenSource,
}: {
	preview: RuntimePreview;
	onOpenSource?: OpenRuntimeSource;
}) {
	const { state } = preview;
	const surfaceHidden =
		state.status === "idle" ||
		state.status === "compiling" ||
		state.status === "starting" ||
		(state.status === "failed" && state.failure.stage !== "runtime");

	return (
		<div className="relative min-h-0 flex-1 bg-muted/30">
			{/*
			 * The element is always mounted, whatever the state. Mounting and unmounting by state would leave
			 * late patch batches with no target. When the renderer mounts again, its revision counter returns
			 * to 0 and the next batch would be rejected.
			 */}
			<RuntimePreviewSurface
				attach={preview.attachSurface}
				hidden={surfaceHidden}
			/>
			{/*
			 * Shown only when browser autoplay blocks sound. This sits outside the creator's work (see §52).
			 * The preview uses the same audio handling as product playback. If only the preview were lenient,
			 * sound heard while authoring would go silent after publishing.
			 */}
			<RuntimeAudioActivation
				required={preview.audioActivationRequired}
				onActivate={preview.activateAudio}
			/>
			{state.status === "idle" && (
				<Overlay>
					<p className="text-sm font-medium">{RUNTIME_PREVIEW.idleTitle}</p>
					<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
						{preview.eligible
							? RUNTIME_PREVIEW.idleBody
							: RUNTIME_PREVIEW.notEligible}
					</p>
					{/*
					 * Explains, before the first run, what `Run`, `Restart`, `Reset play` and the AI toggle do.
					 * Not drawn while running, when this spot shows the creator's own screen.
					 */}
					<RuntimeDocsEntryLink
						slug="preview-and-publish"
						label={runtimeDocsCopy().previewGuide}
						className="mt-3"
					/>
				</Overlay>
			)}
			{(state.status === "compiling" || state.status === "starting") && (
				<Overlay>
					<p className="text-xs text-muted-foreground">
						{state.status === "compiling"
							? RUNTIME_PREVIEW.compiling
							: RUNTIME_PREVIEW.starting}
					</p>
				</Overlay>
			)}
			{state.status === "failed" && (
				<FailurePanel failure={state.failure} onOpenSource={onOpenSource} />
			)}
			{state.status === "running" && state.rootError !== null && (
				<RootErrorNotice
					rootError={state.rootError}
					onOpenSource={onOpenSource}
				/>
			)}
		</div>
	);
}

function Overlay({ children }: { children: React.ReactNode }) {
	return (
		<div className="absolute inset-0 flex items-center justify-center p-6">
			<div className="max-w-[22rem] text-center">{children}</div>
		</div>
	);
}

/**
 * A creator failure, drawn over the previous screen. The component chain is indented, e.g. `App ›
 * Counter`. Host paths, worker stacks and engine internals never reach here; the worker strips them
 * first.
 */
function RootErrorNotice({
	rootError,
	onOpenSource,
}: {
	rootError: PreviewRootError;
	onOpenSource?: OpenRuntimeSource;
}) {
	const title =
		rootError.work === "render"
			? RUNTIME_PREVIEW.renderError
			: rootError.work === "effects"
				? RUNTIME_PREVIEW.effectError
				: RUNTIME_PREVIEW.eventError;
	return (
		<div
			role="alert"
			className="absolute inset-x-2 bottom-2 rounded-md border border-destructive/40 bg-background/95 p-3 text-xs shadow-sm"
		>
			<p className="font-medium text-destructive">{title}</p>
			<ErrorBody error={rootError.error} onOpenSource={onOpenSource} />
			<p className="mt-1.5 text-muted-foreground">
				{RUNTIME_PREVIEW.previousKept}
			</p>
		</div>
	);
}

/**
 * Each row of the component chain. The key is the path from the root, since one name can occur at
 * two depths (recursive components). Position indices are not keys.
 */
const componentPaths = (
	stack: readonly string[],
): { path: string; name: string; depth: number }[] =>
	stack.map((name, depth) => ({
		path: stack.slice(0, depth + 1).join(" > "),
		name,
		depth,
	}));

function ErrorBody({
	error,
	onOpenSource,
}: {
	error: PreviewRootError["error"];
	onOpenSource?: OpenRuntimeSource;
}) {
	return (
		<>
			<p className="mt-1 break-words font-mono">
				{error.name}: {error.message}
			</p>
			{error.code !== null && (
				<p className="mt-1 font-mono text-muted-foreground">{error.code}</p>
			)}
			{/*
			 * The creator's stack in source coordinates (the worker mapped it back with the source map).
			 * Clicking a line jumps there. Lines that could not be mapped show only the file name and are not
			 * clickable. On surfaces without an editor, every line is plain text.
			 */}
			{error.frames.length > 0 && (
				<ol className="mt-1.5 font-mono text-muted-foreground">
					{error.frames.map((frame, index) => {
						const location =
							frame.line !== null
								? `${frame.path}:${frame.line}${frame.column !== null ? `:${frame.column}` : ""}`
								: frame.path;
						const label = frame.functionName
							? `${frame.functionName} (${location})`
							: location;
						const key = `${index}:${location}:${frame.functionName ?? ""}`;
						return (
							<li key={key}>
								{onOpenSource && frame.line !== null ? (
									<button
										type="button"
										className="rounded-sm text-start underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										onClick={() => onOpenSource(frame)}
									>
										{label}
									</button>
								) : (
									label
								)}
							</li>
						);
					})}
				</ol>
			)}
			{error.componentStack.length > 0 && (
				<ol className="mt-1.5 font-mono text-muted-foreground">
					{componentPaths(error.componentStack).map((frame) => (
						<li
							key={frame.path}
							style={{ paddingInlineStart: `${frame.depth * 0.75}rem` }}
						>
							{frame.name}
						</li>
					))}
				</ol>
			)}
		</>
	);
}

/**
 * A failure that stopped the preview; it requires a restart.
 *
 * Compile failures list diagnostics. The same messages also appear under `Problems`. The worker is
 * the final authority, so an error the studio missed can show up here.
 *
 * Runtime fatal failures (budget, memory, engine) and renderer failures are platform facts, not
 * code the creator can fix. The fix is a new session.
 */
function FailurePanel({
	failure,
	onOpenSource,
}: {
	failure: PreviewFailure;
	onOpenSource?: OpenRuntimeSource;
}) {
	return (
		<div
			role="alert"
			className={cn(
				"absolute inset-x-2 bottom-2 rounded-md border border-destructive/40 bg-background/95 p-3 text-xs shadow-sm",
				failure.stage === "compile" && "top-2 overflow-auto",
			)}
		>
			{failure.stage === "compile" ? (
				<>
					<p className="font-medium text-destructive">
						{RUNTIME_PREVIEW.failedCompile}
					</p>
					<ul className="mt-1.5 flex flex-col gap-1">
						{failure.diagnostics.map((diagnostic) => (
							<li
								key={`${diagnostic.code}:${diagnostic.path ?? ""}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.message}`}
								className="break-words"
							>
								<span className="text-muted-foreground">
									{diagnostic.path ?? ""}
									{diagnostic.line !== undefined ? `:${diagnostic.line}` : ""}
								</span>{" "}
								{diagnostic.message}
							</li>
						))}
					</ul>
				</>
			) : failure.stage === "start" || failure.stage === "runtime" ? (
				<>
					<p className="font-medium text-destructive">
						{failure.stage === "start"
							? RUNTIME_PREVIEW.failedStart
							: RUNTIME_PREVIEW.failedRuntime}
					</p>
					<ErrorBody error={failure.error} onOpenSource={onOpenSource} />
					{failure.stage === "runtime" && (
						<p className="mt-1.5 text-muted-foreground">
							{RUNTIME_PREVIEW.failedRuntimeBody}
						</p>
					)}
				</>
			) : (
				<>
					<p className="font-medium text-destructive">
						{failure.stage === "renderer"
							? RUNTIME_PREVIEW.failedRenderer
							: RUNTIME_PREVIEW.failedWorker}
					</p>
					<p className="mt-1 break-words font-mono">{failure.message}</p>
					<p className="mt-1.5 text-muted-foreground">
						{RUNTIME_PREVIEW.failedRendererBody}
					</p>
				</>
			)}
		</div>
	);
}
