import {
	CAPABILITY_LABEL,
	MY_REPORT_STATE_LABEL,
	REPORT_REASON_LABEL,
	REPORT_TARGET_LABEL,
} from "@rowcat/contracts";
import {
	appliedGalleryFilters,
	commentRepliesLabel,
	DEFAULT_GALLERY_FILTERS,
	DELETED_COMMENT_PLACEHOLDER,
	DELETED_CREATOR_LABEL,
	sortTriggerLabel as domainSortTriggerLabel,
	updateNoteTitle as domainUpdateNoteTitle,
	GALLERY_FILTER_AXIS_LABEL,
	notificationAttention,
	ORIENTATION_LABEL,
	STORY_PERIOD_LABEL,
	STORY_RATING_LABEL,
	STORY_SORT_LABEL,
	STORY_START_LABEL,
	STORY_VISIBILITY_LABEL,
	UPDATE_NOTE_SECTION_LABEL,
	UPDATE_NOTE_SECTION_ORDER,
	UPDATE_UNSEEN_LABEL_SUFFIX,
} from "@rowcat/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
	notificationBellName,
	unseenUpdateSuffix,
} from "../../features/notifications/notification-copy.ts";
import {
	updateNoteSectionLabel,
	updateNoteTitle,
	updateUnseenSuffix,
} from "../../features/updates/update-note-copy.ts";
import { setActiveLocale } from "./instance.ts";
import { en } from "./messages/en/index.ts";
import {
	localizedAppliedFilters,
	repliesLabel,
	sortTriggerLabel,
	visibilityBadgeLabel,
} from "./vocab.ts";

/**
 * The domain's label tables are the English source for the product vocabulary, and the screens used
 * to draw them directly. Moving the words into the dictionary must not change one English letter —
 * the web's `vocab` holds the same English — so the two are compared by value here. Diverge, and the
 * same code reads as two different words in the two apps.
 */
describe("English vocab is the domain's own words", () => {
	it.each([
		["orientation", ORIENTATION_LABEL],
		["rating", STORY_RATING_LABEL],
		["sort", STORY_SORT_LABEL],
		["period", STORY_PERIOD_LABEL],
		["filterAxis", GALLERY_FILTER_AXIS_LABEL],
		["visibility", STORY_VISIBILITY_LABEL],
		["start", STORY_START_LABEL],
	] as const)("%s", (group, table) => {
		expect(en.vocab[group]).toEqual({ ...table });
	});

	it("the two state words", () => {
		expect(en.vocab.deletedCreator).toBe(DELETED_CREATOR_LABEL);
		expect(en.vocab.deletedComment).toBe(DELETED_COMMENT_PLACEHOLDER);
	});
});

/** The same rule for the moderation contract's codes: the English names are the contract's own. */
describe("English moderation names are the contract's own words", () => {
	it("reasons, targets and report states", () => {
		expect(en.moderation.reason).toEqual({ ...REPORT_REASON_LABEL });
		expect(en.moderation.target).toEqual({ ...REPORT_TARGET_LABEL });
		expect(en.moderation.reportState).toEqual({ ...MY_REPORT_STATE_LABEL });
	});

	it("capabilities, whose dotted codes are nested keys", () => {
		for (const [code, label] of Object.entries(CAPABILITY_LABEL)) {
			const [group, name] = code.split(".") as [string, string];
			const nested = en.moderation.capability as Record<
				string,
				Record<string, string>
			>;
			expect(nested[group]?.[name], code).toBe(label);
		}
	});
});

describe("the named decisions match the domain's in English", () => {
	afterEach(() => setActiveLocale("en"));

	it("applied filter tokens", () => {
		const filters = {
			...DEFAULT_GALLERY_FILTERS,
			orientation: "female" as const,
			rating: "adult" as const,
			tag: "밤",
			followingOnly: true,
		};
		const strip = (list: ReturnType<typeof appliedGalleryFilters>) =>
			list.map(({ axis, text, removeLabel, patch }) => ({
				axis,
				text,
				removeLabel,
				patch,
			}));
		expect(strip(localizedAppliedFilters(filters, true))).toEqual(
			strip(appliedGalleryFilters(filters, true)),
		);
	});

	it("sort trigger", () => {
		for (const sort of ["recent", "popular", "relevance"] as const)
			for (const period of ["all", "day", "week", "month"] as const)
				for (const query of ["", "밤"]) {
					const filters = { sort, period, query };
					expect(sortTriggerLabel(filters)).toBe(
						domainSortTriggerLabel(filters),
					);
				}
	});

	it("replies button, including its absence at 0", () => {
		for (const count of [0, 1, 2, 31])
			expect(repliesLabel(count)).toBe(commentRepliesLabel(count));
	});

	it("public gets no badge in any language", () => {
		setActiveLocale("ko");
		expect(visibilityBadgeLabel("public")).toBeNull();
		expect(visibilityBadgeLabel("unlisted")).toBe("링크 공개");
	});
});

/**
 * The inbox and the update history draw the domain's notification and release-note words in the
 * chosen language. The domain still decides the badge, its cap and the section order; these hold the
 * English words to the domain's own values.
 */
describe("notification and update-note words are the domain's own", () => {
	afterEach(() => setActiveLocale("en"));

	it("the bell's name, every badge and the unseen suffix", () => {
		for (const unread of [null, 0, 1, 42, 99, 100, 1247])
			for (const unseenUpdate of [false, true])
				expect(
					notificationBellName(
						notificationAttention({ unread, unseenUpdate }),
						unseenUpdate,
					),
				).toBe(notificationAttention({ unread, unseenUpdate }).label);
	});

	it("the tab and the history row say the same suffix", () => {
		expect(unseenUpdateSuffix()).toBe(UPDATE_UNSEEN_LABEL_SUFFIX);
		expect(updateUnseenSuffix()).toBe(UPDATE_UNSEEN_LABEL_SUFFIX);
	});

	it("section labels", () => {
		for (const id of UPDATE_NOTE_SECTION_ORDER)
			expect(updateNoteSectionLabel(id)).toBe(UPDATE_NOTE_SECTION_LABEL[id]);
	});

	it("the title is the domain's, from the same date", () => {
		expect(updateNoteTitle({ id: "2026-08-30" })).toBe(
			domainUpdateNoteTitle("2026-08-30"),
		);
		setActiveLocale("ko");
		expect(updateNoteTitle({ id: "2026-08-30" })).toBe(
			"2026.08.30 업데이트 안내",
		);
	});
});
