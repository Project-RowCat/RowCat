/**
 * Lifetime of one sound: between the creator's desired state and what the platform allows.
 * - Creator props (playing, loop, volume, muted, restartKey, source) go to this controller. It
 *   remembers the desired state and aligns the actual state with it. The browser's media policy has
 *   the final word.
 * - `playing` is a wish, not a fact. Browsers block sound-producing play() until the user
 *   interacts with the page; that refusal arrives as a rejected promise. It is not an error:
 *   neither the creator's code nor ours is at fault, and treating it as a runtime failure would
 *   kill the screen over one sound. So the refusal is remembered as waiting (pendingActivation),
 *   and when a real user interaction arrives (activate()), the waiting playback resumes.
 * - Showing that wait is not this file's job. The renderer reports it (onAudioActivationChange),
 *   and the product shell draws its own 'tap to play' hint. That is host UI, not creator UI.
 * - A narrow interface is used instead of the element so tests can run without real sound.
 *   JSDOM's HTMLAudioElement lacks play(), and even with one, autoplay refusal and natural end
 *   cannot be produced as values. HTMLAudioElement satisfies this shape structurally, so the
 *   product path needs no adapter.
 * - Not here: seek, playback rate, fades, mixing, visualization. They are not in the public
 *   contract, and adding them here first would invite a prop to expose them later.
 */

export interface WebAudioMedia {
	src: string;
	loop: boolean;
	volume: number;
	muted: boolean;
	currentTime: number;
	play(): Promise<void>;
	pause(): void;
	removeAttribute(name: string): void;
	addEventListener(type: "ended", listener: () => void): void;
	removeEventListener(type: "ended", listener: () => void): void;
}

export interface WebAudioControllerOptions {
	readonly media: WebAudioMedia;
	/**
	 * Reports natural end to the creator. Not called while looping. The callback is read at call time
	 * rather than stored as a handler id, because identity matters: if the creator passes a different
	 * function, a new id is issued. A frozen id would keep this controller calling a dead one, and
	 * that event would be dropped as stale.
	 */
	readonly onEnded: () => void;
	/**
	 * Called when playback starts or stops waiting for user permission. The renderer aggregates these
	 * reports.
	 */
	readonly onPendingChange: (pending: boolean) => void;
}

export interface WebAudioController {
	/** What to play with this reference. null means silence: no request is made. */
	setSource(url: string | null): void;
	setPlaying(next: boolean): void;
	setLoop(next: boolean): void;
	setVolume(next: number): void;
	setMuted(next: boolean): void;
	/** A changed value rewinds to the start. Whether playback is active is not changed. */
	setRestartKey(next: string | number | null): void;
	/** A real user interaction arrived. Resumes any playback that was waiting for one. */
	activate(): void;
	/** The document was hidden. Only the actual playback is paused; the desired state is kept. */
	suspend(): void;
	/** The document is visible again. Restores playback to the desired state. */
	resume(): void;
	/** The node is finished. No sound or listener remains. */
	dispose(): void;
	/** For diagnostics and tests: whether playback is waiting for permission right now. */
	readonly pendingActivation: boolean;
}

export function createWebAudioController(
	options: WebAudioControllerOptions,
): WebAudioController {
	const { media } = options;

	/** The creator's desired state. Whatever the platform does, this value changes only from props. */
	let desiredPlaying = false;
	/**
	 * Paused by us because the document was hidden. This is a separate axis from the desired state.
	 */
	let suspended = false;
	/**
	 * Playback reached its natural end. While this is set, the same commit does not restart playback.
	 */
	let ended = false;
	let source: string | null = null;
	let restartKey: string | number | null = null;
	let pending = false;
	let disposed = false;
	let loop = false;

	/**
	 * The number of the currently valid play attempt. play()'s answer is async, and the source may
	 * change or the node may disappear in the meantime. A late rejection could mark the new state as
	 * waiting, and that sound would stay silent until the next interaction. If the number differs, the
	 * answer is discarded.
	 */
	let attempt = 0;

	const setPending = (next: boolean): void => {
		if (pending === next) return;
		pending = next;
		options.onPendingChange(next);
	};

	const start = (): void => {
		if (disposed || suspended || !desiredPlaying || source === null) return;
		/**
		 * Restarting from the ended state starts from zero. Browsers usually rewind on their own, but
		 * relying on that makes the same code sound different per engine.
		 */
		if (ended) {
			media.currentTime = 0;
			ended = false;
		}
		attempt += 1;
		const token = attempt;
		media.play().then(
			() => {
				if (token !== attempt) return;
				setPending(false);
			},
			() => {
				/**
				 * The rejection reason is not distinguished. Autoplay policy, decode failure and network errors
				 * all arrive here, and splitting by name would not change what we do: wait. None of them is a
				 * runtime failure. If the policy was the cause, the user's next interaction resolves it.
				 */
				if (token !== attempt) return;
				setPending(true);
			},
		);
	};

	const stop = (): void => {
		attempt += 1;
		media.pause();
		setPending(false);
	};

	const handleEnded = (): void => {
		/**
		 * During a loop the browser's end is not a true end. With loop on the browser should not emit
		 * this event; if it did, it would mean one cycle finished, not that playback finished. Reporting
		 * both under one name would run the creator's handler on every cycle of looped music.
		 */
		if (disposed || loop) return;
		ended = true;
		setPending(false);
		options.onEnded();
	};

	media.addEventListener("ended", handleEnded);

	return {
		get pendingActivation() {
			return pending;
		},
		setSource(url) {
			if (disposed || url === source) return;
			/**
			 * Stop first, so the old sound does not keep playing under the new source. Also rewind to zero:
			 * if the source changed but the position stayed, that position belongs to the other sound.
			 */
			stop();
			ended = false;
			source = url;
			if (url === null) {
				media.removeAttribute("src");
				media.currentTime = 0;
				return;
			}
			media.src = url;
			media.currentTime = 0;
			start();
		},
		setPlaying(next) {
			if (disposed || next === desiredPlaying) return;
			desiredPlaying = next;
			if (next) start();
			else stop();
		},
		setLoop(next) {
			if (disposed) return;
			loop = next;
			media.loop = next;
		},
		setVolume(next) {
			if (disposed) return;
			media.volume = next;
		},
		setMuted(next) {
			if (disposed) return;
			media.muted = next;
		},
		setRestartKey(next) {
			if (disposed || next === restartKey) return;
			restartKey = next;
			media.currentTime = 0;
			ended = false;
			if (desiredPlaying) start();
		},
		activate() {
			if (disposed || !pending) return;
			start();
		},
		suspend() {
			if (disposed || suspended) return;
			suspended = true;
			/**
			 * Does not touch the desired state. Setting playing to false while hidden would be a decision
			 * the creator never made, and the value needed to restore on show would be lost.
			 */
			attempt += 1;
			media.pause();
		},
		resume() {
			if (disposed || !suspended) return;
			suspended = false;
			start();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			attempt += 1;
			media.removeEventListener("ended", handleEnded);
			media.pause();
			/**
			 * Clearing src is the other half of cleanup. Removing only the element would let the browser
			 * keep a download it already started, and no one would hear those bytes.
			 */
			media.removeAttribute("src");
			setPending(false);
		},
	};
}
