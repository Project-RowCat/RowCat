import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Whether the result of a press remains on screen, checked by statically scanning six surfaces. It
 * checks policy, not the styles Motion emits (same rule as lib/motion/*.test.ts). Real movement is
 * verified in a browser. Four mistakes this file guards against. None of them produces an error:
 * - Deriving success from !isPending draws a failed action as a success.
 * - A success mark outlives the value. `Saved` (saved) stays next to an edited value and lies.
 * - Success and failure hold separate state, so a combination where both show at once can be
 *   represented.
 * - Animation holds product state, so an action never finishes in a tab that receives no
 *   animation frames.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const read = (...segments: string[]) =>
	readFileSync(join(WEB_SRC, ...segments), "utf8");

/**
 * Source with comments stripped. Comments in this repo name each rule, so the scan must not match
 * rule names that appear inside them.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("profile save feedback", () => {
	const source = read("features", "account", "profile-section.tsx");
	const clean = code(source);
	/**
	 * The button's answer lives in its own file. The bio, nickname, and pinned-works field
	 * (`pinned-stories-field.tsx`) use the same visual. Two copies would let one side gain the check
	 * mark and widen the other.
	 */
	const saveLabel = code(read("features", "account", "save-label.tsx"));

	/**
	 * The success indicator may turn on only in the mutation's success callback. Using the end of
	 * isPending instead would draw failed saves as successes, and the two could not be told apart on
	 * screen.
	 */
	it("success turns on only from the real success callback", () => {
		const marks = clean.match(/setResult\(\{ kind: "saved" \}\)/g) ?? [];
		// The nickname and bio fields, both.
		expect(marks).toHaveLength(2);
		for (const branch of onSuccessBodies(clean))
			expect(branch).toContain('setResult({ kind: "saved" })');
		expect(clean).not.toMatch(/!\s*(?:mutation\.)?isPending/);
		expect(clean).not.toContain("setTimeout");
	});

	/**
	 * The `Saved` label claims that the text currently in the field has been saved. Changing a single
	 * character makes that false, so an edit clears the mark. The edit itself flips the fact rather
	 * than a timer, so the check also looks at the edit path.
	 */
	it("editing the value clears the success marker", () => {
		const edits = clean.match(/const edit = \(next: string\) => \{/g) ?? [];
		expect(edits).toHaveLength(2);
		expect(
			clean.match(
				/setResult\(\(current\) => \(current\?\.kind === "saved" \? null : current\)\)/g,
			),
		).toHaveLength(2);
		// Both input fields pass through that path. If even one calls setDraft directly, that field goes
		// stale.
		expect(clean).not.toContain("onChange={(event) => setDraft(");
	});

	/**
	 * Starting a new attempt drops the previous result. A failure next to an earlier success would be
	 * a contradiction.
	 */
	it("saving again drops the previous feedback", () => {
		expect(
			clean.match(/setResult\(null\);\n\t\tmutation\.mutate/g),
		).toHaveLength(2);
	});

	/**
	 * Success and failure are one value. Splitting them would allow the state where both hold, and
	 * that state draws two contradictory sentences at once.
	 */
	it("success and failure share one slot", () => {
		expect(clean).toContain("type SaveResult =");
		expect(
			clean.match(/const \[result, setResult\] = useState<SaveResult>/g),
		).toHaveLength(2);
		/*
		 * Failure does not hold its own state. The error text is derived from that one value. (The
		 * `useState<string | null>` on draft holds input text and is unrelated to this rule.)
		 */
		expect(clean).not.toContain("setError(");
		expect(
			clean.match(
				/const error = result\?\.kind === "error" \? result\.message : null/g,
			),
		).toHaveLength(2);
	});

	/**
	 * Success does not interrupt screen readers. Profile saves are frequent, so breaking the reader's
	 * flow each time would be a distraction rather than guidance. Only failure has role="alert".
	 */
	it("the success marker is not an alert", () => {
		const label = saveLabel;
		expect(label).not.toContain("role=");
		expect(label).not.toContain("aria-live");
		expect(clean).toContain('role="alert"');
	});

	/**
	 * Always reserve the icon slot. If the icon appears only on success, the button widens on narrow
	 * screens, and that widening is movement the user's finger has to track.
	 */
	it("the button does not widen on success", () => {
		const label = saveLabel;
		expect(label).toContain("AnimatedIconSwap");
		expect(label).toContain("size-4");
		// The two states without an icon share the same slot. If they were split, every press would swap
		// an empty slot.
		expect(label).toContain('stateKey={state === "saved" ? "saved" : "idle"}');
	});
});

describe("recovery code copy feedback", () => {
	const source = read("features", "sync", "recovery-code-dialog.tsx");
	const clean = code(source);

	/**
	 * The state model stays as is. If failure collapsed into `idle`, it could not be known whether the
	 * press registered.
	 */
	it("holds success and failure in one value", () => {
		expect(clean).toContain('useState<"idle" | "copied" | "failed">');
	});

	/** The glyph swap rhythm must match the copy button on conversation lines. */
	it("uses the same rhythm as copying a conversation row", () => {
		expect(clean).toContain("AnimatedIconSwap");
		expect(clean).toContain(
			'stateKey={copyState === "copied" ? "copied" : "idle"}',
		);
	});

	/**
	 * Failure text states the next step, since the code is drawn just above. It stays inside the
	 * panel, not a toast.
	 */
	it("the failure notice stays in the dialog", () => {
		expect(clean).toContain('t("recoveryCode.copyFailed")');
		expect(clean).toContain('role="alert"');
		expect(clean).toContain("exit={feedbackExit}");
		// Not a toast: this panel stays open after a failure.
		expect(clean).not.toContain("Toast");
	});
});

describe("report receipt feedback", () => {
	const source = read("features", "moderation", "report-dialog.tsx");
	const clean = code(source);

	/**
	 * State comes first. If confirming the receipt and clearing the cache waited for the animation,
	 * neither would happen in a tab that receives no frames.
	 */
	it("confirmation is not delayed behind animation", () => {
		expect(clean).toMatch(/report\(\{[\s\S]*?\}\);\s*\n\s*setDone\(true\);/);
		expect(clean).not.toContain("onAnimationComplete");
		expect(clean).not.toContain("setTimeout");
	});

	/**
	 * The two panes do not overlap. With very different heights, overlap would make the dialog grow
	 * and then shrink.
	 */
	it("faces swap without overlapping", () => {
		expect(clean).toContain('<AnimatePresence initial={false} mode="wait">');
		expect(clean).toContain('<ReportPanel key="done">');
		expect(clean).toContain('<ReportPanel key="form">');
	});

	/**
	 * The outgoing pane contains buttons. Putting the guard on the exit target would never apply in a
	 * tab that receives no frames (see exit-guard.ts).
	 */
	it("the exiting face cannot be pressed", () => {
		const panel = between(clean, "function ReportPanel(", "\nexport function");
		expect(panel).toContain("useExitGuard()");
		expect(panel).toContain("style={exiting}");
		expect(panel).not.toContain("pointerEvents");
	});

	/**
	 * The dialog's margins belong to the grid. Removing them in a wrapper around the pane is a
	 * regression.
	 */
	it("does not change the dialog's padding", () => {
		const panel = between(clean, "function ReportPanel(", "\nexport function");
		expect(panel).toContain('className="grid gap-6"');
	});

	/**
	 * A receipt failure is a sentence that attaches and detaches; this file does not rebuild its
	 * value. mode="wait" must be absent here: DialogFooter sits directly below, so serializing the
	 * exit would delay the button row by a beat even after the error clears. The pane swap above holds
	 * that value, and the test pins that the two AnimatePresence instances are different things.
	 */
	it("failures attach and detach on the shared feedback rhythm", () => {
		const slot = between(
			clean,
			"<AnimatePresence initial={false}>",
			"</AnimatePresence>",
		);
		expect(slot).toContain('key="report-error"');
		expect(slot).toContain('role="alert"');
		expect(slot).toContain("initial={feedbackEnter.initial}");
		expect(slot).toContain("animate={feedbackEnter.animate}");
		expect(slot).toContain("exit={feedbackExit}");
		expect(slot).toContain("transition={feedbackEnter.transition}");
		// Does not rebuild the value at that spot. The rhythm's source is feedback.ts alone.
		expect(slot).not.toMatch(/\by:/);
		expect(slot).not.toMatch(/duration|ease/);
	});
});

describe("appeal receipt feedback", () => {
	const clean = code(read("features", "moderation", "appeal-dialog.tsx"));

	/**
	 * Same rhythm as the report dialog. If the two dialogs picked their own values, the difference
	 * would go unnoticed.
	 */
	it("failures attach and detach on the shared feedback rhythm", () => {
		const slot = between(
			clean,
			"<AnimatePresence initial={false}>",
			"</AnimatePresence>",
		);
		expect(slot).toContain('key="appeal-error"');
		expect(slot).toContain('role="alert"');
		expect(slot).toContain("initial={feedbackEnter.initial}");
		expect(slot).toContain("animate={feedbackEnter.animate}");
		expect(slot).toContain("exit={feedbackExit}");
		expect(slot).toContain("transition={feedbackEnter.transition}");
		expect(slot).not.toMatch(/\by:/);
		expect(slot).not.toMatch(/duration|ease/);
	});

	/** Just above the dialog's bottom edge. A serialized exit delays the button row by a beat. */
	it("exits are not serialized", () => {
		expect(clean).not.toContain('mode="wait"');
	});

	/**
	 * Do not build a success screen. When the server confirms, the invalidation and close happen right
	 * away, and the refreshed parent state is the result. Delaying that close for an animation would
	 * make product state wait on the animation.
	 */
	it("on success the dialog still closes right away", () => {
		expect(clean).toMatch(
			/invalidateQueries\(\{[\s\S]*?\}\);\s*\n\s*onClose\(\);/,
		);
		expect(clean).not.toContain("onAnimationComplete");
		expect(clean).not.toContain("setTimeout");
	});
});

describe("password action feedback", () => {
	const source = read("features", "account", "password-section.tsx");
	const clean = code(source);

	/**
	 * The dialog closes the moment it succeeds. Unmounting is how plaintext leaves the input field, so
	 * the time before close must not grow for animation.
	 */
	it("on success the dialog still closes right away", () => {
		expect(clean).toMatch(
			/setResult\(mode === "set" \? "set" : "changed"\);\s*\n\s*close\(\);/,
		);
		expect(clean).toContain("{open && (");
	});

	/** The password never reaches the parent's state. */
	it("the parent does not hold the password", () => {
		expect(clean).not.toMatch(/useState[^\n]*[Pp]assword/);
		expect(clean).not.toContain("setResult(values");
		expect(clean).not.toContain("newPassword]");
	});

	/**
	 * Do not choose the result sentence from the current mode. When a password is set for the first
	 * time, hasPassword becomes true and mode immediately switches to change, so the user who just set
	 * a password would read "was changed". The operation is recorded at the moment it happens.
	 */
	it("pins which operation it was", () => {
		expect(clean).toContain(
			'const [result, setResult] = useState<"set" | "changed" | null>(null)',
		);
		expect(clean).toContain('t("passwordSection.yourPasswordWasSet")');
		expect(clean).toContain('t("passwordSection.yourPasswordWasChanged")');
	});

	/** Reopening or retrying drops the previous result. */
	it("a previous result does not stay over a new attempt", () => {
		expect(clean.match(/setResult\(null\)/g)).toHaveLength(2);
	});

	/** Failure stays inside the dialog, where the retry happens. */
	it("failure does not close the dialog", () => {
		expect(clean).toMatch(/setError\([^\n]*\);\s*\n\s*return;/);
		expect(clean).not.toContain("setError(null);\n\t\t\t\t\tclose()");
	});
});

describe("mail resend feedback", () => {
	for (const [name, path] of [
		["account screen", ["features", "account", "email-section.tsx"]],
		["verification notice", ["features", "auth", "verification-notice.tsx"]],
	] as const) {
		describe(name, () => {
			const clean = code(read(...path));

			/**
			 * Remaining seconds must not retrigger this transition. Keying on them would run exit and enter
			 * every second: the sentence would flicker, and the live region would be re-read every second.
			 */
			it("the cooldown does not replay the transition", () => {
				expect(clean).toContain('key="sent"');
				expect(clean).not.toMatch(/key=\{`?[^`"]*(?:cooldown|remaining)/);
			});

			/** Failure and success exclude each other. A single slot draws exactly that fact. */
			it("feedback stands in one slot", () => {
				expect(clean).toContain(
					'<AnimatePresence initial={false} mode="wait">',
				);
				expect(clean).toContain("exit={feedbackExit}");
			});

			/**
			 * The live region itself stays mounted. Detaching and reattaching it would make assistive
			 * technology miss the change. What moves is the child inside it.
			 */
			it("presence does not take the live region with it", () => {
				const region = clean.slice(clean.indexOf("<output"));
				expect(region.indexOf("<AnimatePresence")).toBeGreaterThan(0);
				expect(clean).not.toContain("<m.output");
			});

			it("a new attempt clears the previous failure", () => {
				expect(clean).toMatch(/setResendError\(null\)|setError\(null\)/);
			});
		});
	}
});

describe("provider connection feedback", () => {
	const clean = code(read("features", "settings", "provider-connections.tsx"));

	/** The changed line is the success. Adding another toast would put the same fact in two places. */
	it("makes no success toast", () => {
		expect(clean).not.toContain("Toast");
		expect(clean).not.toMatch(/showSuccess|connectedToast/);
	});

	/** Lines neither appear nor disappear. What changes is the word inside the line. */
	it("the status word swaps in place", () => {
		expect(clean).toContain("labelSwapIn");
		expect(clean).toContain('key={connection ? "connected" : "disconnected"}');
		expect(clean).toContain('<AnimatePresence initial={false} mode="wait">');
	});

	/**
	 * The placeholder sits outside the presence. Opening the repository is not an action anyone took,
	 * so an enter animation on that arrival would make the connection status pop up every time
	 * settings open.
	 */
	it("the placeholder gets no entrance", () => {
		const rows = between(
			clean,
			"function ProviderList(",
			"\nfunction ProviderRowActions",
		);
		const skeleton = rows.indexOf("<Skeleton");
		const presence = rows.indexOf("<AnimatePresence");
		expect(skeleton).toBeGreaterThan(-1);
		expect(skeleton).toBeLessThan(presence);
	});

	/** The outgoing action group is not pressable. Everything inside it is a button. */
	it("the exiting action group cannot be pressed", () => {
		const actions = between(
			clean,
			"function ProviderRowActions(",
			"\nfunction DisconnectDialog",
		);
		expect(actions).toContain("useExitGuard()");
		expect(actions).toContain("style={exiting}");
	});

	/**
	 * Buttons do not animate individually. What happened is one thing: this line changed state. Rising
	 * in sequence would make it read as two things happening on that line.
	 */
	it("buttons do not move separately", () => {
		expect(clean).not.toContain("staggerChildren");
		expect(clean).not.toContain("<m.button");
	});
});

describe("appeal feedback", () => {
	const clean = code(
		read("features", "moderation", "account-moderation-section.tsx"),
	);

	/**
	 * What changes after the dialog closes is this cell. Do not record the same fact once more in the
	 * parent.
	 */
	it("the receipt is not stated in two places", () => {
		expect(clean).toContain('t("account.appealPending")');
		expect(clean.match(/account\.appealPending/g)).toHaveLength(1);
		expect(clean).not.toContain("Toast");
	});

	/** The value comes from the list the server returned. Do not draw it optimistically in advance. */
	it("does not draw optimistically", () => {
		expect(clean).toContain("openAppeals.has(item.actionId)");
		expect(clean).not.toContain("setQueryData");
	});

	/**
	 * One branch holds the button. If it is pressed during exit, the one-appeal-per-action rule breaks
	 * and two appeals open.
	 */
	it("the exiting branch cannot be pressed", () => {
		const slot = between(
			clean,
			"function AppealSlot(",
			"\ninterface RestrictionItem",
		);
		expect(slot).toContain("useExitGuard()");
		expect(slot).toContain("style={exiting}");
	});
});

describe("avatar feedback", () => {
	const clean = code(read("features", "account", "avatar-field.tsx"));

	/** The photo itself is the result. A sentence beside it would show the same fact twice. */
	it("adds no success sentence", () => {
		expect(clean).not.toContain("Saved");
		expect(clean).not.toContain("Toast");
	});

	/**
	 * The preview is still a provisional value. On failure it is discarded, and it is never seeded
	 * into the cache as a confirmed value. If transitions disturbed that rule, the screen would show a
	 * photo the server does not have as the result.
	 */
	it("does not promote the preview to confirmed", () => {
		expect(clean).toContain("setPreview(null)");
		expect(clean).toContain("const shownUrl = preview ?? savedUrl");
		expect(clean).not.toContain("setQueryData");
	});

	/**
	 * Identity is whether a picture exists, not the address. Using the address would make an empty
	 * circle appear once when a photo still downloading arrives, creating a symptom that does not
	 * exist today.
	 */
	it("only the picture swaps; the box does not move", () => {
		expect(clean).toContain('key={url ? "image" : "initial"}');
		expect(clean).toContain("col-start-1 row-start-1");
		// The box's geometry is not a transition target.
		expect(clean).not.toContain("layout");
		expect(clean).not.toMatch(/animate=\{\{[^}]*(?:width|height|scale)/);
	});
});

/**
 * Returns the slice from where `from` appears up to `to`, or to the end if `to` is absent. The scan
 * fails if `from` is not found.
 */
function between(source: string, from: string, to: string): string {
	const start = source.indexOf(from);
	expect(start, `${from} not found; the scan is stale`).toBeGreaterThan(-1);
	const rest = source.slice(start);
	const end = rest.indexOf(to);
	return end < 0 ? rest : rest.slice(0, end);
}

/** The onSuccess callback bodies. Used to confirm success is set only there. */
function onSuccessBodies(source: string): string[] {
	const bodies: string[] = [];
	const pattern = /onSuccess: (?:async )?\(\.\.\.args\) => \{/g;
	for (
		let match = pattern.exec(source);
		match !== null;
		match = pattern.exec(source)
	) {
		const rest = source.slice(match.index);
		const end = rest.indexOf("\n\t\t},");
		bodies.push(end < 0 ? rest : rest.slice(0, end));
	}
	expect(bodies.length, "onSuccess not found; the scan is stale").toBe(2);
	return bodies;
}
