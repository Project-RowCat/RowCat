import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the wiring of personal moderation (`Restrictions` · `My reports` · appeals).
 *
 * The rules themselves are checked elsewhere: collection, visibility and the appeal cell in
 * `moderation-account-state.test.ts`, the accept order, locking and invalidation in
 * `appeal-turn.test.ts`, the state order of the list in `my-reports-state.test.ts`, and the cache
 * key hierarchy in the header of `moderation.ts` in `@rowcat/query`. What this file checks is
 * **whether they are actually called**, and **whether what must not be called is not**, and that
 * this surface lives **inside** the account screen.
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
 * the forbidden words ("the verdict is not stated"). Scanning the raw text would flag those
 * explanatory sentences as violations, and then everyone would edit the comments away to pass.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	/** The scanner holds the forbidden words as patterns itself. Scanning itself would always fail. */
	.filter(
		(file) => !file.path.endsWith("personal-moderation-boundaries.test.ts"),
	);

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

/** The files of personal moderation. Most of the rules below apply to this list. */
const PERSONAL_PATHS = [
	"features/moderation/account-moderation-section.tsx",
	"features/moderation/appeal-dialog.tsx",
	"features/moderation/appeal-form.ts",
	"features/moderation/appeal-turn.ts",
	"features/moderation/moderation-account-state.ts",
	"features/moderation/moderation-copy.ts",
	"features/moderation/my-reports-section.tsx",
	"features/moderation/my-reports-state.ts",
] as const;

const personal = product.filter((file) =>
	(PERSONAL_PATHS as readonly string[]).includes(file.path),
);

describe("the files actually exist", () => {
	it("the personal moderation files are all in place", () => {
		for (const path of PERSONAL_PATHS) expect(() => fileAt(path)).not.toThrow();
		expect(personal.length).toBe(PERSONAL_PATHS.length);
	});
});

describe("personal moderation lives inside the account screen", () => {
	/**
	 * The destination is `/account` alone. There is no moderation app for users, and the operations
	 * tool belongs to `apps/admin`. The two sections are composed by the account screen.
	 */
	it("there's no moderation route", () => {
		for (const path of [
			"app/moderation.tsx",
			"app/account/moderation.tsx",
			"app/my-reports.tsx",
			"app/appeals.tsx",
			"app/restrictions.tsx",
		])
			expect(
				product.some((file) => file.path === path),
				path,
			).toBe(false);

		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/["'`]\/moderation/);
			expect(file.text, file.path).not.toMatch(/["'`]\/account\/moderation/);
			expect(file.text, file.path).not.toMatch(/["'`]\/my-reports/);
			expect(file.text, file.path).not.toMatch(/["'`]\/appeals/);
		}
	});

	/**
	 * **Right after the profile, before the content.** The reason a restricted user opens this screen
	 * is usually "why can't I do this?", and that answer must not be at the bottom of the screen. The
	 * two sections differ: `Restrictions` (what happened to me) and `My reports` (what I requested) have opposite
	 * axes.
	 */
	it("the account screen composes the two sections in order", () => {
		const screen = fileAt("features/account/account-screen.tsx");
		const order = [
			"<ProfileSection",
			"<AccountModerationSection",
			"<MyReportsSection",
			"<ContentSection",
			"<SecuritySection",
		].map((tag) => screen.indexOf(tag));
		for (const [index, at] of order.entries())
			expect(at, `${index}`).toBeGreaterThan(-1);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	/** The owner of the meaning is this folder. The account screen only composes, as the imports show. */
	it("the account screen takes its sections from this folder", () => {
		const screen = fileAt("features/account/account-screen.tsx");
		expect(screen).toContain(
			'from "../moderation/account-moderation-section.tsx"',
		);
		expect(screen).toContain('from "../moderation/my-reports-section.tsx"');
	});
});

describe("the shared package owns server state", () => {
	it("sanction state goes through one shared lookup", () => {
		const section = fileAt(
			"features/moderation/account-moderation-section.tsx",
		);
		expect(section).toContain("moderationStatusQueryOptions");
		expect(section).toContain("accountModerationView");
		expect(section).toContain("<AppealDialog");
	});

	it("my reports go through one shared infinite lookup", () => {
		const section = fileAt("features/moderation/my-reports-section.tsx");
		expect(section).toContain("myReportsInfiniteQueryOptions");
		expect(section).toContain("myReportsPanelView");
	});

	/** Do not create mobile-only keys or endpoints. The cache hierarchy belongs to the shared package. */
	it("there's no mobile-only moderation cache", () => {
		for (const file of personal) {
			expect(file.text, file.path).not.toMatch(/queryKey:\s*\[\s*["']/);
			expect(file.text, file.path).not.toMatch(/client\.me\.[a-z]/i);
			/** `refetch` and `fetchNextPage` belong to the query. What is blocked is a bare `fetch` call. */
			expect(file.text, file.path).not.toMatch(/\bfetch\(/);
		}
	});

	/**
	 * Appeals call one member SDK method. Operator operations (queue, detail, enforcement, appeal
	 * handling) are not this app's. The SDK has those methods, so code that calls them compiles, and
	 * the scan therefore names them. The whole product is already scanned by
	 * `moderation-boundaries.test.ts`.
	 */
	it("appeals call moderation.appeal alone", () => {
		const dialog = fileAt("features/moderation/appeal-dialog.tsx");
		expect(dialog).toMatch(/moderation\.appeal\(/);
		expect(dialog).toContain("createAppealTurn");
		for (const file of personal)
			for (const absent of [
				"resolveAppeal",
				"moderationAppeals",
				"moderationQueue",
				"reportDetail",
				"executeAction",
				"reverseAction",
				"resolveReport",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("cache discipline", () => {
	/**
	 * **The one cell that an appeal filing marks stale is the account moderation status.** It does not
	 * use `["viewer"]` wholesale, since an appeal does not change the viewer, and it does not touch `My
	 * reports`, which has no relation to it. There is no optimistic insertion either: the authoritative
	 * appeal id and time come from the server.
	 */
	it("filing an appeal invalidates the sanction state alone", () => {
		const dialog = fileAt("features/moderation/appeal-dialog.tsx");
		expect(dialog).toContain("MY_MODERATION_QUERY_KEY");
		expect(dialog).not.toContain("MY_REPORTS_QUERY_KEY");
		expect(dialog).not.toMatch(/\["viewer"\]/);
	});

	/**
	 * **The restart of `My reports` resets only its own cell** (`exact: true`). Discarding the whole
	 * moderation prefix would take a sibling section's (`Restrictions`) values with it. It is the same wiring
	 * as the three cells of the security section. With a held value, it is a plain `refetch`.
	 */
	it("restarting my reports discards only its own cell", () => {
		const section = fileAt("features/moderation/my-reports-section.tsx");
		expect(section).toMatch(
			/resetQueries\(\{\s*queryKey:\s*MY_REPORTS_QUERY_KEY,\s*exact:\s*true,?\s*\}\)/,
		);
		expect(section).not.toContain("MODERATION_QUERY_KEY_PREFIX");
	});

	/** No optimistic updates. The absence of hand-edited cache code is what expresses that. */
	it("doesn't modify the cache by hand", () => {
		for (const file of personal) {
			expect(file.text, file.path).not.toContain("setQueryData");
			expect(file.text, file.path).not.toContain("setQueriesData");
			expect(file.text, file.path).not.toContain("onMutate");
			expect(file.text, file.path).not.toContain("removeQueries");
		}
		/** The restriction section only reads: there is no invalidation or reset in it. */
		const section = fileAt(
			"features/moderation/account-moderation-section.tsx",
		);
		expect(section).not.toContain("invalidateQueries");
		expect(section).not.toContain("resetQueries");
	});
});

describe("restricted accounts own this surface", () => {
	/**
	 * A suspended or blocked member needs this section the most. The moment the screen imitates the
	 * server's gate, a sanctioned person cannot object. Authorization belongs to the server
	 * (`requireViewer`).
	 */
	it("doesn't lock sections or dialogs by viewer state", () => {
		for (const file of personal) {
			expect(file.text, file.path).not.toContain("canInteract");
			expect(file.text, file.path).not.toMatch(/viewer\.status/);
			expect(file.text, file.path).not.toMatch(/=== "approved"/);
			expect(file.text, file.path).not.toContain("viewerAction");
		}
	});
});

describe("reporter privacy — dispositions don't reach the screen", () => {
	const reportsSurface = [
		"features/moderation/my-reports-section.tsx",
		"features/moderation/my-reports-state.ts",
	];

	/**
	 * The reporter sees only the two states in the contract (`Under review`, `Reviewed`). Once the vocabulary of
	 * internal dispositions enters this surface, the screen starts answering "what happened to the
	 * other party". That is not this screen's question, and it becomes a detector for existence and
	 * disposition.
	 */
	it("no disposition vocabulary", () => {
		for (const path of reportsSurface) {
			const text = fileAt(path);
			for (const absent of [
				"dismissed",
				"approved",
				"rejected",
				"actioned",
				"sanctioned",
				'"resolved"',
				'"dismissed"',
				"ReportStatus",
			])
				expect(text, `${path} — ${absent}`).not.toContain(absent);
		}
	});

	/** The source of the labels is the contract. Mobile does not create a second Korean table. */
	it("status labels come from the contract", () => {
		const section = fileAt("features/moderation/my-reports-section.tsx");
		expect(section).toContain("MY_REPORT_STATE_LABEL[report.state]");
		for (const path of reportsSurface)
			expect(fileAt(path), path).not.toMatch(/Record<MyReportState/);
	});

	/**
	 * **No actions on rows.** The target id is absent from the response, so there is nowhere to go.
	 * There is no withdrawal or edit, so there is no menu either. The check fails first if any row
	 * gains something pressable.
	 */
	it("report rows have neither navigation nor menu", () => {
		const section = fileAt("features/moderation/my-reports-section.tsx");
		for (const absent of [
			"Pressable",
			"useRouter",
			"router.",
			"DropdownMenu",
			"MenuItem",
			"onPress={() => open",
			"targetId",
			"storyId",
			"commentId",
			"creatorId",
		])
			expect(section, absent).not.toContain(absent);
	});
});

describe("presentation boundary", () => {
	/** Web UI, DOM and web motion do not come into this app. Meaning is carried over, not rendering. */
	it("no web render vocabulary", () => {
		for (const file of personal)
			for (const absent of [
				"@rowcat/ui-web",
				"motion/react",
				"className=",
				"dangerouslySetInnerHTML",
				"apps/admin",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});

	/** The appeal window's title is the restriction's name. The opaque reference (`actionId`) must not become screen text. */
	it("the appeal dialog speaks with the target's name", () => {
		const dialog = fileAt("features/moderation/appeal-dialog.tsx");
		expect(dialog).toContain("appealDialogTitle(subject)");
		expect(dialog).not.toMatch(/title=\{[^}]*actionId/);
		expect(dialog).toContain("REPORT_LIMITS.appealMessage");
	});

	/**
	 * **Do not cut input silently.** `maxLength` makes over-limit unrepresentable and silently deletes
	 * the tail of a pasted body. Over-limit is said by the guidance sentence and a locked submit
	 * button, not by truncation. The judgment is a pure function in `appeal-form.ts`.
	 */
	it("the appeal body has no maxLength — the decision states the excess", () => {
		const dialog = fileAt("features/moderation/appeal-dialog.tsx");
		expect(dialog).not.toContain("maxLength");
		expect(dialog).toContain("checkAppealMessage");
		expect(dialog).toMatch(/disabled=\{pending \|\| !check\.submittable\}/);
	});

	/**
	 * **The container is `Dialog` (compact).** It is a one-field form, so there is no reason to fill
	 * the screen (the presentation table in `docs/design/ARCHITECTURE.md`). It is not a destructive
	 * confirmation either: filing is a review request, not a destructive operation.
	 */
	it("the appeal dialog's container is a Dialog", () => {
		const dialog = fileAt("features/moderation/appeal-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toContain("<AlertDialog");
		expect(dialog).not.toContain('size="full"');
		expect(dialog).not.toMatch(/\bSheet\b/);
	});

	/**
	 * `Show more` exists and infinite scroll does not: account history is not discovery. There are no
	 * filters, sorting or tabs either, because it is a list of two values.
	 */
	it("my reports use show more, not infinite scroll", () => {
		const section = fileAt("features/moderation/my-reports-section.tsx");
		expect(section).toContain("hasNextPage");
		expect(section).toContain("isFetchingNextPage");
		expect(section).toContain("fetchNextPage");
		for (const absent of ["onEndReached", "FlatList", "<Select", "Tabs"])
			expect(section, absent).not.toContain(absent);
	});
});

describe("public reporting stays as is", () => {
	/** This slice did not rewrite the filing path. The window, the turn and the invalidation are in place. */
	it("the filing dialog and turn remain", () => {
		const dialog = fileAt("features/moderation/report-dialog.tsx");
		expect(dialog).toMatch(/moderation\.report\(/);
		expect(dialog).toContain("createReportTurn");
		expect(dialog).toContain("invalidateMyReports");
	});
});

describe("notifications come to the account", () => {
	/**
	 * The four moderation-family notifications all point at the account. The single place that turns
	 * that meaning into an address is the move table. A notification row does not grab the router
	 * directly.
	 */
	it("the destination vocabulary pairs with the navigation table", () => {
		const destination = fileAt(
			"features/notifications/notification-destination.ts",
		);
		expect(destination).toMatch(/kind:\s*"account"/);

		const screen = fileAt("features/notifications/general-notifications.tsx");
		expect(screen).toContain('router.push("/account")');
	});

	/** No section anchor or target id goes in the account address. That vocabulary does not exist in this product. */
	it("the account address has no anchor", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/\/account[?#](section|action|reports|moderation)/,
			);
	});
});
