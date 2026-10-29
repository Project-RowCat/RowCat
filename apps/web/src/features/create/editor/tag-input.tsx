import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { X } from "lucide-react";
import * as m from "motion/react-m";
import { type KeyboardEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { layoutTransition } from "#/lib/motion/transitions.ts";
import { useEditedValue } from "./edited-value.ts";

/**
 * File-level notes:
 * - Stored as a string array, not the legacy comma-separated text, so the UI works on the array
 *   too. Splitting one comma line on save cannot represent a tag that contains a comma.
 * - Normalization (trim, de-duplicate) runs on input as well as in the publish assembler. What is
 *   shown then equals what is saved; otherwise a tag would appear to vanish after publish.
 * - Chips render from the screen value (`edited-value.ts`), not the record. Reading the record
 *   would hide a just-added tag until autosave returns, and a second tag entered in that window
 *   would erase the first, because the new array is built on the old one. This is the same defect
 *   as the paired inputs that erased each other (`draft-editor-page.tsx`).
 * - Chips only move; they never appear or disappear. `layout` covers the reflow after a removal.
 *   Identity is the tag string itself, which is unique because the same tag cannot be entered
 *   twice.
 * - No presence animation. The delete button sits inside the leaving chip, and `popLayout` would
 *   lift it out of flow while it has focus. No entrance animation either, or every existing tag
 *   would animate each time a draft opens.
 */
/**
 * Compares order too. Order is part of the storage model, since the publish assembler writes the
 * array as it is. A set comparison would miss a remote change that only reorders tags.
 */
const sameTags = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((tag, index) => tag === b[index]);

export function TagInput({
	value,
	onChange,
}: {
	value: string[];
	onChange: (tags: string[]) => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	const id = useId();
	const [draft, setDraft] = useState("");
	const [tags, edit] = useEditedValue(value, onChange, sameTags);
	const full = tags.length >= STORY_PUBLISH_LIMITS.tags;

	const add = () => {
		const tag = draft.trim();
		setDraft("");
		if (!tag || full || tags.includes(tag)) return;
		edit([...tags, tag.slice(0, STORY_PUBLISH_LIMITS.tag)]);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			// Keeps form submission from leaking out. This editor has no submit button; it autosaves.
			event.preventDefault();
			add();
			return;
		}
		/**
		 * In an empty input, Backspace removes the last tag. Each chip has an × button, but the fastest
		 * way to remove a tag that was just mistyped should be on the keyboard, so typing flow is not
		 * broken.
		 */
		if (event.key === "Backspace" && draft === "" && tags.length > 0)
			edit(tags.slice(0, -1));
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<Label htmlFor={id}>{t("tagInput.tags")}</Label>
				<span className="text-xs text-muted-foreground">
					{/*
					 * The count stays mounted and only its value changes as tags are added or removed. It uses the
					 * default intensity because the number changes per tag, not per keystroke. This is where it
					 * differs from the character-count fields beside it.
					 */}
					<AnimatedCount value={String(tags.length)} /> /{" "}
					{STORY_PUBLISH_LIMITS.tags}
				</span>
			</div>
			{tags.length > 0 && (
				<ul className="flex flex-wrap gap-1.5">
					{tags.map((tag) => (
						<m.li
							key={tag}
							layout="position"
							/*
							 * The input re-renders on every keystroke. Without a layout dependency, Motion would
							 * re-measure every chip each time, although no chip moves while a tag is being typed. The
							 * section component takes `layoutDependency` for the same reason (`fields.tsx`).
							 */
							layoutDependency={tags}
							transition={{ layout: layoutTransition }}
						>
							<Badge variant="secondary" className="gap-1 pr-1">
								{tag}
								{/*
								 * The icon is small, but the press target is not. When the icon size was the button size, the
								 * button was 12×12px, practically impossible to hit with a finger (the WCAG 2.2 minimum is
								 * 24×24px). Rather than enlarging the chip, the button is `size-6` with negative margins: the
								 * visible chip is unchanged and only the hit area grows.
								 */}
								<button
									type="button"
									aria-label={t("tagInput.remove", { tag })}
									className="-my-1 -mr-1 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
									onClick={() => edit(tags.filter((t) => t !== tag))}
								>
									<X className="size-3" aria-hidden="true" />
								</button>
							</Badge>
						</m.li>
					))}
				</ul>
			)}
			<Input
				id={id}
				value={draft}
				disabled={full}
				placeholder={
					full ? t("tagInput.noMoreTagsCanBe") : t("tagInput.typeAndPressEnter")
				}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={onKeyDown}
				// Also add on blur. Forgetting Enter after typing is the most common mistake.
				onBlur={add}
			/>
		</div>
	);
}
