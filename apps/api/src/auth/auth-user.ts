import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { user } from "../db/schema.ts";

/**
 * Reads only the auth account's email and display name, by id. Security notices need a recipient,
 * and the code that builds them (plugin response hooks, passkey deletion) may not hold a session or
 * may target someone other than the session owner. Selecting just two columns is the point: a full
 * row brings `emailVerified`, `image` and `createdAt` along, and invites logging the object.
 */
export async function findAuthUser(
	id: string,
): Promise<{ email: string; name: string } | null> {
	const [row] = await db
		.select({ email: user.email, name: user.name })
		.from(user)
		.where(eq(user.id, id))
		.limit(1);
	return row ?? null;
}
