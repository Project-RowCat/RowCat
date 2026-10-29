import { type RuntimeTemplate, runtimeTemplateById } from "@rowcat/authoring";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	compileTemplate,
	disposeMountedTemplates,
	type FakeGeneration,
	fakeGeneration,
	type MountedTemplate,
	type MountTemplateOptions,
	mountTemplate,
} from "#/test/runtime-template-harness.ts";

/**
 * Plays the flagship template (`Eight Weeks to Debut`) through its full loop: first screen, scheduling and
 * settlement, branching events, locked choices, free evening input, checks, ending, and carry-over
 * across episodes.
 *
 * The focused-template test only asks whether a press changes something. This file checks what only
 * a walk through the screens can show: the schedule preview matches the real settlement,
 * overlapping schedules really grow less, locked choices are blocked by rules rather than by the
 * screen, endings are deterministic, and facts learned last episode open choices in this one.
 *
 * All actions go through runtime events (handler numbers). No test writes saved state directly,
 * since state reached that way is not proof that a player can reach it. Cross-episode scenarios
 * start from a snapshot a previous session actually saved.
 *
 * The two full eight-week scenarios press much faster than a person and would exhaust the
 * production session budget (250ms per 1s window). runtime-template-harness.ts turns that window
 * off but keeps the per-run budget. Its header gives the reason.
 */

/**
 * A scenario runs compilation, a QuickJS session, and several round trips. The default 5s timeout
 * is too short for that chain, and the timeout message would name the wrong cause: the run is slow,
 * not hung.
 */
vi.setConfig({ testTimeout: 30_000 });

afterEach(disposeMountedTemplates);

const flagship = (): RuntimeTemplate => {
	const found = runtimeTemplateById("idol-debut");
	if (found === null) throw new Error("no flagship template");
	return found;
};

const mount = (options?: MountTemplateOptions) =>
	mountTemplate(flagship(), options);

const tap = (mounted: MountedTemplate, label: string): Promise<void> =>
	mounted.press(label);

/** The first-screen button. Its label changes when the player already knows something. */
const begin = (mounted: MountedTemplate): Promise<void> =>
	tap(
		mounted,
		mounted.pressable("Start") ? "Start" : "Take on a new debut group",
	);

/**
 * Reads this episode's values from the saved snapshot. The shape comes from the template, so the
 * typing is loose here.
 */
function run(mounted: MountedTemplate): Record<string, unknown> {
	const entry = mounted
		.story()
		.entries.find((candidate) => candidate.key === "run");
	if (entry === undefined) throw new Error("no run story state");
	return entry.value as Record<string, unknown>;
}

function career(mounted: MountedTemplate): Record<string, unknown> {
	const entry = mounted
		.progress()
		.entries.find((candidate) => candidate.key === "career");
	if (entry === undefined) throw new Error("no career persistent state");
	return entry.value as Record<string, unknown>;
}

const trustOf = (mounted: MountedTemplate, id: string): number =>
	(run(mounted).trust as Record<string, number>)[id];

const skillOf = (mounted: MountedTemplate, id: string, axis: string): number =>
	(run(mounted).skills as Record<string, Record<string, number>>)[id][axis];

const conditionOf = (mounted: MountedTemplate, id: string): number =>
	(run(mounted).condition as Record<string, number>)[id];

const notesOf = (mounted: MountedTemplate): string[] =>
	career(mounted).notes as string[];

/**
 * Activities are picked by their summary line. Once a slot is filled it also shows the activity
 * name, so matching by name would hit the filled slot instead of the list, especially in the
 * overlapping-schedule scenario. The summary exists only in the list.
 */
const ACTIVITY_SUMMARY: Record<string, string> = {
	"Vocal lesson": "A teacher comes and sees the five one by one.",
	"Choreography practice":
		"The same eight bars, repeated in front of the mirror.",
	"Expression class":
		"Learn how to look into the camera and how to use expressions.",
	"Fitness care": "Call in a trainer and change the diet.",
	"Original content shoot": "Set a camera in the practice room and film a day.",
	"Sync practice": "Only formations and timing. No music.",
	"Individual coaching": "Hold one person back. Their weakest axis rises.",
	Rest: "Clear the day. Nobody comes to the practice room.",
};

/**
 * Fills the three schedule slots. If a private lesson is among them, the target student is picked
 * too.
 */
async function planWeek(
	mounted: MountedTemplate,
	plan: readonly [string, string, string],
	target?: string,
): Promise<void> {
	await tap(mounted, "Plan this week");
	for (let index = 0; index < 3; index += 1) {
		await tap(mounted, `Slot ${index + 1}`);
		await tap(mounted, ACTIVITY_SUMMARY[plan[index]]);
		if (plan[index] === "Individual coaching" && target !== undefined)
			await tap(mounted, target);
	}
}

/** If an event is waiting for an answer, picks the given option. */
async function settleEvent(
	mounted: MountedTemplate,
	label: string,
): Promise<void> {
	if (mounted.text().includes("Decide first")) await tap(mounted, label);
}

/** Says one line to a character. This is the only entry point to the evening. */
async function say(mounted: MountedTemplate, text: string): Promise<void> {
	await mounted.type(text);
	await mounted.submit();
}

/**
 * Plays one whole week: schedule, settlement, event, evening. Stops when a check screen appears.
 */
async function playWeek(
	mounted: MountedTemplate,
	options: {
		plan?: readonly [string, string, string];
		target?: string;
		event?: string;
		evening?: string;
		ask?: string;
	} = {},
): Promise<void> {
	const plan =
		options.plan ??
		(["Sync practice", "Choreography practice", "Rest"] as const);
	await planWeek(mounted, plan, options.target);
	await tap(mounted, "Spend the week");
	if (options.event !== undefined) await settleEvent(mounted, options.event);
	else if (mounted.text().includes("Decide first"))
		await settleEvent(mounted, FIRST_CHOICE[weekOf(mounted)] ?? "");
	await tap(mounted, "Evening");
	await tap(mounted, options.evening ?? "Haram");
	if (options.ask !== undefined) await say(mounted, options.ask);
	await tap(mounted, "End the day");
	if (mounted.text().includes("Judges' comments"))
		await tap(
			mounted,
			mounted.pressable("See the result") ? "See the result" : "Next week",
		);
}

const weekOf = (mounted: MountedTemplate): number =>
	run(mounted).week as number;

/** On weeks with an event, picks the option that changes nothing. This keeps the scenario short. */
const FIRST_CHOICE: Record<number, string> = {
	2: "Pretend not to notice",
	3: "Suggest doing what the company says",
	4: "Take over the account",
	5: "Tell them to stop and go home",
	6: "Wait",
	7: "Suggest talking after the evaluation",
};

describe("compile", () => {
	it("produces an artifact without diagnostics, with every file in the graph", () => {
		const result = compileTemplate(flagship());
		expect(result.diagnostics).toEqual([]);
		if (!result.ok) throw new Error("does not compile");
		expect(result.artifact.entry).toBe("src/main.tsx");
		expect(result.artifact.modules.map((module) => module.id).sort()).toEqual(
			flagship()
				.files.map((file) => file.path)
				.sort(),
		);
	});
});

describe("first screen", () => {
	it("stands like a story: title, situation, one line of rules", async () => {
		const mounted = await mount();
		expect(mounted.rootErrors).toEqual([]);
		expect(mounted.diagnostics).toEqual([]);
		const text = mounted.text();
		expect(text).toContain("Eight Weeks to Debut");
		expect(text).toContain("Halfmoon Company");
		expect(text).toContain("Skill alone won't pass");
		expect(mounted.pressable("Start")).toBe(true);
	});

	/**
	 * A first-time player should not see an empty display case. For someone who has collected nothing,
	 * the empty slot reads as a burden rather than guidance. It would also suggest up front that this
	 * work is a collectible.
	 */
	it("the first run has no previous-run section", async () => {
		const mounted = await mount();
		expect(mounted.text()).not.toContain(
			"What's left from previous debut groups",
		);
	});

	it("starting shows the first week's briefing", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		const text = mounted.text();
		expect(text).toContain("Week one");
		expect(text).toContain("Director Kim");
		expect(run(mounted).week).toBe(1);
		expect(run(mounted).phase).toBe("briefing");
	});
});

describe("planning", () => {
	it("a week cannot be spent before three slots are filled", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await tap(mounted, "Plan this week");
		expect(mounted.text()).toContain("Fill all three slots");
		await tap(mounted, "Slot 1");
		await tap(mounted, "Vocal lesson");
		expect(mounted.text()).toContain("Fill all three slots");
	});

	/**
	 * The score the schedule preview shows is the actual result. The rules are pure and random-free,
	 * and this line observes that. Hand-entered estimates would drift from the real numbers, and a
	 * drifted screen would mislead the player.
	 */
	it("the previewed overall score is what settles", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await planWeek(mounted, [
			"Sync practice",
			"Choreography practice",
			"Vocal lesson",
		]);
		const preview = mounted.text().match(/33 → (\d+)/);
		expect(preview, "the planner should show a preview").not.toBeNull();
		await tap(mounted, "Spend the week");
		expect(mounted.text()).toContain(`${preview?.[1]} Overall`);
	});

	it("repeating an activity gains less from the second on", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await planWeek(mounted, [
			"Choreography practice",
			"Choreography practice",
			"Choreography practice",
		]);
		await tap(mounted, "Spend the week");
		const text = mounted.text();
		expect(text).toContain("Choreography practice Everyone Dance +6");
		expect(text).toContain("Choreography practice (repeat) Everyone Dance +4");
		expect(text).toContain("Choreography practice (repeat) Everyone Dance +2");
	});

	it("individual coaching raises that person's lowest axis", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		const before = skillOf(mounted, "yeonwoo", "vocal");
		await planWeek(
			mounted,
			["Individual coaching", "Rest", "Fitness care"],
			"Yeonwoo",
		);
		await tap(mounted, "Spend the week");
		expect(mounted.text()).toContain("Individual coaching · Yeonwoo Vocal +9");
		expect(skillOf(mounted, "yeonwoo", "vocal")).toBe(before + 9);
	});

	/**
	 * Learning does not happen while exhausted. A strategy of running every week to the end and
	 * resting last would hurt itself.
	 */
	it("with condition at the bottom they learn only half", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await planWeek(mounted, [
			"Choreography practice",
			"Choreography practice",
			"Choreography practice",
		]);
		await tap(mounted, "Spend the week");
		await tap(mounted, "Evening");
		await tap(mounted, "Haram");
		await tap(mounted, "End the day");
		await planWeek(mounted, [
			"Choreography practice",
			"Choreography practice",
			"Choreography practice",
		]);
		await tap(mounted, "Spend the week");
		expect(conditionOf(mounted, "roun")).toBeLessThan(30);
		expect(mounted.text()).toContain("half from exhaustion");
	});
});

describe("events", () => {
	it("cannot go to the evening before choosing", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted);
		await planWeek(mounted, ["Rest", "Fitness care", "Sync practice"]);
		await tap(mounted, "Spend the week");
		expect(mounted.text()).toContain("After practice");
		expect(mounted.text()).toContain("Decide first");
	});

	/**
	 * Locked choices stay visible and state what is required. If they vanished, the player would not
	 * know the path exists and would have no reason to replay the episode. The lock is a rule, not a
	 * visual disabled state: the choice cannot be pressed.
	 */
	it("a choice that needs something unknown is locked and cannot be pressed", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted);
		await planWeek(mounted, ["Rest", "Fitness care", "Sync practice"]);
		await tap(mounted, "Spend the week");
		expect(mounted.text()).toContain("You need to learn more about Yeonwoo");
		expect(mounted.pressable("Book a hospital appointment")).toBe(false);
	});

	it("choosing shows the result and moves trust", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted);
		await planWeek(mounted, ["Rest", "Fitness care", "Sync practice"]);
		await tap(mounted, "Spend the week");
		const before = trustOf(mounted, "yeonwoo");
		await tap(mounted, "Call them aside");
		expect(mounted.text()).toContain("said they didn't know since when");
		expect(trustOf(mounted, "yeonwoo")).toBe(before + 6);
		expect(notesOf(mounted)).toContain("yeonwoo-knee");
	});
});

describe("evening: what you ask decides what you learn", () => {
	const reachTalk = async (
		who = "Haram",
		generation = fakeGeneration("Yes."),
	): Promise<MountedTemplate> => {
		const mounted = await mount({ generation });
		await tap(mounted, "Start");
		await planWeek(mounted, ["Rest", "Fitness care", "Sync practice"]);
		await tap(mounted, "Spend the week");
		await tap(mounted, "Evening");
		await tap(mounted, who);
		return mounted;
	};

	/** There are no prepared question buttons. The entry point is one input line. */
	it("there are no questions to pick", async () => {
		const mounted = await reachTalk();
		expect(mounted.text()).toContain("What you see");
		expect(mounted.text()).toContain("Talk");
		expect(mounted.pressable("Ask how their throat is today")).toBe(false);
		expect(mounted.text()).not.toContain("Things to say");
	});

	/**
	 * The screen shows observations, not questions. Writing the questions out would turn each line
	 * into a button, and the screen would become a list again.
	 */
	it("what to ask about now stands as an observation", async () => {
		const mounted = await reachTalk();
		expect(mounted.text()).toContain("seventh year");
		expect(mounted.text()).not.toContain("Ask them");
	});

	it("asking about that story opens the fragment and raises trust", async () => {
		const mounted = await reachTalk();
		const before = trustOf(mounted, "haram");
		await say(mounted, "Seven years? Why do you push this far?");
		expect(notesOf(mounted)).toContain("haram-cut");
		expect(run(mounted).opened).toContain("haram-cut");
		expect(trustOf(mounted, "haram")).toBeGreaterThan(before);
		expect(mounted.text()).toContain("Story learned · The last debut group");
	});

	it("unrelated talk opens nothing", async () => {
		const mounted = await reachTalk();
		await say(mounted, "Nice weather today.");
		expect(notesOf(mounted)).toEqual([]);
		expect(mounted.text()).not.toContain("Story learned");
	});

	/**
	 * Judgment comes from the player's sentence, not the model's. However plausible the model's
	 * answer, it cannot unlock anything.
	 */
	it("the model's answer opens nothing", async () => {
		const ai = fakeGeneration(
			"Actually I was cut from a debut group two years ago. This is my last time.",
		);
		const mounted = await reachTalk("Haram", ai);
		await say(mounted, "How was practice today?");
		expect(notesOf(mounted)).toEqual([]);
	});

	/**
	 * If the player raises a story whose conditions are not met, that character deflects. No `Locked`
	 * (locked) label appears on screen; the deflection goes to the model as an instruction.
	 */
	it("instructions make the character avoid a story that cannot open yet", async () => {
		const ai = fakeGeneration("I'm fine.");
		const mounted = await reachTalk("Haram", ai);
		await say(mounted, "Is your throat okay?");
		expect(notesOf(mounted)).toEqual([]);
		expect(ai.seen[0].instructions).toContain(
			"you don't want to talk about it yet",
		);
		expect(mounted.text()).not.toContain("Locked");
	});

	/** An opened story is passed in the instruction, so the character tells it in their own words. */
	it("an opened story rides in the instructions", async () => {
		const ai = fakeGeneration("…Yes. It did.");
		const mounted = await reachTalk("Haram", ai);
		await say(mounted, "Seven years. Did something happen before?");
		expect(ai.seen[0].instructions).toContain(
			"this time you decide to tell it",
		);
		expect(ai.seen[0].instructions).toContain(
			"Three weeks before the announcement",
		);
	});

	/**
	 * What is learned comes from asking, not from the model's answer. Even if the provider refuses,
	 * progress continues, so the work moves forward in an AI-off preview.
	 */
	it("what was learned stays even without an answer", async () => {
		const ai = fakeGeneration("", true);
		const mounted = await reachTalk("Haram", ai);
		await say(mounted, "Your seventh year, right? Why do you keep going?");
		expect(notesOf(mounted)).toContain("haram-cut");
		expect(mounted.text()).toContain("Couldn't get an answer");
		expect(mounted.text()).toContain("Story learned");
	});

	it("asking about the same story twice opens it once", async () => {
		const mounted = await reachTalk();
		await say(mounted, "Seven years. Why?");
		const trust = trustOf(mounted, "haram");
		await say(mounted, "Tell me more about before.");
		expect(notesOf(mounted)).toEqual(["haram-cut"]);
		expect(trustOf(mounted, "haram")).toBe(trust);
	});
});

describe("free input", () => {
	const reachTalk = async (
		generation: FakeGeneration,
	): Promise<MountedTemplate> => {
		const mounted = await mount({ generation });
		await tap(mounted, "Start");
		await planWeek(mounted, ["Rest", "Fitness care", "Sync practice"]);
		await tap(mounted, "Spend the week");
		await tap(mounted, "Evening");
		await tap(mounted, "Haram");
		return mounted;
	};

	it("the sent line and the answer stay in the log", async () => {
		const ai = fakeGeneration("My voice came out well today.");
		const mounted = await reachTalk(ai);
		await mounted.type("How was today?");
		await mounted.submit();
		expect(mounted.text()).toContain("How was today?");
		expect(mounted.text()).toContain("My voice came out well today.");
		expect(mounted.draft()).toBe("");
		expect(ai.seen).toHaveLength(1);
	});

	/**
	 * AI sets the mood; code decides progress. Even a long reply does not move the trust meter.
	 * Progress is never parsed from model output, and this test observes that decision.
	 */
	/**
	 * A line that does not touch the topic is kept in the record only. Apart from the trust gained
	 * from the first line, it moves nothing, and no model reply opens a piece.
	 */
	it("a line that touches no topic stays only in the log", async () => {
		const ai = fakeGeneration(
			"Actually I was cut from a debut group two years ago. This is my last time.",
		);
		const mounted = await reachTalk(ai);
		await mounted.type("What should we eat tomorrow?");
		await mounted.submit();
		expect(notesOf(mounted)).toEqual([]);
		expect(mounted.text()).toContain("What should we eat tomorrow?");
	});

	it("the request carries at most the last ten lines", async () => {
		const ai = fakeGeneration("Yes.");
		const mounted = await reachTalk(ai);
		for (let turn = 0; turn < 7; turn += 1) {
			await mounted.type(`Question ${turn}`);
			await mounted.submit();
		}
		const last = ai.seen[ai.seen.length - 1];
		expect(last.messages.length).toBeLessThanOrEqual(10);
		expect(last.instructions).toContain("Jung Haram");
		expect(last.instructions).not.toContain("provider");
	});

	/** On failure, retry appears and the player's message stays. No fake reply is generated. */
	it("on failure retry stands and my line stays", async () => {
		const ai = fakeGeneration("", true);
		const mounted = await reachTalk(ai);
		await mounted.type("Are you okay?");
		await mounted.submit();
		expect(mounted.text()).toContain("Are you okay?");
		expect(mounted.text()).toContain("Couldn't get an answer");
		expect(mounted.pressable("Retry")).toBe(true);
	});
});

describe("reviews and evaluation", () => {
	it("the first review stands at the end of week two", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted);
		await playWeek(mounted);
		expect(run(mounted).week).toBe(3);
	});

	it("a review states the bar and comments together", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted);
		await planWeek(mounted, ["Sync practice", "Choreography practice", "Rest"]);
		await tap(mounted, "Spend the week");
		await settleEvent(mounted, "Pretend not to notice");
		await tap(mounted, "Evening");
		await tap(mounted, "Haram");
		await tap(mounted, "End the day");
		const text = mounted.text();
		expect(text).toContain("First review");
		expect(text).toContain("Judges' comments");
		expect(text).toContain("Individual evaluation");
		expect(mounted.pressable("Next week")).toBe(true);
	});
});

describe("endings", () => {
	/** Reaches the ending after all eight weeks. The whole format of this work runs once here. */
	it("past eight weeks an ending stands and one run is added", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		for (let week = 1; week <= 8; week += 1) await playWeek(mounted);
		expect(run(mounted).phase).toBe("ending");
		expect(career(mounted).runs).toBe(1);
		expect(mounted.text()).toContain("What lasts across runs");
		expect(mounted.pressable("Take on a new debut group")).toBe(true);
	});

	it("a hidden ending not yet seen gets no name", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		for (let week = 1; week <= 8; week += 1) await playWeek(mounted);
		expect(mounted.text()).toContain("???");
		expect(mounted.text()).not.toContain("Backstage");
	});

	/** Restarting makes only this episode fresh. What was learned carries over. */
	it("learned stories stay after a restart", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted, {
			evening: "Haram",
			ask: "Seven years, they say? Why do you keep going?",
		});
		await playWeek(mounted, {
			evening: "Haram",
			ask: "How was your throat back then?",
		});
		for (let week = 3; week <= 8; week += 1) await playWeek(mounted);
		await tap(mounted, "Take on a new debut group");
		expect(run(mounted).week).toBe(1);
		expect(run(mounted).opened).toEqual([]);
		expect(trustOf(mounted, "haram")).toBe(30);
		expect(notesOf(mounted)).toContain("haram-cut");
	});
});

describe("stories across runs", () => {
	/**
	 * Everything the persistent state does in this work: what is learned in one episode opens locked
	 * choices in the next. It starts from a snapshot an earlier session actually saved.
	 */
	it("what was learned last run opens this run's event", async () => {
		const first = await mount();
		await tap(first, "Start");
		await playWeek(first);
		await planWeek(first, ["Rest", "Fitness care", "Sync practice"]);
		await tap(first, "Spend the week");
		await tap(first, "Call them aside");
		expect(notesOf(first)).toContain("yeonwoo-knee");
		const carried = first.progress();

		const second = await mount({ persistentState: carried });
		await begin(second);
		await playWeek(second);
		await planWeek(second, ["Rest", "Fitness care", "Sync practice"]);
		await tap(second, "Spend the week");
		expect(second.text()).not.toContain("You need to learn more about Yeonwoo");
		expect(second.pressable("Book a hospital appointment")).toBe(true);
		await tap(second, "Book a hospital appointment");
		expect(second.text()).toContain(
			"You only said you'd cleared Thursday afternoon",
		);
	});

	it("an inherited run's first screen states what remains first", async () => {
		const first = await mount();
		await tap(first, "Start");
		await playWeek(first, {
			evening: "Haram",
			ask: "Seven years, they say? Why do you keep going?",
		});
		await playWeek(first, {
			evening: "Haram",
			ask: "How was your throat back then?",
		});
		const second = await mount({ persistentState: first.progress() });
		const text = second.text();
		expect(text).toContain("What's left from previous debut groups");
		expect(text).toContain("Stories learned");
		expect(second.pressable("Take on a new debut group")).toBe(true);
	});
});

describe("roster", () => {
	/**
	 * This is the only screen that can be viewed outside progress at any time. Nothing can be chosen
	 * on it.
	 */
	it("switching tabs does not move progress", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		const before = run(mounted).phase;
		await tap(mounted, "Roster");
		expect(mounted.text()).toContain("None yet");
		expect(run(mounted).phase).toBe(before);
		await tap(mounted, "Progress");
		expect(mounted.text()).toContain("Plan this week");
	});

	it("heard stories pile up in the roster", async () => {
		const mounted = await mount();
		await tap(mounted, "Start");
		await playWeek(mounted, {
			evening: "Haram",
			ask: "Seven years, they say? Why do you keep going?",
		});
		await playWeek(mounted, {
			evening: "Haram",
			ask: "How was your throat back then?",
		});
		await tap(mounted, "Roster");
		expect(mounted.text()).toContain("The last debut group");
		expect(mounted.text()).toContain("learned this time");
	});
});
