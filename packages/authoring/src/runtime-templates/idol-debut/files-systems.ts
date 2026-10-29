import type { RuntimeTemplateFile } from "../types.ts";

/**
 * Rules: stats, roster settlement, trust, learned facts, choice resolution, and dialogue log. No
 * screens here.
 */
export const SYSTEM_FILES: readonly RuntimeTemplateFile[] = [
	{
		path: "src/systems/dialogue.ts",
		content: `import type { RuntimeGenerationMessage } from "@rowcat/runtime";
import type { DialogueMessage, MemberId, MessageRole, Run } from "../types";

/**
 * Dialogue log: **save generously, send only the recent part.**
 *
 * \`\`\`text
 * save      up to DIALOGUE_KEEP lines remain      so saved state does not grow forever
 * request   only REQUEST_TURNS lines ride         every request's prefix must match for the cache to hit
 * \`\`\`
 *
 * Folding these into one value breaks one of them: sending everything makes the log longer than the
 * instructions by the twentieth round trip, and sizing the save to the request makes the evening's talk
 * disappear from the screen.
 */
export const DIALOGUE_KEEP = 120;
export const REQUEST_TURNS = 10;

export function appendMessage(
	run: Run,
	memberId: MemberId,
	role: MessageRole,
	content: string,
): Run {
	const message: DialogueMessage = {
		id: run.nextMessageId,
		memberId,
		role,
		content,
	};
	const messages = [...run.messages, message];
	return {
		...run,
		messages:
			messages.length > DIALOGUE_KEEP
				? messages.slice(messages.length - DIALOGUE_KEEP)
				: messages,
		nextMessageId: run.nextMessageId + 1,
	};
}

/** Everything said with that member. The screen draws only the last few lines. */
export const conversationWith = (
	run: Run,
	memberId: MemberId,
): readonly DialogueMessage[] =>
	run.messages.filter((message) => message.memberId === memberId);

/** What rides on the request: only the recent round trips with that person. */
export function recentMessagesFor(
	run: Run,
	memberId: MemberId,
): readonly RuntimeGenerationMessage[] {
	const mine = conversationWith(run, memberId);
	return mine.slice(-REQUEST_TURNS).map((message) => ({
		role: message.role,
		content: message.content,
	}));
}

/**
 * Whether my message is awaiting a reply: the condition for \`Retry\` to stand.
 *
 * If the last line is mine, no reply came. That is why failure is not saved separately: the log
 * already says so.
 */
export function awaitsReply(run: Run, memberId: MemberId): boolean {
	const mine = conversationWith(run, memberId);
	if (mine.length === 0) return false;
	return mine[mine.length - 1].role === "user";
}
`,
	},
	{
		path: "src/systems/notes.ts",
		content: `import { MEMBER_ORDER } from "../members";
import type { Career, MemberId, NoteId, Run } from "../types";

/**
 * **Stories learned** about the members: all that persistent state does in this story.
 *
 * \`\`\`text
 * run.opened      opened this run              cleared on restart
 * career.notes    everything opened so far     lives past a play reset
 * knownNotes()    the union: what the screen and locks read
 * \`\`\`
 *
 * Five members × three, and **the third opens only after the first two.** So one run of eight weeks
 * cannot learn all five: the next debut group starts from scratch, but **someone who knows the five**
 * starts it, and that difference opens locked conversation topics and event choices.
 *
 * A fragment is always opened by something a person chose. There is no path from the model's answer;
 * that structure is not taught to a first-time creator (the header of generation.ts).
 */
export interface Note {
	id: NoteId;
	memberId: MemberId;
	/** Which fragment this is. The third opens only with the first two. */
	depth: 1 | 2 | 3;
	title: string;
	/** One line. The list and the instructions use this value. */
	short: string;
	/** What is written on the card when it opens. */
	body: string;
}

export const NOTES: Record<NoteId, Note> = {
	"haram-cut": {
		id: "haram-cut",
		memberId: "haram",
		depth: 1,
		title: "The last debut group",
		short: "Haram was cut at the last moment from a debut group two years ago.",
		body: "There was a debut group two years ago too, and Haram was in it. Three weeks before the announcement the five became four, and the one cut was Haram. That team is still active today.",
	},
	"haram-throat": {
		id: "haram-throat",
		memberId: "haram",
		depth: 2,
		title: "Throat",
		short: "Haram has strained their vocal cords before and is still careful.",
		body: "Last winter Haram lost their voice once. They rested two months, and since then they check their voice every morning before starting the day. That's why they're always first to lessons.",
	},
	"haram-quit": {
		id: "haram-quit",
		memberId: "haram",
		depth: 3,
		title: "The day they meant to quit",
		short: "Haram has decided this is the last time.",
		body: "Last year there was a day Haram packed everything. They didn't tell the company; instead they set themself a deadline: this debut group is the last. They've never said that to any of the five.",
	},
	"yeonwoo-knee": {
		id: "yeonwoo-knee",
		memberId: "yeonwoo",
		depth: 1,
		title: "Knee",
		short: "Yeonwoo limps after practice and hasn't told anyone.",
		body: "Only after practice, once everyone has left, does Yeonwoo lean on the wall. Asked since when, they didn't answer. When the hospital comes up, they change the subject.",
	},
	"yeonwoo-stage": {
		id: "yeonwoo-stage",
		memberId: "yeonwoo",
		depth: 2,
		title: "The dance they gave up",
		short: "Yeonwoo did dance and gave it up before coming. They don't bring it up first.",
		body: "Yeonwoo danced until sixteen. A competition video is still out there somewhere, they said. They didn't say why they quit, but it explains why they memorize choreography at a different pace.",
	},
	"yeonwoo-home": {
		id: "yeonwoo-home",
		memberId: "yeonwoo",
		depth: 3,
		title: "Home",
		short: "Their family still objects, and Yeonwoo doesn't contact them.",
		body: "Since giving up dance, Yeonwoo has drifted from home. They didn't tell their family about the debut group either. That's why they stay in the practice room the latest: nobody is there when they go back.",
	},
	"siha-crew": {
		id: "siha-crew",
		memberId: "siha",
		depth: 1,
		title: "The crew left behind",
		short: "Siha has people they used to work with and still keeps in touch.",
		body: "Three of them worked together in the underground scene. Only Siha joined a company; the other two stayed. Siha didn't say whether anyone called it betrayal, but their voice drops when they talk about it.",
	},
	"siha-credit": {
		id: "siha-credit",
		memberId: "siha",
		depth: 2,
		title: "Lyrics without a name",
		short: "Lyrics Siha wrote once went out under someone else's name.",
		body: "Lyrics Siha wrote two years ago came out under another person's name. That was in the contract, they said. Their habit of asking why whenever the company wants changes came from there.",
	},
	"siha-why": {
		id: "siha-why",
		memberId: "siha",
		depth: 3,
		title: "Why they joined anyway",
		short: "It wasn't the size of the stage.",
		body: "Asked why they joined, Siha answered at length for the first time. In the underground scene, however good your work, the audience was fixed. They want to see people who don't know their lyrics sing along, just once.",
	},
	"roun-audition": {
		id: "roun-audition",
		memberId: "roun",
		depth: 1,
		title: "How many times they failed",
		short: "Roun failed eleven times before coming here.",
		body: "Roun has auditioned since fourteen and failed eleven times. They said it's strange that they remember the exact number. The twelfth was here.",
	},
	"roun-sleep": {
		id: "roun-sleep",
		memberId: "roun",
		depth: 2,
		title: "Sleep",
		short: "Roun can't sleep these days and says they're fine.",
		body: "After the dorm lights go out, Roun lies awake two or three hours. Asked if they're scared, they said no, then a while later said yes. That fact sits right beside Roun being the first to smile every morning.",
	},
	"roun-parents": {
		id: "roun-parents",
		memberId: "roun",
		depth: 3,
		title: "What they haven't said",
		short: "Roun hasn't told their family about the debut group.",
		body: "Roun told their family every time they failed, and felt sorry each time for being comforted. So this time they decided to tell them after they pass. They don't plan to say anything until the debut is confirmed.",
	},
	"jio-cast": {
		id: "jio-cast",
		memberId: "jio",
		depth: 1,
		title: "From the street",
		short: "Jio has never auditioned.",
		body: "Jio got a business card outside school and became a trainee two months later. Of the five, only Jio has never stood in an audition room. They bring it up often themself, before anyone else can.",
	},
	"jio-mirror": {
		id: "jio-mirror",
		memberId: "jio",
		depth: 2,
		title: "Counting at the mirror",
		short: "Jio counts every day how many years behind the others they are.",
		body: "What Jio does in front of the practice room mirror isn't only practice. Haram 7 years, Roun 4, Jio 1. They do that math several times a day, they said. They believe someone who started late has to grow fast.",
	},
	"jio-first": {
		id: "jio-first",
		memberId: "jio",
		depth: 3,
		title: "The first time they sang",
		short: "Jio came to like singing only after joining.",
		body: "At first Jio did it because they were told to. About half a year in, they sang alone one day in an empty practice room, and that was the first time they thought they wanted to keep going. Telling that story, they smiled for the first time.",
	},
};

export const NOTE_IDS: readonly NoteId[] = [
	"haram-cut",
	"haram-throat",
	"haram-quit",
	"yeonwoo-knee",
	"yeonwoo-stage",
	"yeonwoo-home",
	"siha-crew",
	"siha-credit",
	"siha-why",
	"roun-audition",
	"roun-sleep",
	"roun-parents",
	"jio-cast",
	"jio-mirror",
	"jio-first",
];

/** That member's fragments, by depth. */
export function notesOf(memberId: MemberId): readonly Note[] {
	return NOTE_IDS.map((id) => NOTES[id]).filter(
		(note) => note.memberId === memberId,
	);
}

/**
 * What is known now: **the union of what was opened this run and what was learned in past runs.**
 *
 * Locks, instructions and the screen all go through this one function. If each merged on its own, one
 * would leave out the persistent side, and someone past a run would have to ask again about a story they know.
 */
export function knownNotes(run: Run, career: Career): readonly NoteId[] {
	const known: NoteId[] = [...career.notes];
	for (const id of run.opened) if (!known.includes(id)) known.push(id);
	return known;
}

export const knowsNote = (
	run: Run,
	career: Career,
	id: NoteId,
): boolean => knownNotes(run, career).includes(id);

/** How many fragments are known about that member. The member card draws this value. */
export function knownDepth(
	run: Run,
	career: Career,
	memberId: MemberId,
): number {
	const known = knownNotes(run, career);
	return notesOf(memberId).filter((note) => known.includes(note.id)).length;
}

/** Whether all five are fully known: the hidden ending's condition. */
export function knowsEveryone(run: Run, career: Career): boolean {
	return knownNotes(run, career).length >= NOTE_IDS.length;
}

/** How many of the five have told their whole story. The ending screen draws it. */
export function completedMembers(run: Run, career: Career): readonly MemberId[] {
	return MEMBER_ORDER.filter((id) => knownDepth(run, career, id) >= 3);
}
`,
	},
	{
		path: "src/systems/progression.ts",
		content: `import { MEMBERS } from "../members";
import type { Career, MemberId, NoteId, Run } from "../types";
import { knownNotes } from "./notes";
import { NOTES } from "./notes";
import { bump } from "./stats";
import { TRUST_MAX } from "./relationships";

/**
 * One choosable thing: **event choices and evening conversation topics share one type.**
 *
 * Written separately, the lock rules would become two sets, and only one would read persistent state.
 * That mismatch shows up as "locked in the event, open in the evening", and a screen like that erases
 * the very impression that rules exist.
 */
export interface Requirement {
	/** Opens only when this fragment is known. Fragments learned in past runs count too. */
	note?: NoteId;
	/** That member's trust has to reach this much. */
	trust?: { member: MemberId; min: number };
	/** The five's total has to reach this much. */
	sync?: number;
}

/** The result of choosing. All deterministic, no randomness. */
export interface Effect {
	trust?: Partial<Record<MemberId, number>>;
	condition?: Partial<Record<MemberId, number>>;
	sync?: number;
	buzz?: number;
	/** The fragment it opens. **This is the only way to open a fragment.** */
	note?: NoteId;
}

export interface Choice {
	id: string;
	label: string;
	/** The line shown before choosing. It does not reveal the result. */
	detail: string;
	requires?: Requirement;
	effect: Effect;
	/** The sentence that stands after choosing. */
	outcome: string;
}

/**
 * Whether one condition is met: **choices and evening topics go through the same function.**
 *
 * Written in two places, the lock rules would become two sets and only one would read persistent state.
 * That mismatch shows up as "locked in the event, open in the evening".
 */
export function requirementMet(
	requires: Requirement | undefined,
	run: Run,
	career: Career,
): boolean {
	if (requires === undefined) return true;
	if (
		requires.note !== undefined &&
		!knownNotes(run, career).includes(requires.note)
	)
		return false;
	if (
		requires.trust !== undefined &&
		run.trust[requires.trust.member] < requires.trust.min
	)
		return false;
	if (requires.sync !== undefined && run.sync < requires.sync) return false;
	return true;
}

/**
 * **You can choose only what you know**: the rule is that this decision lives here, not in the screen.
 *
 * On the screen alone, a disabled button is a kindness, not enforcement, and one event would pass a
 * locked choice straight through. So the choice handling in \`main.tsx\` goes through this function first.
 */
export function choiceAvailable(
	choice: Choice,
	run: Run,
	career: Career,
): boolean {
	return requirementMet(choice.requires, run, career);
}

/**
 * Why it is locked: **a locked choice does not disappear; it says what is needed.**
 *
 * If it disappeared, the player would not even know such a path existed, and the reason to replay
 * would vanish. In this story, the reason to replay is this sentence.
 */
export function lockReason(
	choice: Choice,
	run: Run,
	career: Career,
): string | null {
	const requires = choice.requires;
	if (requires === undefined) return null;
	if (requires.note !== undefined && !knownNotes(run, career).includes(requires.note))
		return \`You need to learn more about \${MEMBERS[NOTES[requires.note].memberId].shortName}\`;
	if (
		requires.trust !== undefined &&
		run.trust[requires.trust.member] < requires.trust.min
	)
		return \`You need to be closer to \${MEMBERS[requires.trust.member].shortName}\`;
	if (requires.sync !== undefined && run.sync < requires.sync)
		return \`The five's total must be at least \${requires.sync}\`;
	return null;
}

export interface Applied {
	run: Run;
	career: Career;
	/** The fragment opened this time. The screen learns here whether to stand a card. */
	opened: NoteId | null;
}

/**
 * Applies a choice: **emits both saved states at once.**
 *
 * When a fragment opens it goes into both this run (\`run.opened\`) and persistence (\`career.notes\`).
 * Writing them separately would let a caller write only one side, making a fragment visible this run
 * but gone the next.
 *
 * **A locked choice changes nothing.** The decision runs here once more because the screen's
 * disabled state is not enforcement.
 */
export function applyChoice(
	run: Run,
	career: Career,
	choice: Choice,
): Applied {
	if (!choiceAvailable(choice, run, career))
		return { run, career, opened: null };

	const trust = { ...run.trust };
	if (choice.effect.trust !== undefined)
		for (const key of Object.keys(choice.effect.trust)) {
			const id = key as MemberId;
			const delta = choice.effect.trust[id];
			if (delta !== undefined) trust[id] = bump(trust[id], delta);
		}

	const condition = { ...run.condition };
	if (choice.effect.condition !== undefined)
		for (const key of Object.keys(choice.effect.condition)) {
			const id = key as MemberId;
			const delta = choice.effect.condition[id];
			if (delta !== undefined) condition[id] = bump(condition[id], delta);
		}

	const note = choice.effect.note;
	const alreadyKnown = note !== undefined && knownNotes(run, career).includes(note);
	const opened = note !== undefined && !alreadyKnown ? note : null;

	const nextRun: Run = {
		...run,
		trust,
		condition,
		sync: choice.effect.sync === undefined ? run.sync : bump(run.sync, choice.effect.sync),
		buzz: choice.effect.buzz === undefined ? run.buzz : bump(run.buzz, choice.effect.buzz),
		resolved: run.resolved.includes(choice.id)
			? run.resolved
			: [...run.resolved, choice.id],
		opened:
			note !== undefined && !run.opened.includes(note)
				? [...run.opened, note]
				: run.opened,
	};

	const nextCareer: Career =
		note === undefined || career.notes.includes(note)
			? career
			: { ...career, notes: [...career.notes, note] };

	return { run: nextRun, career: nextCareer, opened };
}

/** So the screen does not rewrite the trust cap: the bar reads this value. */
export { TRUST_MAX };

/**
 * Applies the evening's line: **a pure function that runs before generation.**
 *
 * A sibling of \`applyChoice\`. Only the entrance differs (a choice ↔ the sentence the player typed), and it
 * likewise emits both saved states at once. When a fragment opens it goes into both this run and persistence.
 *
 * **What opens here stays even if the provider fails.** That is the point of this order: what you learn
 * comes from the player asking, not from the model answering.
 */
export interface Spoken {
	run: Run;
	career: Career;
	opened: NoteId | null;
}

export function applyTopicOpen(
	run: Run,
	career: Career,
	memberId: MemberId,
	note: NoteId,
	trust: number,
): Spoken {
	if (knownNotes(run, career).includes(note))
		return { run, career, opened: null };
	return {
		run: {
			...run,
			trust: { ...run.trust, [memberId]: bump(run.trust[memberId], trust) },
			opened: run.opened.includes(note) ? run.opened : [...run.opened, note],
			revealed: note,
		},
		career: career.notes.includes(note)
			? career
			: { ...career, notes: [...career.notes, note] },
		opened: note,
	};
}

/** The first words with that person this evening: attached only once. */
export const FIRST_WORD_TRUST = 4;

export function applyFirstWord(run: Run, memberId: MemberId): Run {
	if (run.spoke) return run;
	return {
		...run,
		spoke: true,
		trust: {
			...run.trust,
			[memberId]: bump(run.trust[memberId], FIRST_WORD_TRUST),
		},
	};
}
`,
	},
	{
		path: "src/systems/relationships.ts",
		content: `import type { MemberId, Run, TrustBand } from "../types";
import { MEMBER_ORDER } from "../members";

/**
 * Trust: one value, and **the stage is derived.**
 *
 * Saving the stage would make room for the value and the stage to diverge, and that mismatch shows up
 * as "the bar is full but the tone is unchanged". The instructions and the screen both go through this function.
 */
export const TRUST_MAX = 100;

export function trustBand(value: number): TrustBand {
	if (value >= 80) return "close";
	if (value >= 55) return "trusted";
	if (value >= 30) return "working";
	return "distant";
}

export const TRUST_BAND_LABEL: Record<TrustBand, string> = {
	distant: "Distant",
	working: "Working together",
	trusted: "Trusted",
	close: "Close",
};

/** How many are at this stage or above. The ending decision and evaluation comments share it. */
export function membersAtLeast(run: Run, threshold: number): readonly MemberId[] {
	return MEMBER_ORDER.filter((id) => run.trust[id] >= threshold);
}

/** The most distant person. Read where the screen suggests whom to meet in the evening. */
export function mostDistant(run: Run): MemberId {
	let worst = MEMBER_ORDER[0];
	for (const id of MEMBER_ORDER)
		if (run.trust[id] < run.trust[worst]) worst = id;
	return worst;
}
`,
	},
	{
		path: "src/systems/schedule.ts",
		content: `import { MEMBER_ORDER, MEMBERS } from "../members";
import type {
	ActivityId,
	MemberId,
	ResultLine,
	Run,
	SkillId,
	Slot,
} from "../types";
import { SKILL_IDS } from "../types";
import { SKILL_LABEL, bump, clampStat } from "./stats";

/**
 * What to do in a week: **all of this story's deterministic rules live here.**
 *
 * The screen only draws this table and passes the result of presses to \`settleWeek\`; it never
 * touches the numbers. Writing effects on the screen would make the numbers the planner previews
 * diverge from what the settlement really adds, and that mismatch looks like **a lie** to the player.
 */

/** Slots per week. The planner and the settlement read the same value. */
export const SLOTS_PER_WEEK = 3;

export interface Activity {
	id: ActivityId;
	name: string;
	/** The line written on the card. */
	summary: string;
	/** Whether this slot picks a target: only individual coaching does. */
	personal: boolean;
	/** The effect summary on the card. It must say the same as the real effect below. */
	effect: string;
	/**
	 * The axis that stands as the big number on the settlement line: **written in the table.**
	 *
	 * Picking the largest value would make \`Fitness care\`'s headline Dance +1 and \`Sync practice\`'s
	 * Condition -4. What the point of an activity is, is a decision, not a calculation.
	 */
	headline: "skill" | "sync" | "buzz" | "condition" | "trust";
	skill: SkillId | null;
	skillGain: number;
	conditionDelta: number;
	trustDelta: number;
	syncDelta: number;
	buzzDelta: number;
}

export const ACTIVITIES: Record<ActivityId, Activity> = {
	"vocal-lesson": {
		id: "vocal-lesson",
		headline: "skill",
		name: "Vocal lesson",
		summary: "A teacher comes and sees the five one by one.",
		personal: false,
		effect: "Everyone Vocal +5 · Condition -6",
		skill: "vocal",
		skillGain: 5,
		conditionDelta: -6,
		trustDelta: 0,
		syncDelta: 0,
		buzzDelta: 0,
	},
	choreo: {
		id: "choreo",
		headline: "skill",
		name: "Choreography practice",
		summary: "The same eight bars, repeated in front of the mirror.",
		personal: false,
		effect: "Everyone Dance +6 · Sync +2 · Condition -9",
		skill: "dance",
		skillGain: 6,
		conditionDelta: -9,
		trustDelta: 0,
		syncDelta: 2,
		buzzDelta: 0,
	},
	expression: {
		id: "expression",
		headline: "skill",
		name: "Expression class",
		summary: "Learn how to look into the camera and how to use expressions.",
		personal: false,
		effect: "Everyone Expression +5 · Condition -6",
		skill: "expression",
		skillGain: 5,
		conditionDelta: -6,
		trustDelta: 0,
		syncDelta: 0,
		buzzDelta: 0,
	},
	conditioning: {
		id: "conditioning",
		headline: "condition",
		name: "Fitness care",
		summary: "Call in a trainer and change the diet.",
		personal: false,
		effect: "Everyone Condition +14 · Dance +1",
		skill: "dance",
		skillGain: 1,
		conditionDelta: 14,
		trustDelta: 0,
		syncDelta: 0,
		buzzDelta: 0,
	},
	content: {
		id: "content",
		headline: "buzz",
		name: "Original content shoot",
		summary: "Set a camera in the practice room and film a day.",
		personal: false,
		effect: "Buzz +9 · Expression +2 · Condition -5",
		skill: "expression",
		skillGain: 2,
		conditionDelta: -5,
		trustDelta: 0,
		syncDelta: 0,
		buzzDelta: 9,
	},
	sync: {
		id: "sync",
		headline: "sync",
		name: "Sync practice",
		summary: "Only formations and timing. No music.",
		personal: false,
		effect: "Sync +9 · Everyone Trust +2 · Condition -4",
		skill: null,
		skillGain: 0,
		conditionDelta: -4,
		trustDelta: 2,
		syncDelta: 9,
		buzzDelta: 0,
	},
	private: {
		id: "private",
		headline: "skill",
		name: "Individual coaching",
		summary: "Hold one person back. Their weakest axis rises.",
		personal: true,
		effect: "Target's lowest axis +9 · Trust +6 · Condition -7",
		skill: null,
		skillGain: 9,
		conditionDelta: -7,
		trustDelta: 6,
		syncDelta: 0,
		buzzDelta: 0,
	},
	rest: {
		id: "rest",
		headline: "condition",
		name: "Rest",
		summary: "Clear the day. Nobody comes to the practice room.",
		personal: false,
		effect: "Everyone Condition +20 · Trust +3 · Buzz -4",
		skill: null,
		skillGain: 0,
		conditionDelta: 20,
		trustDelta: 3,
		syncDelta: 0,
		buzzDelta: -4,
	},
};

export const ACTIVITY_IDS: readonly ActivityId[] = [
	"vocal-lesson",
	"choreo",
	"expression",
	"sync",
	"private",
	"content",
	"conditioning",
	"rest",
];

/**
 * Putting the same activity in a week twice **gains less from the second on.**
 *
 * This one line makes planning a choice. Without diminishing returns the answer is always "the best
 * three", and the planner becomes a place to confirm rather than to choose.
 */
export const REPEAT_FACTOR: readonly number[] = [1, 0.6, 0.3];

const factorFor = (repeat: number): number =>
	REPEAT_FACTOR[repeat < REPEAT_FACTOR.length ? repeat : REPEAT_FACTOR.length - 1];

/**
 * Exhausted people don't learn: below condition 30, skill gains are halved.
 *
 * If condition only cut the score, the answer would be "grind to the end and rest in the final week".
 * Tying it to learning makes that strategy lose on its own.
 */
export const EXHAUSTED_BELOW = 30;

/** That member's lowest axis: where individual coaching raises. */
export function weakestSkill(run: Run, memberId: MemberId): SkillId {
	let worst = SKILL_IDS[0];
	for (const id of SKILL_IDS)
		if (run.skills[memberId][id] < run.skills[memberId][worst]) worst = id;
	return worst;
}

/** A week with nothing planned. A new run and a week change use the same value. */
export const EMPTY_SLOTS: readonly (Slot | null)[] = [null, null, null];

/** Whether the plan is complete. With an empty slot you cannot move on. */
export const scheduleReady = (slots: readonly (Slot | null)[]): boolean =>
	slots.length === SLOTS_PER_WEEK &&
	slots.every(
		(slot) =>
			slot !== null &&
			(!ACTIVITIES[slot.activity].personal || slot.target !== null),
	);

/** A signed number: the settlement line writes \`+6\` and \`-9\` by the same rule. */
const signed = (value: number): string =>
	value >= 0 ? \`+\${value}\` : \`\${value}\`;

/** How much attention cools in a week with nothing done. */
export const WEEKLY_BUZZ_DECAY = 2;

export interface WeekOutcome {
	run: Run;
	lines: readonly ResultLine[];
}

/**
 * Settles one week: **pure.** The same plan always gives the same result.
 *
 * No randomness is this story's promise. The effects the planner shows and the values added here must
 * match, and randomness would break that promise; instead diminishing returns and condition
 * make results diverge.
 */
export function settleWeek(run: Run, slots: readonly (Slot | null)[]): WeekOutcome {
	const skills = { ...run.skills };
	for (const id of MEMBER_ORDER) skills[id] = { ...run.skills[id] };
	const condition = { ...run.condition };
	const trust = { ...run.trust };
	let sync = run.sync;
	let buzz = run.buzz;
	const lines: ResultLine[] = [];
	const seen: Partial<Record<ActivityId, number>> = {};

	for (const slot of slots) {
		if (slot === null) continue;
		const activity = ACTIVITIES[slot.activity];
		const repeat = seen[slot.activity] ?? 0;
		seen[slot.activity] = repeat + 1;
		const factor = factorFor(repeat);
		const scale = (value: number): number =>
			value === 0 ? 0 : Math.round(value * factor);

		/** What this slot really did: the screen's detail line joins these pieces. */
		const parts: string[] = [];
		const axis: Partial<Record<Activity["headline"], number>> = {};

		if (activity.personal) {
			const target = slot.target;
			if (target === null) continue;
			const skill = weakestSkill(run, target);
			const tired = condition[target] < EXHAUSTED_BELOW;
			const gain = Math.round(scale(activity.skillGain) * (tired ? 0.5 : 1));
			const shift = scale(activity.conditionDelta);
			const closer = scale(activity.trustDelta);
			skills[target][skill] = bump(skills[target][skill], gain);
			condition[target] = bump(condition[target], shift);
			trust[target] = bump(trust[target], closer);
			axis.skill = gain;
			axis.condition = shift;
			axis.trust = closer;
			parts.push(\`\${SKILL_LABEL[skill]} \${signed(gain)}\`);
			parts.push(\`Trust \${signed(closer)}\`);
			parts.push(\`Condition \${signed(shift)}\`);
			if (tired) parts.push("half from exhaustion");
			lines.push({
				label: \`\${activity.name} · \${MEMBERS[target].shortName}\`,
				detail: parts.join(" · "),
				delta: axis[activity.headline] ?? gain,
			});
			continue;
		}

		if (activity.skill !== null && activity.skillGain > 0) {
			const gain = scale(activity.skillGain);
			let tiredCount = 0;
			for (const id of MEMBER_ORDER) {
				const tired = condition[id] < EXHAUSTED_BELOW;
				if (tired) tiredCount += 1;
				skills[id][activity.skill] = bump(
					skills[id][activity.skill],
					Math.round(gain * (tired ? 0.5 : 1)),
				);
			}
			axis.skill = gain;
			parts.push(\`Everyone \${SKILL_LABEL[activity.skill]} \${signed(gain)}\`);
			if (tiredCount > 0) parts.push(\`\${tiredCount} got half from exhaustion\`);
		}

		if (activity.syncDelta !== 0) {
			const shift = scale(activity.syncDelta);
			sync = bump(sync, shift);
			axis.sync = shift;
			parts.push(\`Sync \${signed(shift)}\`);
		}

		if (activity.buzzDelta !== 0) {
			const shift = scale(activity.buzzDelta);
			buzz = bump(buzz, shift);
			axis.buzz = shift;
			parts.push(\`Buzz \${signed(shift)}\`);
		}

		if (activity.trustDelta !== 0) {
			const shift = scale(activity.trustDelta);
			for (const id of MEMBER_ORDER) trust[id] = bump(trust[id], shift);
			axis.trust = shift;
			parts.push(\`Everyone Trust \${signed(shift)}\`);
		}

		if (activity.conditionDelta !== 0) {
			const shift = scale(activity.conditionDelta);
			for (const id of MEMBER_ORDER) condition[id] = bump(condition[id], shift);
			axis.condition = shift;
			parts.push(\`Everyone Condition \${signed(shift)}\`);
		}

		lines.push({
			label: repeat === 0 ? activity.name : \`\${activity.name} (repeat)\`,
			detail: parts.join(" · "),
			delta: axis[activity.headline] ?? 0,
		});
	}

	/**
	 * Left alone it cools: if buzz held still in weeks with nothing done, filming once and holding out
	 * to the end would be the answer.
	 */
	buzz = clampStat(buzz - WEEKLY_BUZZ_DECAY);

	return {
		run: { ...run, skills, condition, trust, sync, buzz },
		lines,
	};
}
`,
	},
	{
		path: "src/systems/stats.ts",
		content: `import { MEMBER_ORDER, MEMBERS } from "../members";
import { SKILL_IDS } from "../types";
import type { MemberId, Run, SkillId, Skills } from "../types";

/**
 * Rules for numbers: **clamped in one place only.**
 *
 * Writing the caps at every place that computes would let one place save over 100, and that value
 * pushes the bar off the screen. Every path that moves a stat goes through \`bump\`.
 */
export const STAT_MAX = 100;
export const STAT_MIN = 0;

export const clampStat = (value: number): number =>
	value < STAT_MIN ? STAT_MIN : value > STAT_MAX ? STAT_MAX : value;

export const bump = (value: number, delta: number): number =>
	clampStat(value + delta);

export const SKILL_LABEL: Record<SkillId, string> = {
	vocal: "Vocal",
	dance: "Dance",
	expression: "Expression",
};

/** One member's skill: the average of three axes. The screen and the evaluation see the same value. */
export function memberSkill(skills: Skills): number {
	let total = 0;
	for (const id of SKILL_IDS) total += skills[id];
	return Math.round(total / SKILL_IDS.length);
}

/** The five's average skill. */
export function groupSkill(run: Run): number {
	let total = 0;
	for (const id of MEMBER_ORDER) total += memberSkill(run.skills[id]);
	return Math.round(total / MEMBER_ORDER.length);
}

/**
 * The score on stage: **half skill, half the rest.**
 *
 * That raising each of the five alone doesn't pass is this story's rule, and that fact lives in this
 * one line. With low condition, skill doesn't show fully.
 */
export function stageScore(run: Run): number {
	const skill = groupSkill(run);
	const fitness = Math.round(averageCondition(run));
	const base = skill * 0.5 + run.sync * 0.3 + run.buzz * 0.2;
	/** Condition below 60 cuts the score. There is no bonus above: rest is recovery, not gain. */
	const penalty = fitness >= 60 ? 0 : (60 - fitness) * 0.4;
	return clampStat(Math.round(base - penalty));
}

export function averageCondition(run: Run): number {
	let total = 0;
	for (const id of MEMBER_ORDER) total += run.condition[id];
	return total / MEMBER_ORDER.length;
}

/** The most exhausted person. The briefing mentions this first. */
export function mostTired(run: Run): MemberId {
	let worst = MEMBER_ORDER[0];
	for (const id of MEMBER_ORDER)
		if (run.condition[id] < run.condition[worst]) worst = id;
	return worst;
}

/** The lowest-skilled person. Read where individual coaching is suggested. */
export function weakestMember(run: Run): MemberId {
	let worst = MEMBER_ORDER[0];
	for (const id of MEMBER_ORDER)
		if (memberSkill(run.skills[id]) < memberSkill(run.skills[worst])) worst = id;
	return worst;
}

/**
 * Number → a one-letter grade. The evaluation screen and member cards share the table.
 *
 * It does not speak by color alone: on low-contrast screens color fades and letters remain.
 */
export function grade(value: number): string {
	if (value >= 85) return "S";
	if (value >= 70) return "A";
	if (value >= 55) return "B";
	if (value >= 40) return "C";
	return "D";
}

export const CONDITION_LABEL = (value: number): string => {
	if (value >= 80) return "Good";
	if (value >= 60) return "Okay";
	if (value >= 40) return "Tired";
	return "At the limit";
};

/** The initial five. The definition's \`initial\` and \`Restart\` use the same value. */
export function initialSkills(): Record<MemberId, Skills> {
	const skills = {} as Record<MemberId, Skills>;
	for (const id of MEMBER_ORDER) skills[id] = { ...MEMBERS[id].skills };
	return skills;
}

export function initialCondition(): Record<MemberId, number> {
	const condition = {} as Record<MemberId, number>;
	for (const id of MEMBER_ORDER) condition[id] = MEMBERS[id].condition;
	return condition;
}

export function initialTrust(): Record<MemberId, number> {
	const trust = {} as Record<MemberId, number>;
	for (const id of MEMBER_ORDER) trust[id] = MEMBERS[id].trust;
	return trust;
}
`,
	},
	{
		path: "src/systems/topics.ts",
		content: `import { type Topic, topicsOf } from "../story/topics";
import type { Career, MemberId, Run } from "../types";
import { knownNotes } from "./notes";
import { requirementMet } from "./progression";

/**
 * **What was asked**: finds a topic in one sentence the player typed.
 *
 * This file is the only channel through which AI conversation becomes progress in this story. Even so
 * the decision stays deterministic: what it reads is **user input**, and the model's answer never comes
 * here. It has the same shape as this repository opening lore by keyword, and is safe for the same
 * reason: the same sentence always gives the same result.
 *
 * \`\`\`text
 * player's sentence → matchTopic → a fragment opens if it can → that fact rides in the instructions
 *                                                          → the model answers in that character's voice
 * \`\`\`
 *
 * The order is the rule. Fragments open **before generation**, so the instructions can say "you may tell
 * this story now", and above all **what was learned stays even if the provider fails** (progress
 * stands even in a preview with AI off).
 */

/**
 * Into a shape good for finding words: reduces wobble in whitespace and case.
 *
 * No morphological analysis. Instead of bringing that weight in, keywords are kept as short stems (\`story/
 * topics.ts\`'s \`keywords\`), and removing whitespace alone makes \`"does your knee hurt"\` and \`"KNEE hurt?"\` hold the same
 * word.
 */
export const normalizeMessage = (text: string): string =>
	text.replace(/\\s+/g, "").toLowerCase();

const touches = (text: string, topic: Topic): boolean => {
	const normalized = normalizeMessage(text);
	return topic.keywords.some((keyword) =>
		normalized.includes(normalizeMessage(keyword)),
	);
};

export interface TopicMatch {
	topic: Topic;
	/** Whether it can open now; otherwise that character deflects. */
	open: boolean;
}

/**
 * The topic this sentence touched: \`null\` if none.
 *
 * When several match, **ones that can open come first.** Reversed, an already known story or one that
 * cannot open yet would block the way, and saying something that could open now would do nothing.
 */
export function matchTopic(
	run: Run,
	career: Career,
	memberId: MemberId,
	text: string,
): TopicMatch | null {
	const known = knownNotes(run, career);
	const touched = topicsOf(memberId).filter((topic) => touches(text, topic));
	if (touched.length === 0) return null;
	const openable = touched.find(
		(topic) =>
			!known.includes(topic.note) && requirementMet(topic.requires, run, career),
	);
	if (openable !== undefined) return { topic: openable, open: true };
	return { topic: touched[0], open: false };
}

/**
 * What to ask about now: observations of topics **whose conditions are met and not yet known.**
 *
 * These stand instead of prepared questions. The player decides what to ask in their own words, and
 * the screen only says *what can be seen*.
 */
export function visibleHints(
	run: Run,
	career: Career,
	memberId: MemberId,
): readonly string[] {
	const known = knownNotes(run, career);
	return topicsOf(memberId)
		.filter(
			(topic) =>
				!known.includes(topic.note) && requirementMet(topic.requires, run, career),
		)
		.map((topic) => topic.hint);
}

/** Whether that person has stories left: regardless of conditions. */
export const hasMoreToTell = (
	run: Run,
	career: Career,
	memberId: MemberId,
): boolean => {
	const known = knownNotes(run, career);
	return topicsOf(memberId).some((topic) => !known.includes(topic.note));
};
`,
	},
];
