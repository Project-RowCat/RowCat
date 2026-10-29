import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of public reports, which types cannot catch.
 *
 * Every rule here is one that compiles when broken and shows no symptom. Evidence of a public
 * target is the sharpest case: if a work title is attached to the report request, the server
 * snapshots its own row, so nothing happens on screen, and the copy only becomes a problem when
 * someone actually starts using it.
 *
 * The rules themselves are checked elsewhere: ordering and locking in `report-turn.test.ts`,
 * visibility in `report-visibility.test.ts`, and the container in
 * `lib/presentation-policy.test.ts`. This file checks that they are actually called, and that what
 * must not be called is not.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * **Scanned after comments are stripped.** This repository's comments explain boundaries by quoting
 * the forbidden words ("the snapshot is taken by the server"). Scanning raw text would flag those
 * explanatory sentences as violations, and everyone would then edit the comments away to pass.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	/** The scanner holds the forbidden words as patterns itself. Scanning itself would always fail. */
	.filter((file) => !file.path.endsWith("moderation-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

const moderation = product.filter((file) =>
	file.path.startsWith("features/moderation/"),
);

/**
 * The files of **public reports**. Most of this file's narrow rules apply only to this list.
 *
 * Personal moderation (account restriction, my reports, appeals) shares the same folder, so the
 * rules that once scanned the whole folder were narrowed to here. That side handles its own cache
 * cells precisely (`MY_MODERATION_QUERY_KEY` invalidation, restarting `My reports`), and it actually
 * draws the product label of a sanction (`Account suspended`). Its wiring is locked separately by
 * `personal-moderation-boundaries.test.ts`.
 */
const reportFiles = moderation.filter((file) =>
	/features\/moderation\/report-/.test(file.path),
);

describe("the report folder actually exists", () => {
	/**
	 * Keeps the checks below from passing silently over an empty list. When a file moves, that should
	 * show up here first.
	 */
	it("the shared report files are in place", () => {
		for (const path of [
			"features/moderation/report-dialog.tsx",
			"features/moderation/report-menu.tsx",
			"features/moderation/report-error.ts",
			"features/moderation/report-turn.ts",
			"features/moderation/report-visibility.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
		expect(moderation.length).toBeGreaterThan(4);
	});
});

describe("generic report rules don't remain in the conversation folder", () => {
	/**
	 * **This check guards the spot in this file that is easiest to revert.**
	 *
	 * The shared parts of reporting (the reason list, duplicate-submission guard, failure copy, the `My
	 * reports` invalidation) once lived in `features/chat`. That was right while the only consumer was an
	 * AI reply. A change that moves them back looks ordinary in review: one line that recreates
	 * `reportErrorMessage` inside the chat folder. Then the same server code shows different text
	 * depending on the screen.
	 */
	it("the conversation folder has no report error table", () => {
		for (const file of product) {
			if (!file.path.startsWith("features/chat/")) continue;
			expect(file.text, file.path).not.toContain("REPORT_ERROR_CODE");
			expect(file.text, file.path).not.toMatch(/function\s+reportErrorMessage/);
		}
	});

	/**
	 * Submission does not pass through the chat folder either. There is one call site for
	 * `moderation.report`, and that one site owns the ordering and the locking (`report-turn.ts`).
	 */
	it("one place calls filing", () => {
		const callers = product.filter((file) =>
			/moderation\.report\s*\(/.test(file.text),
		);
		expect(callers.map((file) => file.path)).toEqual([
			"features/moderation/report-dialog.tsx",
		]);
	});

	/**
	 * **AI evidence still belongs to chat.** If the report window started to know `@rowcat/chat`,
	 * public reports would become bound to the chat contract, and the day that package changes, work
	 * reports would break with it.
	 */
	it("the report folder doesn't take the chat package", () => {
		for (const file of moderation) {
			expect(file.text, file.path).not.toContain("@rowcat/chat");
			expect(file.text, file.path).not.toContain("buildAiResponseEvidence");
			expect(file.text, file.path).not.toContain("AI_EVIDENCE_DISCLOSURE");
		}
	});

	/** The disclosure and the label belong to the chat folder: that sentence attaches only to this report. */
	it("the AI notice is in the conversation folder", () => {
		const evidence = fileAt("features/chat/messages/ai-evidence.ts");
		expect(evidence).toContain("AI_EVIDENCE_DISCLOSURE");
		expect(evidence).toContain("EVIDENCE_LABEL");
		expect(fileAt("features/chat/messages/report-modal.tsx")).toContain(
			"AI_EVIDENCE_DISCLOSURE",
		);
	});
});

describe("public targets carry only ids", () => {
	/**
	 * The server takes the snapshot from its own row. If a reporter could fabricate evidence, that
	 * evidence would not be evidence, and that fact is pinned in the shape of the contract
	 * (`ReportTarget`). What is locked here is that this vocabulary does not come into this app as a
	 * copy.
	 */
	it("no evidence snapshot vocabulary in this app", () => {
		for (const file of product)
			for (const absent of [
				"StoryReportEvidence",
				"CommentReportEvidence",
				"MemberReportEvidence",
				"ReportEvidence",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});

	/**
	 * **There is one place that passes evidence.** The types already block it (for public targets
	 * `evidence` is `never`), but reverting that discriminated union to one optional field would not
	 * touch a single file in this app. This test is the net that breaks first.
	 */
	it("only the AI report passes evidence", () => {
		const callers = product.filter((file) => /\bevidence=\{/.test(file.text));
		expect(callers.map((file) => file.path)).toEqual([
			"features/chat/messages/report-modal.tsx",
		]);
	});

	/**
	 * And the place that **creates a target of that kind** is also one place. The window itself uses
	 * that word in type position (one side of the discriminated union). Blocking that as well would
	 * push people toward removing the boundary, so what is checked is where the **value** is
	 * assembled.
	 */
	it("one place builds ai_response targets", () => {
		const builders = product.filter((file) =>
			/target(?:=\{\{|:\s*\{)\s*type:\s*"ai_response"/.test(file.text),
		);
		expect(builders.map((file) => file.path)).toEqual([
			"features/chat/messages/report-modal.tsx",
		]);
	});

	/**
	 * The window's props **stay a discriminated union.** Reverting to one optional `evidence` would
	 * let code that attaches chat fragments to a public target compile, and that change touches no
	 * other file in this app, so nothing but this test would show it.
	 */
	it("evidence is never on public targets", () => {
		const dialog = fileAt("features/moderation/report-dialog.tsx");
		expect(dialog).toContain("PublicReportTarget");
		expect(dialog).toMatch(
			/\{\s*target:\s*PublicReportTarget;\s*evidence\?:\s*never\s*\}/,
		);
		expect(dialog).toMatch(/evidence:\s*ReactNode/);
	});

	/**
	 * Locks the **shape** of the three targets by value. The comment target in particular must carry
	 * the work id as well: the server verifies ownership by the `(storyId, commentId)` pair, so a
	 * request sending only `commentId` falls outside the contract.
	 */
	it("the three targets keep the contract's shape", () => {
		expect(fileAt("features/story/story-detail-screen.tsx")).toContain(
			'target={{ type: "story", storyId: value.id }}',
		);

		const comment = fileAt("features/story/comments/comment-row.tsx");
		expect(comment).toMatch(
			/type:\s*"comment",\s*storyId:\s*comment\.storyId,\s*commentId:\s*comment\.id,/,
		);

		expect(fileAt("features/profile/use-profile-menu.tsx")).toContain(
			'target: { type: "member", memberId: creatorId }',
		);
	});

	/**
	 * Blocks attempts to carry content next to the target. The contract is a discriminated union
	 * rather than `.strict()`, so unknown keys fall out of the type. Code that passes them through
	 * `as` still compiles.
	 */
	it("target literals have no content fields", () => {
		for (const file of moderation)
			for (const absent of [
				"story.title",
				"comment.body",
				"profile.bio",
				"displayName",
				"avatarUrl",
				"nickname",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("a report isn't enforcement", () => {
	/**
	 * Filing changes no public state. Making the gallery, detail, comments, profile or personalization
	 * stale would make the refetch look like "something was processed". Optimistically removing them
	 * would make content vanish when nothing happened.
	 */
	it("public report files don't touch the cache directly", () => {
		/**
		 * The narrowed scope is intentional. Personal moderation handles its own cache cells precisely
		 * (invalidating `MY_MODERATION_QUERY_KEY` after an appeal, restarting a stalled `My reports` query).
		 * That wiring's exact scope is locked by `personal-moderation-boundaries.test.ts`. Public reports
		 * still touch none of these.
		 */
		for (const file of reportFiles)
			for (const forbidden of [
				"setQueryData",
				"setQueriesData",
				"removeQueries",
				"resetQueries",
				"invalidateQueries",
				"GALLERY_QUERY_KEY",
				"STORY_DETAIL_QUERY_KEY",
				"queryKey:",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/** Only one cell is marked stale, and its scope belongs to `@rowcat/query`. */
	it("the only cell invalidated is `My reports`", () => {
		const dialog = fileAt("features/moderation/report-dialog.tsx");
		expect(dialog).toContain("invalidateMyReports");
		expect(dialog).toContain('from "@rowcat/query"');
	});

	/**
	 * **Do not invent rows of the report history from the filing response.** `ReportCreateResponse`
	 * carries only the report id and time, so it has no target, no state and no reason label. A row
	 * built from that would be a lie until the server answers.
	 */
	it("doesn't invent report history rows", () => {
		/**
		 * The list's vocabulary (`MyReportDto`, `MY_REPORTS_QUERY_KEY`) now belongs to the `My reports`
		 * section. It is still absent from the filing path. The moment the report window acquires that
		 * vocabulary is the moment optimistic row insertion starts.
		 */
		for (const file of reportFiles) {
			expect(file.text, file.path).not.toContain("MyReportDto");
			expect(file.text, file.path).not.toContain("MY_REPORTS_QUERY_KEY");
		}
	});

	/**
	 * **Reporting does not combine with other operations.** If filing also blocked, unfollowed,
	 * deleted or moved something, the user would have no way to undo the rest when they wanted only
	 * one. Blocking in particular severs a follow, and unblocking does not revive it.
	 */
	it("filing doesn't double as relation, deletion or navigation", () => {
		for (const file of moderation)
			for (const forbidden of [
				"blockMutationOptions",
				"followMutationOptions",
				"deleteCommentMutationOptions",
				"favoriteMutationOptions",
				"useRouter",
				"router.push",
				"router.replace",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * The reporter does not choose the punishment. This is not expressible because the contract has no
	 * such field, but once the screen starts holding the word as vocabulary, the next person looks for
	 * a place to attach it.
	 */
	it("no punishment vocabulary on report screens", () => {
		/**
		 * The narrowed scope is intentional. The `Restrictions` section draws the product label of a sanction
		 * that was already enforced (`Account suspended`, `Story hidden`), so this vocabulary legitimately appears there.
		 * The surface where a reporter chooses a punishment still does not exist.
		 */
		for (const file of reportFiles)
			for (const absent of ["hide", "suspend", "deletion request", "sanction"])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("operator tools aren't in this app", () => {
	/**
	 * The queue, enforcement and appeal handling belong to the operations console (`apps/admin`). The
	 * SDK has those methods, so code that calls them compiles, and the server blocks them with a 403
	 * only **after** the call. By then the screen already has an operator-only query.
	 */
	it("doesn't call operator-only lookups or operations", () => {
		for (const file of product)
			for (const absent of [
				"moderationQueue",
				"reportDetail",
				"resolveReport",
				"executeAction",
				"reverseAction",
				"moderationAppeals",
				"resolveAppeal",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});

	/**
	 * Personal moderation (my reports, account restriction, appeals) now belongs to this folder. What
	 * this locks is that **no operation can appear on a report that has left the reporter's hands.**
	 * Withdrawal, edit, reopen and messages to the operator do not exist in this product, not even as
	 * disabled placeholders.
	 */
	it("no vocabulary for undoing a filed report", () => {
		for (const file of moderation)
			for (const absent of [
				"withdraw report",
				"withdraw",
				"edit report",
				"reopen",
				"contact an operator",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("reports aren't local-first data", () => {
	/**
	 * Filing is server state. If it were stored on the device, after an account switch the previous
	 * person's report would stay in the next person's form. Above all, its contents include the
	 * description the user wrote.
	 */
	it("the report folder doesn't know device storage", () => {
		for (const file of moderation)
			for (const forbidden of [
				"local-data",
				"local-sync",
				"expo-sqlite",
				"SecureStore",
				"AsyncStorage",
				"@rowcat/sync",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});
});

describe("doesn't rewrite the reason list or limits", () => {
	/**
	 * The contract is the authority over the vocabulary and its **order**. If the screen wrote the
	 * array by hand, the day a reason is added only this app would lack it. Reordering would make the
	 * two apps draw different lists.
	 */
	it("reads reasons from the contract", () => {
		const dialog = fileAt("features/moderation/report-dialog.tsx");
		expect(dialog).toContain(
			"Object.keys(REPORT_REASON_LABEL) as ReportReason[]",
		);
		expect(dialog).toContain("REPORT_LIMITS.details");
		/** The reason strings are not typed by hand. */
		for (const literal of ["Sexual content", "Child safety", "Something else"])
			expect(dialog, literal).not.toContain(literal);
	});

	/**
	 * Do not invent processing deadlines. Promises such as `Within 7 days` are not in this product (there is
	 * no voluntary SLA), and if the screen made them up, they become promises we cannot keep.
	 */
	it("doesn't promise a handling deadline", () => {
		for (const file of moderation)
			for (const absent of [
				"business days",
				"within",
				"expected completion",
				"24 hours",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("report bodies don't remain in logs", () => {
	/**
	 * The request body on this path holds the description the user wrote and, for AI reports, the
	 * conversation plaintext. The rule covering every product path is already in
	 * `lib/boundaries.test.ts`. It is repeated here because this folder is where that rule is most
	 * expensive to break.
	 */
	it("no console calls in the report path", () => {
		for (const file of moderation)
			expect(file.text, file.path).not.toMatch(/\bconsole\.\w+\(/);
		expect(fileAt("features/chat/messages/report-modal.tsx")).not.toMatch(
			/\bconsole\.\w+\(/,
		);
	});
});

describe("the visibility decision is actually wired on screen", () => {
	/**
	 * The rule itself is run by value in `report-visibility.test.ts`. What is checked here is whether
	 * the screen **passes the right values to that function**. A correct pure judgment does not reach
	 * the screen if the owner is passed as a nickname, or if `true` is passed in place of the viewer.
	 */
	it("story reports pass the viewer and the owner", () => {
		const screen = fileAt("features/story/story-detail-screen.tsx");
		expect(screen).toContain("viewerId={viewerId}");
		/** The owner is the **member id**. The author credit (`author`) is free text and is not tied to any account. */
		expect(screen).toContain("ownerId={value.creator?.id ?? null}");
		expect(screen).not.toMatch(/ownerId=\{[^}]*author/);
		expect(screen).not.toMatch(/ownerId=\{[^}]*nickname/);
	});

	/**
	 * **The third slot of a comment row is not expressible by `own` alone.** For a guest `own` is
	 * false, so if the viewer is not passed, a report item appears for that person. They only learn
	 * after filling in the whole form that login is required.
	 *
	 * ## The wiring went one layer deeper
	 *
	 * With replies, a thread came between the screen and the row, so **the place that computes `own`
	 * moved from the screen into the thread.** The invariant does not change: ownership is answered by
	 * `isOwnComment` (member id comparison), and the viewer id goes down to the row.
	 *
	 * The test checks that the thread passes both to reply rows as well. Forgetting them in replies,
	 * and not only at the top level, is the easiest mistake in this structure. It shows up as report
	 * items standing for guests only on replies.
	 */
	it("comment rows receive ownership and the viewer together", () => {
		const screen = fileAt("features/story/story-detail-screen.tsx");
		/** The screen passes the viewer to the thread. Ownership is computed below it. */
		expect(screen).toMatch(/<CommentThread[\s\S]{0,600}viewerId=\{viewerId\}/);

		const thread = fileAt("features/story/comments/comment-thread.tsx");
		/** Both top-level rows and reply rows go through the same judgment. */
		expect(thread).toContain("own={isOwnComment(comment, viewerId)}");
		expect(thread).toContain("own={isOwnComment(reply, viewerId)}");
		expect([...thread.matchAll(/viewerId=\{viewerId\}/g)]).toHaveLength(2);

		const row = fileAt("features/story/comments/comment-row.tsx");
		expect(row).toContain("commentRowAction({ own, viewerId })");
		/** Do not re-write the table inside the row. Re-writing it would make the third slot silently disappear. */
		expect(row).not.toMatch(/own \?[\s\S]{0,60}Report/);
		expect(row).not.toMatch(/author\.id ===/);
	});

	/**
	 * **Replies can be reported too, without adding a target kind.**
	 *
	 * A reply is a comment with a `parent_id`, so the report target is still the single kind
	 * `comment`. A separate kind would make the moderation queue, actions, evidence and audit two
	 * copies each, and if one of them loosened, nothing would show.
	 *
	 * Only one human-read label differs, and that value is not carried on the target.
	 */
	it("a reply's report target is `comment` too", () => {
		const row = fileAt("features/story/comments/comment-row.tsx");
		expect(row).toMatch(/type: "comment"[\s\S]{0,200}commentId: comment\.id/);
		expect(row).toContain('comment.parentId ? "Reply" : "Comment"');
		/** Do not create a target kind just for replies. */
		expect(row).not.toContain('type: "reply"');
		expect(row).not.toContain('type: "comment_reply"');
	});

	/**
	 * **A tombstone carries no actions.** `commentRowAction` gives a member `report` whenever `own` is
	 * false. Unless it is stopped in front of that, a deleted utterance gets a report item: the person
	 * fills in the form and receives a 404, because the server answers that row as absent (no body and
	 * no author remain).
	 */
	it("deleted rows get no overflow menu", () => {
		const row = fileAt("features/story/comments/comment-row.tsx");
		expect(row).toContain(
			"const action = deleted ? null : commentRowAction({ own, viewerId })",
		);
	});

	/** Deletion remains. Adding reporting did not remove the existing action. */
	it("deleting your own comment stays as is", () => {
		const row = fileAt("features/story/comments/comment-row.tsx");
		expect(row).toMatch(/label="Delete"[\s\S]{0,200}setConfirming\(true\)/);
		expect(row).toContain("onConfirm={() => {");
		expect(row).toContain("onDelete();");
		/** Do not delete without confirmation. */
		expect(row).not.toMatch(/onSelect=\{\(\) => onDelete\(\)\}/);
	});
});

describe("what the AI report shows and what it sends don't diverge", () => {
	/**
	 * The preview and the transmission target come from the **same `selection`**. If the preview were
	 * built separately, "what was shown" and "what was sent" could diverge, and that gap appears only
	 * as the user uploading content they did not agree to.
	 *
	 * The previous-message toggle is exactly that axis. Its value goes back through
	 * `buildAiResponseEvidence` and shrinks **both the evidence and the preview together**
	 * (`packages/chat` holds that rule). What is locked here is that this screen does not build the
	 * two separately.
	 */
	it("evidence and preview come from the same value", () => {
		const modal = fileAt("features/chat/messages/report-modal.tsx");
		expect(modal).toContain("evidence: selection.evidence");
		expect(modal).toContain("selection.preview.map");
		/** This file does not assemble the evidence itself. Choosing is the job of `@rowcat/chat`. */
		expect(modal).not.toContain("buildAiResponseEvidence");
		expect(modal).not.toContain("messages");
	});

	/** The disclosure and the toggle stay. They are the substance of this window. */
	it("the notice and the previous-message toggle remain", () => {
		const modal = fileAt("features/chat/messages/report-modal.tsx");
		expect(modal).toContain("{AI_EVIDENCE_DISCLOSURE}");
		expect(modal).toContain("onIncludePrecedingChange(!includePreceding)");
		expect(modal).toContain("What is sent");
	});

	/**
	 * **Do not fold the three.** A preview that has to be expanded to be seen is never expanded by
	 * anyone, and then the disclosure becomes a formality.
	 */
	it("doesn't fold the preview", () => {
		const modal = fileAt("features/chat/messages/report-modal.tsx");
		for (const fold of ["Accordion", "Collapsible", "Expand", "Show more"])
			expect(modal, fold).not.toContain(fold);
	});
});

describe("the report dialog's lifetime is tied to its operation's visibility", () => {
	/**
	 * **An open report window must not cross account boundaries.**
	 *
	 * This window is a form that creates server state, and the identity it sends is the current
	 * session's. If the window were mounted unconditionally, a form Alice left open could be filed
	 * under Bob's session. That filing **cannot be undone**, because withdrawal does not exist in this
	 * product.
	 *
	 * Do not build this guarantee with a new effect or key. Put the window **under the same condition
	 * as the item**. When the viewer changes, the judgments (`canReportTarget`, `commentRowAction`,
	 * `ProfileActions`) change together, and the window unmounts on the spot. With one shared
	 * condition there is no place for them to diverge.
	 */
	it("the public menu folds the trigger and dialog together", () => {
		const menu = fileAt("features/moderation/report-menu.tsx");
		/** The judgment comes first, and only then do the trigger and the window appear. */
		expect(menu).toMatch(/if \(!canReportTarget\([^)]*\)\) return null;/);
		expect(menu.indexOf("canReportTarget")).toBeLessThan(
			menu.indexOf("{report.dialog}"),
		);
	});

	it("the comment row's dialog lives only in the report branch", () => {
		expect(fileAt("features/story/comments/comment-row.tsx")).toContain(
			'{action === "report" ? report.dialog : null}',
		);
	});

	it("the profile's dialog has the same condition as the manage menu", () => {
		const header = fileAt("features/profile/profile-header.tsx");
		expect(header).toContain("{showsMenu ? menu.trigger : null}");
		expect(header).toContain("{showsMenu ? menu.dialog : null}");
	});

	/**
	 * **Form values are not kept on the device.** An unfinished report contains a sentence the user
	 * wrote. Saving it would show that sentence in the form of whoever logs in next.
	 */
	it("doesn't store a half-written report", () => {
		for (const file of moderation)
			for (const forbidden of ["draft", "persist", "restore", "useEffect"])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});
});

describe("reporting doesn't drag public screens behind auth", () => {
	/**
	 * **This folder is drawn inside public screens**: the work detail, comment rows and the public
	 * profile. Those three follow the rule that they do not wait for identity or SQLite
	 * (`publicSurface` in `lib/boundaries.test.ts`), and that rule scans only the files in its own
	 * folder.
	 *
	 * That is its blind spot. A single `useMobileAppPhase()` line in the report menu would hang the
	 * whole work detail on that value, and the change would not touch a single file in
	 * `features/story/`. It never shows on a logged-in developer's screen. What surfaces is a
	 * logged-out user opening a work.
	 *
	 * Reading identity itself is not blocked. The action belongs to members, and `canReportTarget`
	 * takes the judgment as an argument. What is blocked is combining the session with device storage,
	 * and ending the screen early on that combined value.
	 */
	it("doesn't split by the combined app phase", () => {
		for (const file of moderation) {
			expect(file.text, file.path).not.toMatch(/\buseMobileAppPhase\b/);
			expect(file.text, file.path).not.toMatch(/\buseMobileLocalScope\b/);
			expect(file.text, file.path).not.toMatch(
				/if\s*\([^)]*scope\.status[^)]*\)\s*return/,
			);
		}
	});
});
