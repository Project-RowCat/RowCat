import { deferredTranslator } from "#/lib/i18n/current.ts";

const tr = deferredTranslator("runtimeStudio");

/**
 * - The single product-status word for the creator runtime, and the promise that word carries.
 * - Kept out of runtime-copy.ts on purpose. The intro (RUNTIME_INTRO) and template card copy are
 *   guarded by value against `Beta` (runtime-boundaries.test.ts, runtime-templates.test.ts). Those
 *   guards block promises that cannot be kept, and a badge inside those sentences would turn a
 *   feature description into a disclaimer.
 * - One value for the studio header, the start gallery, and the public docs. Separate spellings
 *   per surface would give the product three names.
 * - Not on the playback screen: the badge speaks to creators, and a playable work marked `Beta`
 *   would read as unfinished.
 */

/**
 * The easiest mistake is over-promising. The host's artifact check requires an exact
 * RUNTIME_API_VERSION match and the server has no authoring source, so a version bump stops
 * already-published works from opening until creators republish (docs/creator-runtime/player.md).
 * The opposite mistake is equally serious: 'can change at any time' is untrue, since adding changes
 * is the default and raising the version is an irreversible product decision, and it would make
 * creators stop building. What remains are two exact sentences: the current API keeps growing
 * compatibly, and any version bump is announced in advance, never silent.
 */
export const RUNTIME_BETA = {
	/** Visible badge word. The three creator surfaces all read this value. */
	get label() {
		return tr("beta.label");
	},
	/**
	 * A prefix hidden from the screen and read only by assistive tech. The word `Beta` alone does not
	 * say what is in beta: a sighted user reads `Runtime Studio` beside it, but someone navigating
	 * element by element hears only two meaningless characters. Do not use aria-label for this: a
	 * role-less span does not support that attribute, so it may be ignored, which is why the name is
	 * built from body text.
	 */
	get srPrefix() {
		return tr("beta.srPrefix");
	},
	/**
	 * Sentence shown in the docs and gallery. It must stay within the two promises described above.
	 */
	get promise() {
		return tr("beta.promise");
	},
} as const;

/**
 * The name the badge is read by: the hidden prefix joined with the visible word, exactly. It is
 * joined once here so the surfaces, tests, and journeys all point at the same string. Joining it
 * separately in each place would let one stray space break a journey while the badge still looks
 * right.
 */
export const runtimeBetaBadgeLabel = (): string =>
	`${RUNTIME_BETA.srPrefix}${RUNTIME_BETA.label}`;
