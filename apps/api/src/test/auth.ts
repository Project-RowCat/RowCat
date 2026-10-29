import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { member } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { apiGet, authPost, cookieFromResponse, jsonOf } from "./http.ts";

/**
 * Creates a test member through the real signup path, then calls `/me`. The `member` row is created
 * when the authenticated product identity is first resolved (`ensureMember` in `auth/viewer.ts`),
 * not at Better Auth signup; skipping that call makes a later `db.update(member)` touch 0 rows, and
 * assertions then verify "nothing exists yet" instead of "no duplicate" while still passing. This
 * invariant is explained only here.
 */

/** Test-only password, never used in any deployment. */
export const TEST_PASSWORD = "correct-horse-battery-staple";

export interface TestMember {
	cookie: string;
	email: string;
	/** Better Auth `user.id`, the auth identity. */
	authUserId: string;
	/** `member.id`, the product identity (`Viewer.id`); the two always differ. */
	memberId: string;
}

/** Each suite has its own prefix, which is the ownership boundary for cleanup (`deleteTestUsers`). */
const uniqueTestEmail = (emailPrefix: string): string =>
	`${emailPrefix}${newId()}@example.test`;

export async function createTestMember(
	emailPrefix: string,
	options: { name?: string; password?: string } = {},
): Promise<TestMember> {
	const email = uniqueTestEmail(emailPrefix);
	const password = options.password ?? TEST_PASSWORD;
	const response = await authPost("/sign-up/email", {
		name: options.name ?? "Test member",
		email,
		password,
	});
	const cookie = cookieFromResponse(response);
	const signUp = await jsonOf<{ user?: { id?: string } }>(response);

	const viewer = await jsonOf<{ id: string } | null>(
		await apiGet("/me", cookie),
	);
	if (!viewer) throw new Error(`the member was not created: ${email}`);

	return {
		cookie,
		email,
		authUserId: signUp.user?.id ?? "",
		memberId: viewer.id,
	};
}

/**
 * Turns on `member.managed_generation_allowed`, the same column an operator flips in the console.
 * Tests run on the deployment default (`MANAGED_GENERATION_ACCESS=allowlist`); switching it to
 * `everyone` would mean the allowlist path never runs in the suite and a route missing that gate
 * would stay green, so files testing generation opt their member in explicitly.
 */
export async function allowManagedGeneration(memberId: string): Promise<void> {
	await db
		.update(member)
		.set({ managed_generation_allowed: true })
		.where(eq(member.id, memberId));
}
