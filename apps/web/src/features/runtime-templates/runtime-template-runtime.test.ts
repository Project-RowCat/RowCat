import { RUNTIME_TEMPLATES, type RuntimeTemplate } from "@rowcat/authoring";
import { afterEach, describe, expect, it } from "vitest";
import {
	compileTemplate,
	disposeMountedTemplates,
	type FakeGeneration,
	fakeGeneration,
	mountTemplate,
} from "#/test/runtime-template-harness.ts";

/**
 * The templates actually run: compiler, artifact, QuickJS, reconciler, host tree. Without this file
 * the gallery would hand makers code that does not compile, and that would only surface after the
 * studio opens, so a new user's first screen would show red lines. The registry does not hold
 * examples that only look valid as strings (§41).
 *
 * This is the assembly point. `@rowcat/authoring` does not know the compiler, and if the compiler's
 * weight entered the authoring layer, the server would later repeat the same validation at publish
 * time. Only here can all three packages be imported together. `runtime-path-parity.test.ts` sits
 * here for the same reason.
 *
 * Mount, press, and input wiring live in `#/test/runtime-template-harness.ts`. The flagship test
 * uses the same chain, and two copies would teach one of them differently. The folder's boundary
 * check does not scan test files, so importing the compiler and VM as values is allowed here.
 *
 * This file covers compile and mount for every template, and interaction for the four focused
 * templates. The flagship has its own file because its scenarios (scenes, phone, endings,
 * persistent progress) are long.
 */

const compile = compileTemplate;
const mount = mountTemplate;

afterEach(disposeMountedTemplates);

const every = RUNTIME_TEMPLATES.map(
	(template) => [template.id, template] as const,
);

const templateOf = (id: string): RuntimeTemplate => {
	const found = RUNTIME_TEMPLATES.find((template) => template.id === id);
	if (found === undefined) throw new Error(`no template ${id}`);
	return found;
};

describe("compile", () => {
	it.each(
		every,
	)("%s: produces an artifact without diagnostics", (_id, template) => {
		const result = compile(template);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * The entry file and artifact module list match the template's file list, so no file silently
	 * drops out. A file the module graph never reaches is one nobody uses, and a project makers read
	 * first should not contain one.
	 */
	it.each(every)("%s: every file is in the module graph", (_id, template) => {
		const result = compile(template);
		if (!result.ok) throw new Error("does not compile");
		expect(result.artifact.entry).toBe(template.entry);
		expect(result.artifact.modules.map((module) => module.id).sort()).toEqual(
			template.files.map((file) => file.path).sort(),
		);
	});
});

describe("mount", () => {
	it.each(
		every,
	)("%s: the first commit happens in the VM", async (_id, template) => {
		const mounted = await mount(template);
		expect(mounted.rootErrors).toEqual([]);
		expect(mounted.diagnostics).toEqual([]);
		expect(mounted.tree.batches.length).toBeGreaterThan(0);
		expect(mounted.tree.size).toBeGreaterThan(1);
	});
});

/**
 * Interaction for the four focused templates (§44). Rendering successfully is not the same as
 * responding to presses. A template with miswired handlers would pass a mount-only check, and the
 * defect would show only when the maker pressed the preview.
 */
describe("interaction", () => {
	it("Visual Novel: pressing a choice changes the line", async () => {
		const mounted = await mount(templateOf("visual-novel"));
		expect(mounted.text()).toContain(
			"I saw something strange in the library yesterday",
		);
		await mounted.press("What happened?");
		expect(mounted.text()).toContain("I knew you'd ask");
		/**
		 * Relationship values must move too. If a choice changes only the dialogue, that axis is dead.
		 */
		expect(mounted.text()).toContain("48");
	});

	it("Messenger: pressing a tab stands another surface", async () => {
		const mounted = await mount(templateOf("messenger"));
		expect(mounted.text()).toContain("Say something to Sena first");
		await mounted.press("Profile");
		expect(mounted.text()).toContain("Same club");
		expect(mounted.text()).not.toContain("Say something to Sena first");
	});
});

/**
 * The central scenario of this suite: free input passes through a real generation and becomes saved
 * state.
 *
 * The chain is TSX → compiler → QuickJS → useGeneration() → host capability → injected port. The
 * maker's code then calls setStoryState with the result, which becomes a patch and then a tree. The
 * whole chain is run, rather than a helper in isolation (§66).
 */
describe("Messenger: free-input AI conversation", () => {
	const fake = fakeGeneration;

	it("typing and sending leaves the AI's answer on screen and in saved state", async () => {
		const generation = fake("Hi. Are you still at school?");
		const mounted = await mount(templateOf("messenger"), { generation });

		await mounted.type("Hi Sena");
		expect(mounted.draft()).toBe("Hi Sena");

		await mounted.press("Send");

		expect(mounted.text()).toContain("Hi Sena");
		expect(mounted.text()).toContain("Hi. Are you still at school?");
		/**
		 * After sending, the input is cleared. The value is a controlled prop, so the tree reads it back
		 * directly.
		 */
		expect(mounted.draft()).toBe("");

		/** Both messages are in saved state. These are the values a restart carries over. */
		const saved = JSON.stringify(mounted.story());
		expect(saved).toContain("Hi Sena");
		expect(saved).toContain("Hi. Are you still at school?");
		expect(mounted.rootErrors).toEqual([]);
	});

	it("sends with Enter too", async () => {
		const generation = fake("Yeah, why?");
		const mounted = await mount(templateOf("messenger"), { generation });
		await mounted.type("Where are you now");
		await mounted.submit();
		expect(mounted.text()).toContain("Yeah, why?");
		expect(mounted.draft()).toBe("");
		/** One confirm produces one request (§26). */
		expect(generation.seen).toHaveLength(1);
	});

	/**
	 * One send makes one request (§26). Confirming and the send button go through the same function,
	 * so pressing both in quick succession must still produce one request. The second press is pending
	 * and does not start.
	 */
	it("pressing again right after sending makes one request", async () => {
		const generation = fake("Answering only once");
		const mounted = await mount(templateOf("messenger"), { generation });
		await mounted.type("Can you hear me?");
		await mounted.submit();
		/** The input is empty, so the next confirm has nothing to send. Empty messages do not pile up. */
		await mounted.submit();
		expect(generation.seen).toHaveLength(1);
		const saved = JSON.stringify(mounted.story());
		expect(saved.split("Can you hear me?").length - 1).toBe(1);
	});

	/**
	 * While waiting, the input is locked, and that is this template's UX defense. The host's
	 * concurrency limit is a resource defense behind it, not a screen rule.
	 */
	it("the input locks while waiting for a reply and reopens when it arrives", async () => {
		let release: (text: string) => void = () => {};
		const generation: FakeGeneration = {
			reply: () =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
			seen: [],
		};
		const mounted = await mount(templateOf("messenger"), { generation });
		expect(mounted.entryDisabled()).toBe(false);
		await mounted.type("Wait");
		await mounted.press("Send");
		expect(generation.seen).toHaveLength(1);
		expect(mounted.entryDisabled()).toBe(true);
		release("Here it is now");
		await mounted.quiesce();
		expect(mounted.entryDisabled()).toBe(false);
		expect(mounted.text()).toContain("Here it is now");
	});

	/**
	 * The request reaching the host has no provider, model, or key. The maker cannot choose those
	 * three; that is true by the shape of the contract, and it is checked here by value.
	 */
	it("the request holds only the conversation and the instructions", async () => {
		const generation = fake("Yeah.");
		const mounted = await mount(templateOf("messenger"), { generation });
		await mounted.type("Hi");
		await mounted.press("Send");

		expect(generation.seen).toHaveLength(1);
		const request = generation.seen[0];
		expect(request.messages).toEqual([{ role: "user", content: "Hi" }]);
		expect(request.instructions).toContain("Sena");
		expect(Object.keys(request).sort()).toEqual([
			"instructions",
			"maxOutputCharacters",
			"messages",
		]);
	});

	/** Even on failure, the player's own message stays and retry appears (§54, §55). */
	it("the sent message does not disappear when generation fails", async () => {
		const generation = fake("", true);
		const mounted = await mount(templateOf("messenger"), { generation });
		await mounted.type("What's going on?");
		await mounted.press("Send");

		expect(mounted.text()).toContain("What's going on?");
		expect(mounted.text()).toContain("Retry");
		expect(JSON.stringify(mounted.story())).toContain("What's going on?");
		/**
		 * The session stays alive. A generation failure is a recoverable rejection, not an engine
		 * failure.
		 */
		expect(mounted.session.state).toBe("ready");
	});

	/** Retry runs on the same record and does not stack the same message twice. */
	it("retry does not duplicate the user's message", async () => {
		let fails = true;
		const generation: FakeGeneration = {
			reply: () => "I'll answer now.",
			seen: [],
			get fail() {
				return fails;
			},
		};
		const mounted = await mount(templateOf("messenger"), { generation });
		await mounted.type("Can you hear me?");
		await mounted.press("Send");
		fails = false;
		await mounted.press("Retry");

		expect(mounted.text()).toContain("I'll answer now.");
		const saved = JSON.stringify(mounted.story());
		expect(saved.split("Can you hear me?").length - 1).toBe(1);
	});

	/**
	 * Restart keeps the conversation and clears the input (§68). This matches what the preview's `Restart`
	 * does: it builds a new session from the saved snapshot.
	 */
	it("restarting keeps the conversation and clears the input", async () => {
		const generation = fake("Yeah, I'm here.");
		const first = await mount(templateOf("messenger"), { generation });
		await first.type("At school?");
		await first.press("Send");
		/** The unsent draft is still in the input when restarting. */
		await first.type("Something not sent yet");
		const carried = first.story();

		const second = await mount(templateOf("messenger"), {
			generation,
			storyState: carried,
		});
		expect(second.text()).toContain("At school?");
		expect(second.text()).toContain("Yeah, I'm here.");
		expect(second.draft()).toBe("");
		expect(second.text()).not.toContain("Something not sent yet");
	});

	/** Mounting calls nothing. The first request is always a send the player presses (§64). */
	it("does not call generation on mount", async () => {
		const generation = fake("Must not be called");
		const mounted = await mount(templateOf("messenger"), { generation });
		await new Promise((resolve) => setTimeout(resolve, 0));
		await mounted.session.settle();
		expect(generation.seen).toEqual([]);
	});

	it("Investigation: investigating raises the clue count", async () => {
		const mounted = await mount(templateOf("investigation"));
		expect(mounted.text()).toContain("0 / 3");
		await mounted.press("Check the third-floor lockers");
		expect(mounted.text()).toContain("1 / 3");
		/**
		 * The content of the acquired clue appears. If only the count goes up, the conditional render is
		 * dead.
		 */
		expect(mounted.text()).toContain("Duplicate library key");
	});

	it("Relationship Profile: activities raise the stage", async () => {
		const mounted = await mount(templateOf("relationship-profile"));
		expect(mounted.text()).toContain("Acquaintances");
		/** Starts at 40; community help (+14) gives 54, which passes `Friends` (50). */
		await mounted.press("Help with club work");
		expect(mounted.text()).toContain("Friends");
		expect(mounted.text()).toContain("Sorted the returned books together");
	});
});
