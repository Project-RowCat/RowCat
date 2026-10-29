import { deferredTranslator } from "#/lib/i18n/current.ts";
import type { RuntimePreviewStatus } from "./runtime-preview-state.ts";

const tr = deferredTranslator("runtimePreview");

/**
 * Wording for the preview, kept in one place and guarded by tests.
 *
 * Status words must not claim more than the fact. `running` only means the VM has set up its root;
 * it does not promise performance, correctness, or publishability. 'Stale' means one thing: the
 * current view shows the previous code.
 */
export const RUNTIME_PREVIEW = {
	title: "Preview",
	get run() {
		return tr("preview.run");
	},
	get restart() {
		return tr("preview.restart");
	},
	get stop() {
		return tr("preview.stop");
	},
	/**
	 * Resetting the playthrough is a different operation from restarting, and the label and hint must
	 * say so. If the two looked the same, or were attached together without confirmation, someone who
	 * restarts because a response disappointed them would erase their own progress. Restart only
	 * rebuilds the VM and carries over saved state.
	 */
	get resetPlaythrough() {
		return tr("preview.resetPlaythrough");
	},
	get resetPlaythroughHint() {
		return tr("preview.resetPlaythroughHint");
	},
	/**
	 * Resetting persistent state is for creators and debugging, and clears only preview memory. It
	 * must not share a button with the playthrough reset. Replaying a run is a common action; if it
	 * also cleared the unlocks from several runs, it would undo the reason persistent state exists.
	 */
	get resetPersistent() {
		return tr("preview.resetPersistent");
	},
	get resetPersistentHint() {
		return tr("preview.resetPersistentHint");
	},
	/** Same operation as restart, shown after a failure. The label names the destination. */
	get restartAfterFailure() {
		return tr("preview.restartAfterFailure");
	},
	get idleTitle() {
		return tr("preview.idleTitle");
	},
	get idleBody() {
		return tr("preview.idleBody");
	},
	get notEligible() {
		return tr("preview.notEligible");
	},
	get compiling() {
		return tr("preview.compiling");
	},
	get starting() {
		return tr("preview.starting");
	},
	get stopping() {
		return tr("preview.stopping");
	},
	get stale() {
		return tr("preview.stale");
	},
	get staleBody() {
		return tr("preview.staleBody");
	},
	get renderError() {
		return tr("preview.renderError");
	},
	get effectError() {
		return tr("preview.effectError");
	},
	get eventError() {
		return tr("preview.eventError");
	},
	/**
	 * Copy for failure states. After a render failure the last rendered screen is still visible, and
	 * this text says so: nothing was cleared.
	 */
	get previousKept() {
		return tr("preview.previousKept");
	},
	get failedCompile() {
		return tr("preview.failedCompile");
	},
	get failedStart() {
		return tr("preview.failedStart");
	},
	get failedRuntime() {
		return tr("preview.failedRuntime");
	},
	get failedRenderer() {
		return tr("preview.failedRenderer");
	},
	get failedWorker() {
		return tr("preview.failedWorker");
	},
	get failedRuntimeBody() {
		return tr("preview.failedRuntimeBody");
	},
	get failedRendererBody() {
		return tr("preview.failedRendererBody");
	},
	get consoleEmpty() {
		return tr("preview.consoleEmpty");
	},
	get consoleClear() {
		return tr("preview.consoleClear");
	},
	consoleDropped: (count: number) => tr("preview.consoleDropped", { count }),
	get diagnosticLabel() {
		return tr("preview.diagnosticLabel");
	},
	get stateEmpty() {
		return tr("preview.stateEmpty");
	},
	/**
	 * Names for the two lifetimes. They are the reason the state list is drawn as two groups. In one
	 * merged list, a key present in both lifetimes (which is normal) would be ambiguous, and the
	 * screen could not show which rows `Reset play` clears.
	 */
	statePlaythrough: "Playthrough State",
	statePersistent: "Persistent State",
	get statePlaythroughHint() {
		return tr("preview.statePlaythroughHint");
	},
	get statePersistentHint() {
		return tr("preview.statePersistentHint");
	},
	/**
	 * States this memory's lifetime honestly. Saying 'saved' would make someone who refreshes the
	 * browser lose their progress, a promise this preview never made.
	 */
	get stateScope() {
		return tr("preview.stateScope");
	},
	stateVersion: (version: number) => `v${version}`,
	/**
	 * The AI toggle. Its label says that turning it on or off is the condition for the next run. The
	 * label does not describe current state, because a running session's capability does not change
	 * when the toggle moves. A label like `AI on` would hide why the session still fails after
	 * enabling it.
	 */
	get generationToggle() {
		return tr("preview.generationToggle");
	},
	get generationHint() {
		return tr("preview.generationHint");
	},
	/** Enabled, but the running session started without the capability, so it must be restarted. */
	get generationPending() {
		return tr("preview.generationPending");
	},
	get generationActive() {
		return tr("preview.generationActive");
	},
} as const;

export const RUNTIME_EXECUTION_LABEL: Record<RuntimePreviewStatus, string> = {
	idle: "idle",
	compiling: "compiling",
	starting: "starting",
	running: "running",
	stopping: "stopping",
	failed: "failed",
};
