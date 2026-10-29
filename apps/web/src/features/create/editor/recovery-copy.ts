import type {
	RecoverableDraftFieldGroup,
	StoryDraftPatch,
} from "@rowcat/authoring";
import {
	ORIENTATIONS,
	type Orientation,
	STORY_VISIBILITIES,
	type StoryVisibility,
} from "@rowcat/domain";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import { orientationLabel, visibilityLabel } from "#/lib/i18n/vocab.ts";

/**
 * The words of the draft conflict notice, in the render's locale.
 *
 * The rules (which copy exists, which fields differ, what restoring does) stay in
 * `@rowcat/authoring`'s `recovery.ts`, and both apps call them. That module also carries the same
 * vocabulary as constants (`DRAFT_RECOVERY_COPY`) for mobile; this file is the web's naming of the
 * same keys, so the two apps keep one meaning per word.
 */

export const draftRecoveryCopy = () => {
	const t = translator("create");
	return {
		notice: t("recovery.notice"),
		open: t("recovery.open"),
		title: t("recovery.title"),
		description: t("recovery.description"),
		empty: t("recovery.empty"),
		orphaned: t("recovery.orphaned"),
		restore: t("recovery.restore"),
		discard: t("recovery.discard"),
		cancel: t("recovery.cancel"),
		discardConfirm: t("recovery.discardConfirm"),
		restoreFailed: t("recovery.restoreFailed"),
		discardFailed: t("recovery.discardFailed"),
		restoreMissing: t("recovery.restoreMissing"),
		preservedColumn: t("recovery.preservedColumn"),
		currentColumn: t("recovery.currentColumn"),
		emptyValue: t("recovery.emptyValue"),
		summaryLabel: t("recovery.summaryLabel"),
	} as const;
};

export const draftRecoveryGroupLabel = (
	group: RecoverableDraftFieldGroup,
): string => translator("create")(`recovery.group.${group}`);

export const draftRecoveryFieldLabel = (field: keyof StoryDraftPatch): string =>
	translator("create")(`recovery.field.${field}`);

/** Says what gets overwritten, not how: no revision or clock vocabulary reaches this sentence. */
export const draftRecoveryRestoreConfirm = (
	group: RecoverableDraftFieldGroup,
): string =>
	translator("create")("recovery.restoreConfirm", {
		group: draftRecoveryGroupLabel(group),
	});

/** The same folding as `draftRecoveryValueText` in `@rowcat/authoring`, with words in this locale. */
export function draftRecoveryValueText(
	field: keyof StoryDraftPatch,
	value: unknown,
): string {
	const t = translator("create");
	if (value === undefined || value === null || value === "") {
		if (field === "orientation") return t("recovery.orientationUnset");
		if (field === "defaultStartSceneId") return t("recovery.defaultSceneUnset");
		return t("recovery.emptyValue");
	}
	if (field === "tags")
		return Array.isArray(value) && value.length > 0
			? value.join(", ")
			: t("recovery.emptyValue");
	if (field === "orientation")
		return isOrientation(value)
			? orientationLabel(value)
			: t("recovery.orientationUnset");
	if (field === "visibility")
		return isVisibility(value) ? visibilityLabel(value) : String(value);
	if (typeof value === "boolean")
		return value ? t("recovery.on") : t("recovery.off");
	return String(value);
}

/**
 * The kept-at time, as date and time. Relative phrasing gets vaguer as a copy ages, and copies can
 * stay for weeks. An unreadable value is shown as it was stored.
 */
export const draftRecoveryObservedText = (observedAt: string): string =>
	formatDateTime(observedAt) || observedAt;

const isOrientation = (value: unknown): value is Orientation =>
	(ORIENTATIONS as readonly unknown[]).includes(value);

const isVisibility = (value: unknown): value is StoryVisibility =>
	(STORY_VISIBILITIES as readonly unknown[]).includes(value);
