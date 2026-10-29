import type { RuntimeTemplateFile } from "../types.ts";

/**
 * Story text: company, the eight weeks, incident, interview topics, evaluation, and ending.
 * Contains no rules.
 */
export const STORY_FILES: readonly RuntimeTemplateFile[] = [
	{
		path: "src/story/agency.ts",
		content: `/**
 * This story's stage: **the company and the deadline.** Constants, not saved.
 *
 * Several places on screen call the same names, so they live in one place. Writing the sentences per
 * screen would turn renaming the company into editing eight files.
 */
export const AGENCY = {
	company: "Halfmoon Company",
	/** Until debut this team has no name. The name comes at the end. */
	team: "Trainee Group A",
	room: "Practice building, 3F room B",
	/** Weeks left until the debut evaluation. The length of one run. */
	weeks: 8,
	manager: "Director Kim",
} as const;

export const OPENING = {
	title: "Eight Weeks to Debut",
	subtitle: \`\${AGENCY.company} · \${AGENCY.room}\`,
	lines: [
		\`\${AGENCY.company} is forming a debut group for the first time in three years. Five members, no name yet.\`,
		\`You are the manager assigned to this team. The debut evaluation is in eight weeks, and if they fail, the group breaks up.\`,
		"Each week you plan three slots, and each evening you stay behind with one member. Skills rise as you plan; the rest depends on the time you stay.",
	],
	/** The rules in one line for a first-time player. */
	hint: "Skill alone won't pass. The five have to fit together, and nobody learns while exhausted.",
} as const;
`,
	},
	{
		path: "src/story/endings.ts",
		content: `import { MEMBER_ORDER } from "../members";
import { knowsEveryone } from "../systems/notes";
import { stageScore } from "../systems/stats";
import type { Career, EndingId, MemberId, Run } from "../types";
import { EVALUATIONS } from "./evaluations";

/**
 * Endings: **one function decides them.**
 *
 * If the conditions were scattered across screens, each screen would draw a different ending. It
 * takes two arguments because the hidden ending reads **what carried over across runs**: however good
 * these eight weeks are, that door stays shut without knowing all five, and someone who does knows a different first door.
 */
export interface Ending {
	id: EndingId;
	title: string;
	subtitle: string;
	summary: string;
	/** No name stands in the list before this ending is seen. */
	secret: boolean;
	/** Whether a group name is given: only in debut endings. */
	debuted: boolean;
}

export const ENDINGS: Record<EndingId, Ending> = {
	disbanded: {
		id: "disbanded",
		title: "Disbanded",
		subtitle: "Eight weeks later",
		summary:
			"The evaluation was over in fifteen minutes. The next week the nameplate on 3F room B came down. The five scattered to different floors, and two of them left the company.",
		secret: false,
		debuted: false,
	},
	debut: {
		id: "debut",
		title: "Debut",
		subtitle: "The day they got a name",
		summary:
			"They passed. The team name came down the next week: it borrowed the half moon from Halfmoon as is. None of the five liked it, and none of them said so. The stage is in two months.",
		secret: false,
		debuted: true,
	},
	five: {
		id: "five",
		title: "All Five",
		subtitle: "Not four",
		summary:
			"They passed, and all five passed together. After the evaluation one of the directors asked who the center of this team was. Haram answered: we haven't decided yet. That was the best answer anyone gave that day.",
		secret: false,
		debuted: true,
	},
	encore: {
		id: "encore",
		title: "Backstage",
		subtitle: "An ending only someone who knows all five sees",
		summary:
			"The stage is over and the five sit in the waiting room. Nobody speaks first. I know the whole story of how each of the five people in this room got here, and that was not something eight weeks could teach. I know it because this is not my first time.",
		secret: true,
		debuted: true,
	},
};

export const ENDING_IDS: readonly EndingId[] = [
	"disbanded",
	"debut",
	"five",
	"encore",
];

/** The debut evaluation's baseline. Endings and evaluations read the same value. */
export const FINAL_THRESHOLD =
	EVALUATIONS[EVALUATIONS.length - 1]?.threshold ?? 58;

/** The condition for "All Five". The ending screen also writes this value out. */
export const FIVE_SYNC = 78;
export const FIVE_TRUST = 62;

const everyoneAtLeast = (run: Run, min: number): boolean =>
	MEMBER_ORDER.every((id: MemberId) => run.trust[id] >= min);

/**
 * How these eight weeks end.
 *
 * The order is the rule: a failure asks nothing further, and a pass checks **the narrowest door first**.
 * Reversed, someone who knows all five would be caught by "All Five" and never see the hidden
 * ending.
 */
export function resolveEnding(run: Run, career: Career): EndingId {
	if (stageScore(run) < FINAL_THRESHOLD) return "disbanded";
	if (knowsEveryone(run, career)) return "encore";
	if (run.sync >= FIVE_SYNC && everyoneAtLeast(run, FIVE_TRUST)) return "five";
	return "debut";
}

/** The name written in the list. A hidden ending not yet seen gets no name. */
export const endingLabel = (id: EndingId, unlocked: boolean): string =>
	!unlocked && ENDINGS[id].secret ? "???" : ENDINGS[id].title;
`,
	},
	{
		path: "src/story/evaluations.ts",
		content: `import { MEMBER_ORDER, MEMBERS } from "../members";
import {
	averageCondition,
	grade,
	groupSkill,
	memberSkill,
	stageScore,
	weakestMember,
} from "../systems/stats";
import type { Run } from "../types";

/**
 * Reviews and the evaluation: **the same function is called three times.**
 *
 * The reviews at the end of weeks 2 and 5 and the final debut evaluation differ only in baseline.
 * Written as separate screens, a midpoint review could say pass while the final one fails, and then
 * the player would not know what to trust.
 */
export interface Evaluation {
	week: number;
	title: string;
	/** The score to beat to pass. */
	threshold: number;
	/** Whether failing here ends the run: only the last one. */
	decisive: boolean;
	intro: string;
}

export const EVALUATIONS: readonly Evaluation[] = [
	{
		week: 2,
		title: "First review",
		threshold: 28,
		decisive: false,
		intro:
			"A director and an A&R rep came in. It took fifteen minutes, and the five did only the first verse.",
	},
	{
		week: 5,
		title: "Second review",
		threshold: 44,
		decisive: false,
		intro:
			"The first look at the new song. They were told in advance that comments would go up on the wall.",
	},
	{
		week: 8,
		title: "Debut evaluation",
		threshold: 58,
		decisive: true,
		intro:
			"Friday, 2 p.m., the big practice room on 3F. Three directors sat down, and none of them took notes.",
	},
];

export const evaluationFor = (week: number): Evaluation | null =>
	EVALUATIONS.find((evaluation) => evaluation.week === week) ?? null;

export interface Verdict {
	score: number;
	threshold: number;
	passed: boolean;
	headline: string;
	/** Two or three lines on what is lacking. Sentences say it, not colors. */
	comments: readonly string[];
}

/**
 * One verdict: **pure.** The same state always yields the same comments.
 *
 * The point is that comments derive from the score. Saved separately, a play in progress would keep
 * seeing old comments after the manuscript changed, and those sentences would not match the numbers on screen.
 */
export function judge(run: Run, evaluation: Evaluation): Verdict {
	const score = stageScore(run);
	const passed = score >= evaluation.threshold;
	const skill = groupSkill(run);
	const fitness = Math.round(averageCondition(run));
	const comments: string[] = [];

	if (run.sync < 45)
		comments.push("Each of the five is good alone. They don't look like they're performing together.");
	else if (run.sync >= 75)
		comments.push("The formations line up. When one wobbles, the rest hold on.");

	if (fitness < 45)
		comments.push(\`Not in shape for a stage. Average condition \${fitness}.\`);
	else if (fitness < 60)
		comments.push("The sound drops in the second half. A stamina problem.");

	if (run.buzz < 30)
		comments.push("Nobody knows their names before debut. That's the company's job, but right now there's nothing.");
	else if (run.buzz >= 70)
		comments.push("Practice videos are getting a good response. That expectation could weigh on the stage.");

	const weakest = weakestMember(run);
	if (memberSkill(run.skills[weakest]) < skill - 12)
		comments.push(
			\`\${MEMBERS[weakest].shortName} trails visibly behind the other four. Lift them together, or change positions.\`,
		);

	if (comments.length === 0)
		comments.push("Nothing in particular to point out. Whether that's praise, the next stage will tell.");

	const headline = passed
		? evaluation.decisive
			? "Debut confirmed"
			: \`Pass · \${grade(score)}\`
		: evaluation.decisive
			? "Debut on hold"
			: \`Below the bar · \${grade(score)}\`;

	return { score, threshold: evaluation.threshold, passed, headline, comments };
}

/** The five individual grades. The evaluation screen draws one line each. */
export function memberGrades(
	run: Run,
): readonly { id: (typeof MEMBER_ORDER)[number]; score: number; grade: string }[] {
	return MEMBER_ORDER.map((id) => {
		const score = memberSkill(run.skills[id]);
		return { id, score, grade: grade(score) };
	});
}
`,
	},
	{
		path: "src/story/events.ts",
		content: `import type { Choice } from "../systems/progression";

/**
 * What happens once a week: **where one choice changes progress.**
 *
 * Not every week has one. If every week did, events would become routine and the choices would go unread.
 *
 * ## The third choice is usually locked
 *
 * And that lock opens with **what you learned in a previous run** (\`requires.note\`). A first-time
 * player reads that line and learns what is needed, and in the next run can choose something else
 * at the same moment: this structure is why you replay this story.
 */
export interface WeekEvent {
	week: number;
	title: string;
	body: string;
	choices: readonly Choice[];
}

export const EVENTS: readonly WeekEvent[] = [
	{
		week: 2,
		title: "After practice",
		body: "Everyone has left, but Yeonwoo is still in the practice room. You saw them steady themself on the wall while standing up. When your eyes meet, Yeonwoo puts on a face that says it's nothing.",
		choices: [
			{
				id: "w2-leave",
				label: "Pretend not to notice",
				detail: "They'll talk when they want to.",
				effect: { trust: { yeonwoo: -3 }, sync: -2 },
				outcome:
					"The next day Yeonwoo came in earlier than usual and said nothing. After that you never saw them lean on the wall again; they only did it where you couldn't see.",
			},
			{
				id: "w2-ask",
				label: "Call them aside",
				detail: "If you don't ask now, there may not be a next time.",
				effect: { trust: { yeonwoo: 6 }, note: "yeonwoo-knee" },
				outcome:
					"Yeonwoo said nothing for a long while, then said they didn't know since when. When you brought up the hospital they changed the subject, but they didn't deny it.",
			},
			{
				id: "w2-clinic",
				label: "Book a hospital appointment",
				detail: "Don't ask; just clear the time.",
				requires: { note: "yeonwoo-knee" },
				effect: { trust: { yeonwoo: 10 }, condition: { yeonwoo: 12 } },
				outcome:
					"You only said you'd cleared Thursday afternoon. Yeonwoo didn't ask why, and went that day. Coming back, they spoke to you first for the first time.",
			},
		],
	},
	{
		week: 3,
		title: "Lyric revision request",
		body: "A&R asked to replace Siha's verse entirely. Siha asked why, and no answer came. Siha isn't coming into the practice room; they're standing in the hallway.",
		choices: [
			{
				id: "w3-company",
				label: "Suggest doing what the company says",
				detail: "It's only eight weeks. There's no time to fight.",
				effect: { trust: { siha: -8 }, buzz: 5 },
				outcome:
					"Siha said fine. The lyrics written that week were inoffensive, and A&R used the word inoffensive as praise.",
			},
			{
				id: "w3-side",
				label: "Promise to get a reason",
				detail: "You can only fix it if you at least know why.",
				effect: { trust: { siha: 10 }, buzz: -4, note: "siha-crew" },
				outcome:
					"A&R never gave a reason. Instead, that evening Siha told you a little about themself: the people they used to work with are still around.",
			},
			{
				id: "w3-credit",
				label: "Suggest putting the credits in writing",
				detail: "Revising is fine. The name stays.",
				requires: { note: "siha-credit" },
				effect: { trust: { siha: 14 }, sync: 5 },
				outcome:
					"Siha was speechless for a moment and didn't ask how you knew. The lyrics were revised three times that week, and Siha made each revision first.",
			},
		],
	},
	{
		week: 4,
		title: "A 2 a.m. notification",
		body: "Comments came in on a short video posted to the practice account. Most are supportive and a few aren't. You found out Roun was reading them until 2 a.m.",
		choices: [
			{
				id: "w4-block",
				label: "Take over the account",
				detail: "From now on, I'll read those.",
				effect: { trust: { roun: 2 }, condition: { roun: -4 } },
				outcome:
					"Roun said thanks. Then the next day they found and read the same comments from another account.",
			},
			{
				id: "w4-read",
				label: "Read them together",
				detail: "You won't let them read alone.",
				effect: { trust: { roun: 8 }, note: "roun-audition" },
				outcome:
					"The two of you sat and read to the end. When you finished, Roun asked whether it was strange to keep going after failing eleven times.",
			},
			{
				id: "w4-lights",
				label: "Change the dorm's lights-out time",
				detail: "The problem isn't the comments; it's 2 a.m.",
				requires: { note: "roun-sleep" },
				effect: { trust: { roun: 8 }, condition: { roun: 14 } },
				outcome:
					"You had the shared Wi-Fi cut off at midnight. Roun said nothing, and from that week the morning smile looked a little different.",
			},
		],
	},
	{
		week: 5,
		title: "The night the song changed",
		body: "The new song's key is a half step higher. After everyone left, Haram stayed alone repeating the same phrase. It has been two hours already.",
		choices: [
			{
				id: "w5-stop",
				label: "Tell them to stop and go home",
				detail: "Pushing now only hurts the throat.",
				effect: { trust: { haram: 4 }, condition: { haram: 12 } },
				outcome:
					"Haram packed up without protest and said sorry on the way out. They didn't say what for.",
			},
			{
				id: "w5-stay",
				label: "Stay with them",
				detail: "It's different when someone is listening.",
				effect: { trust: { haram: 10 }, condition: { haram: -6 }, note: "haram-cut" },
				outcome:
					"In the third hour Haram stopped and sat down. There was a debut group two years ago too, they said, and three weeks before the announcement the five became four.",
			},
			{
				id: "w5-key",
				label: "Ask to lower the key",
				detail: "The song should fit the person, not the other way around.",
				requires: { note: "haram-cut" },
				effect: { trust: { haram: 12 }, sync: 4 },
				outcome:
					"A&R asked what the big deal was about a half step, and you told them who this team's main vocalist is. The key came down a half step. When Haram heard what you'd said, they couldn't answer for a while.",
			},
		],
	},
	{
		week: 6,
		title: "The empty spot",
		body: "Jio hasn't come to the practice room for two days. Messages are read and unanswered. None of the other four bring it up.",
		choices: [
			{
				id: "w6-wait",
				label: "Wait",
				detail: "Whoever is coming back will come back.",
				effect: { trust: { jio: -6 }, sync: -3 },
				outcome:
					"Jio came back on the third day. Nobody asked where they'd been, and Jio didn't say. Since then Jio stands only by the mirror in the practice room.",
			},
			{
				id: "w6-visit",
				label: "Go find them",
				detail: "Read means they're watching.",
				effect: { trust: { jio: 9 }, note: "jio-cast" },
				outcome:
					"Jio was on a bench outside the school. This is where they got the business card, they said. Of the five, they're the only one who never auditioned.",
			},
			{
				id: "w6-list",
				label: "Write down how the five started and show it",
				detail: "It's true that only one came from the street. What that means is another matter.",
				requires: { note: "jio-mirror" },
				effect: { trust: { jio: 12 }, sync: 6 },
				outcome:
					"You wrote five lines on paper: 7 years, 4 years, 3 years, 2 years, 1 year. Next to the last line you wrote this week's expression score. Jio folded the paper and took it.",
			},
		],
	},
	{
		week: 7,
		title: "Four is enough",
		body:
			"Word came from upstairs: five is too many; cut to four and the debut is certain. The manager is to decide who goes.",
		choices: [
			{
				id: "w7-refuse",
				label: "Answer that you won't",
				detail: "This team is five.",
				effect: {
					trust: { haram: 5, yeonwoo: 5, siha: 5, roun: 5, jio: 5 },
					sync: 8,
					buzz: -6,
				},
				outcome:
					"Upstairs only said understood. That week's promotion budget quietly shrank. The five don't know.",
			},
			{
				id: "w7-delay",
				label: "Suggest talking after the evaluation",
				detail: "If this leaks now, the eight weeks are over.",
				effect: { buzz: 4 },
				outcome:
					"You bought time. In exchange, all that week you couldn't look the five in the face.",
			},
			{
				id: "w7-together",
				label: "Submit in writing that all five go together",
				detail: "Spoken promises get overturned.",
				requires: { sync: 60 },
				effect: {
					trust: { haram: 8, yeonwoo: 8, siha: 8, roun: 8, jio: 8 },
					sync: 12,
				},
				outcome:
					"You put five names on the proposal and submitted it. It wasn't rejected. That evening all five stayed in the practice room, and nobody said why.",
			},
		],
	},
];

export const eventFor = (week: number): WeekEvent | null =>
	EVENTS.find((event) => event.week === week) ?? null;
`,
	},
	{
		path: "src/story/topics.ts",
		content: `import type { MemberId, NoteId } from "../types";
import type { Requirement } from "../systems/progression";

/**
 * What you **can ask about** in the evening: not prepared questions but a table of *what can be learned*.
 *
 * \`\`\`text
 * before   four questions stood as buttons, and pressing one showed a prepared answer
 * now      the player speaks in their own words → code decides what was asked → that character answers
 * \`\`\`
 *
 * So this table holds **no sentence that goes to the screen as is.** \`hint\` is an observation that
 * suggests something to ask about, and the other two are material for the instructions. Every line the player reads is generated.
 *
 * ## Code still makes the decision
 *
 * What you learn is decided by **the sentence the player typed** (\`matchTopic\` in \`systems/topics.ts\`).
 * It is not decided by reading the model's answer: that approach is brittle, and above all it teaches a
 * first-time creator a structure where *parsing the model's sentences becomes a save rule*. What code reads here
 * is user input, the same shape as this repository opening lore by keyword.
 *
 * ## A locked topic does not disappear
 *
 * Bringing it up before the conditions are met makes that character **deflect**. The deflection is
 * generated speech too, and \`deflect\` writes that attitude into the instructions. The screen does not say "locked" because
 * what is locked here is not a choice but **something that person does not want to say yet**.
 */
export interface Topic {
	id: string;
	memberId: MemberId;
	/** The fragment this topic opens. This is the only way to open it. */
	note: NoteId;
	/**
	 * Words looked for in the player's sentence: **kept short, as stems.**
	 *
	 * \`"Does your knee hurt?"\` and \`"Is your knee okay"\` must be the same topic, so word endings are
	 * left off. Words that are too broad (\`why\`, \`you\`) would swallow other topics, so they are not used.
	 */
	keywords: readonly string[];
	requires?: Requirement;
	/** An **observation** suggesting something to ask. Shown only when the conditions are met and it is not yet known. */
	hint: string;
	/** How that character deflects when a topic that cannot open yet comes up: goes into the instructions. */
	deflect: string;
	/** Trust gained when it opens. */
	trust: number;
}

export const TOPICS: readonly Topic[] = [
	{
		id: "haram-1",
		memberId: "haram",
		note: "haram-cut",
		keywords: ["seven", "7 years", "so long", "years", "before", "since when", "how long", "always", "this far"],
		hint: "It's Haram's seventh year. Nobody has asked why they push this far.",
		deflect: "Laughs it off and steers back to practice.",
		trust: 9,
	},
	{
		id: "haram-2",
		memberId: "haram",
		note: "haram-throat",
		requires: { note: "haram-cut", trust: { member: "haram", min: 50 } },
		keywords: ["throat", "vocal cord", "voice", "sound", "hospital", "hoarse", "check"],
		hint: "Every morning Haram checks their voice once before starting the day.",
		deflect: "Only says it's fine and brings up something else.",
		trust: 10,
	},
	{
		id: "haram-3",
		memberId: "haram",
		note: "haram-quit",
		requires: { note: "haram-throat", trust: { member: "haram", min: 72 } },
		keywords: ["last", "quit", "give up", "deadline", "leave", "end it", "locker", "pack"],
		hint: "Haram's locker is half empty. It looks packed once and then put back.",
		deflect: "Goes quiet for a moment, then asks not to talk about that.",
		trust: 12,
	},
	{
		id: "yeonwoo-1",
		memberId: "yeonwoo",
		note: "yeonwoo-knee",
		keywords: ["knee", "leg", "limp", "wall", "hurt", "pain", "hospital", "injur"],
		hint: "After practice, Yeonwoo steadies themself on the wall when standing up.",
		deflect: "Answers briefly that it's nothing.",
		trust: 9,
	},
	{
		id: "yeonwoo-2",
		memberId: "yeonwoo",
		note: "yeonwoo-stage",
		requires: { note: "yeonwoo-knee", trust: { member: "yeonwoo", min: 50 } },
		keywords: ["ballet", "dance", "competition", "major", "gave up", "memoriz", "learned", "choreo"],
		hint: "Yeonwoo memorizes choreography at a different pace from the other four.",
		deflect: "Only says they learned some before, and leaves it there.",
		trust: 10,
	},
	{
		id: "yeonwoo-3",
		memberId: "yeonwoo",
		note: "yeonwoo-home",
		requires: { note: "yeonwoo-stage", trust: { member: "yeonwoo", min: 72 } },
		keywords: ["home", "parent", "family", "mom", "dad", "go back", "so late", "stay", "contact"],
		hint: "Yeonwoo stays in the practice room the latest.",
		deflect: "Keeps stretching instead of answering.",
		trust: 12,
	},
	{
		id: "siha-1",
		memberId: "siha",
		note: "siha-crew",
		keywords: ["crew", "underground", "colleague", "friend", "used to", "team", "phone", "call"],
		hint: "Every break, Siha has a long phone call with someone.",
		deflect: "Says it's old news and changes the subject.",
		trust: 9,
	},
	{
		id: "siha-2",
		memberId: "siha",
		note: "siha-credit",
		requires: { note: "siha-crew", trust: { member: "siha", min: 50 } },
		keywords: ["lyric", "credit", "name", "copyright", "contract", "took", "rewrit", "fix"],
		hint: "Siha asks why every time they're told to fix something.",
		deflect: "Asks back whether asking isn't the obvious thing to do.",
		trust: 10,
	},
	{
		id: "siha-3",
		memberId: "siha",
		note: "siha-why",
		requires: { note: "siha-credit", trust: { member: "siha", min: 72 } },
		keywords: ["joined", "company", "why you came", "choice", "reason", "stage"],
		hint: "Someone from the underground scene joined a company.",
		deflect: "Jokes that it was for the money and moves on.",
		trust: 12,
	},
	{
		id: "roun-1",
		memberId: "roun",
		note: "roun-audition",
		keywords: ["audition", "fail", "how many", "trainee", "start", "before", "4 years", "four years", "how old"],
		hint: "Roun is eighteen and in their fourth year.",
		deflect: "Laughs and says they just took a lot of them.",
		trust: 9,
	},
	{
		id: "roun-2",
		memberId: "roun",
		note: "roun-sleep",
		requires: { note: "roun-audition", trust: { member: "roun", min: 50 } },
		keywords: ["sleep", "dawn", "tired", "insomnia", "night", "2 a.m.", "doze"],
		hint: "Roun is the first to smile every morning, but their eyes don't.",
		deflect: "Says first that they sleep fine.",
		trust: 10,
	},
	{
		id: "roun-3",
		memberId: "roun",
		note: "roun-parents",
		requires: { note: "roun-sleep", trust: { member: "roun", min: 72 } },
		keywords: ["home", "parent", "family", "mom", "dad", "told"],
		hint: "Roun changes the subject whenever family comes up.",
		deflect: "Only says they'll tell you later.",
		trust: 12,
	},
	{
		id: "jio-1",
		memberId: "jio",
		note: "jio-cast",
		keywords: ["cast", "business card", "street", "how did you get", "audition", "picked", "only one"],
		hint: "Of the five, only Jio never talks about auditions.",
		deflect: "Answers briefly that they got lucky.",
		trust: 9,
	},
	{
		id: "jio-2",
		memberId: "jio",
		note: "jio-mirror",
		requires: { note: "jio-cast", trust: { member: "jio", min: 50 } },
		keywords: ["mirror", "compar", "calculat", "late", "how many years", "catch up"],
		hint: "Jio stands in front of the mirror for a long time. Not with eyes that check posture.",
		deflect: "Says they're checking their posture.",
		trust: 10,
	},
	{
		id: "jio-3",
		memberId: "jio",
		note: "jio-first",
		requires: { note: "jio-mirror", trust: { member: "jio", min: 72 } },
		keywords: ["sing", "like", "fun", "keep going", "first", "enjoy", "told to"],
		hint: "Jio once said they started because they were told to.",
		deflect: "Says they're not sure, and smiles.",
		trust: 12,
	},
];

export const topicsOf = (memberId: MemberId): readonly Topic[] =>
	TOPICS.filter((topic) => topic.memberId === memberId);
`,
	},
	{
		path: "src/story/weeks.ts",
		content: `import { AGENCY } from "./agency";

/**
 * Eight weeks: one briefing per week. **A static table, not saved.**
 *
 * What is saved is \`run.week\` alone, and the screen reads this table by that number. Saving the
 * sentences would keep plays in progress seeing old briefings after the manuscript changed.
 */
export interface Week {
	week: number;
	/** The line at the head of the briefing. */
	title: string;
	/** What happens this week. */
	brief: string;
	/**
	 * What the company sent. Usually unhelpful, and **the speaker's name is not in the sentence.**
	 *
	 * For a while this value began with \`Director Kim: …\`, and once the screen started pulling that
	 * name out as a heading, the same name stood twice on one line. The speaker is the screen's axis,
	 * not part of the sentence.
	 */
	memo: string;
	/** Whether there is an evaluation at the end of this week. */
	evaluation: boolean;
}

export const WEEKS: readonly Week[] = [
	{
		week: 1,
		title: "Week one",
		brief: \`The five gathered in one room for the first time. \${AGENCY.room} is smaller than expected, and nobody quite meets anyone's eyes.\`,
		memo: \`Eight weeks. The manager decides what to do. I only look at results.\`,
		evaluation: false,
	},
	{
		week: 2,
		title: "Week two",
		brief:
			"The first verse's choreography arrived. The dance teacher left a note: five people doing the same move look like five different moves.",
		memo: \`There's a first review at the end of this week. It's a formality. Probably.\`,
		evaluation: true,
	},
	{
		week: 3,
		title: "Week three",
		brief:
			"After the first review the mood in the practice room shifted a little. The five now know who is good at what.",
		memo: \`Upstairs brought up original content. These days you have to be known before debut, apparently.\`,
		evaluation: false,
	},
	{
		week: 4,
		title: "Week four",
		brief: "Halfway through. The body starts to show it first.",
		memo: \`We're halfway. I know what happens if they go on stage like this.\`,
		evaluation: false,
	},
	{
		week: 5,
		title: "Week five",
		brief: "The song changed. About half of the formations set over three weeks became useless.",
		memo: \`Changing the song wasn't my decision. Second review at the end of this week.\`,
		evaluation: true,
	},
	{
		week: 6,
		title: "Week six",
		brief: "The comments from the second review went up on the wall. Nobody stands in front of them for long.",
		memo: \`What you do in the last three weeks is everything. Don't get greedy.\`,
		evaluation: false,
	},
	{
		week: 7,
		title: "Week seven",
		brief:
			"There was a costume fitting. It was the first time you saw the five standing side by side, and the practice room stayed lit late that night.",
		memo: \`It's next week. Push too hard this week and they won't stand next week.\`,
		evaluation: false,
	},
	{
		week: 8,
		title: "Final week",
		brief: "The evaluation is Friday. Not much can change this week.",
		memo: \`Friday, 2 p.m., the big practice room on 3F. Three directors are coming in.\`,
		evaluation: true,
	},
];

export const weekOf = (week: number): Week =>
	WEEKS[week - 1] ?? WEEKS[WEEKS.length - 1];

export const isFinalWeek = (week: number): boolean => week >= AGENCY.weeks;
`,
	},
];
