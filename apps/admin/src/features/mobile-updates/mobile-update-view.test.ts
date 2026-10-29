import type { Viewer } from "@rowcat/domain";
import { describe, expect, test } from "vitest";
import {
	initialRolloutChoices,
	type PublishDraft,
	publishRequestOf,
	releaseActions,
} from "./mobile-update-view.ts";

const viewer = (role: Viewer["role"]) =>
	({ id: "m", role, status: "approved" }) as Viewer;

const draft = (overrides: Partial<PublishDraft> = {}): PublishDraft => ({
	channel: "production",
	platform: "ios",
	sourceKind: "branch",
	branch: "main",
	commit: "",
	rollout: "draft",
	note: "2026-10-03",
	reason: "weekly fix",
	...overrides,
});

describe("operations drawn on a release", () => {
	test("for admins an active release gets a larger percentage, pause and roll back", () => {
		expect(
			releaseActions(
				{ status: "active", rolloutPercentage: 25, kind: "update" },
				viewer("admin"),
			),
		).toEqual({
			rolloutSteps: [50, 100],
			pause: true,
			resume: false,
			rollback: true,
		});
	});

	test("staff get no operations: read only", () => {
		expect(
			releaseActions(
				{ status: "active", rolloutPercentage: 25, kind: "update" },
				viewer("staff"),
			),
		).toEqual({
			rolloutSteps: [],
			pause: false,
			resume: false,
			rollback: false,
		});
	});

	test("a paused release gets only resume, with no percentage cell", () => {
		expect(
			releaseActions(
				{ status: "paused", rolloutPercentage: 25, kind: "update" },
				viewer("admin"),
			),
		).toMatchObject({ rolloutSteps: [], pause: false, resume: true });
	});

	test("a rolled back release has nothing to roll back", () => {
		expect(
			releaseActions(
				{ status: "rolled_back", rolloutPercentage: 100, kind: "update" },
				viewer("admin"),
			).rollback,
		).toBe(false);
	});
});

describe("the new publish form", () => {
	test("production has only draft", () => {
		expect(initialRolloutChoices("production").map((c) => c.value)).toEqual([
			"draft",
		]);
		expect(publishRequestOf(draft({ rollout: "10" })).request).toBeNull();
	});

	test("the request carries only closed values", () => {
		expect(publishRequestOf(draft()).request).toEqual({
			channel: "production",
			platform: "ios",
			source: { kind: "branch", branch: "main" },
			initialRollout: null,
			note: { kind: "note", id: "2026-10-03" },
			reason: "weekly fix",
		});
	});

	test("the commit is 40 characters and uppercase folds", () => {
		expect(
			publishRequestOf(draft({ sourceKind: "commit", commit: "abc123" })).issues
				.commit,
		).toBeTruthy();
		expect(
			publishRequestOf(draft({ sourceKind: "commit", commit: "A".repeat(40) }))
				.request?.source,
		).toEqual({ kind: "commit", sha: "a".repeat(40) });
	});

	test("the note and reason can't be empty", () => {
		const { issues } = publishRequestOf(draft({ note: "", reason: " " }));
		expect(issues.note).toBeTruthy();
		expect(issues.reason).toBeTruthy();
	});
});
