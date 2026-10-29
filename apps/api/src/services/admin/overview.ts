import { type AdminOverviewDto, API_VERSION } from "@rowcat/contracts";
import { count, eq, gte, min, ne } from "drizzle-orm";
import { db, pingDb } from "../../db/client.ts";
import {
	member,
	moderation_appeal,
	moderation_case,
	moderation_report,
	story,
} from "../../db/schema.ts";
import { env } from "../../env.ts";

/**
 * Operations overview: measured values only. No composite score, health or engagement index; such
 * numbers answer no question and operators would decide on a value without knowing what it is a
 * function of.
 *
 * No Redis card: a compose container does not mean the API uses it (`apps/api` has no redis
 * dependency), and a card for an unused dependency would be permanently green and say nothing.
 *
 * The nine counts hit different tables, so they run in parallel instead of holding one pool
 * connection nine times. `COUNT(*)` scans, which is fine at current scale; the fix, when needed, is
 * a cache in this file.
 */

/** Age of the oldest report in hours, clamped at 0. */
const hoursSince = (from: Date): number =>
	Math.max(0, Math.floor((Date.now() - from.getTime()) / 3_600_000));

/**
 * Dependency check that really round-trips. `pingDb()` is the same function the `/ready` probe
 * uses; a different query here would let the console say "healthy" while the load balancer pulls
 * the instance.
 */
async function probeDb(): Promise<{
	status: "ok" | "down";
	latencyMs: number | null;
}> {
	const started = Date.now();
	try {
		await pingDb();
		return { status: "ok", latencyMs: Date.now() - started };
	} catch {
		return { status: "down", latencyMs: null };
	}
}

export async function readAdminOverview(): Promise<AdminOverviewDto> {
	const dbProbe = await probeDb();

	/**
	 * Skip the counts when the DB is down: all nine would throw and the operator would see a 500
	 * instead of the answer this screen exists for (what is down).
	 */
	if (dbProbe.status === "down")
		return {
			service: {
				health: [
					{ name: "api", status: "ok", latencyMs: 0 },
					{ name: "postgres", status: "down", latencyMs: null },
				],
				uptimeSeconds: Math.round(process.uptime()),
				environment: env.NODE_ENV,
				apiVersion: API_VERSION,
			},
			moderation: {
				openReports: 0,
				openCases: 0,
				openAppeals: 0,
				oldestOpenReportAgeHours: null,
			},
			product: {
				members: 0,
				suspendedMembers: 0,
				stories: 0,
				hiddenStories: 0,
				newMembersLast7Days: 0,
			},
		};

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
	const scalar = (rows: { value: number }[]): number => rows[0]?.value ?? 0;

	const [
		openReports,
		oldestOpenReport,
		openCases,
		openAppeals,
		members,
		suspendedMembers,
		newMembers,
		stories,
		hiddenStories,
	] = await Promise.all([
		db
			.select({ value: count() })
			.from(moderation_report)
			.where(eq(moderation_report.status, "open")),
		db
			.select({ value: min(moderation_report.created_at) })
			.from(moderation_report)
			.where(eq(moderation_report.status, "open")),
		db
			.select({ value: count() })
			.from(moderation_case)
			.where(eq(moderation_case.status, "open")),
		db
			.select({ value: count() })
			.from(moderation_appeal)
			.where(eq(moderation_appeal.status, "open")),
		db.select({ value: count() }).from(member),
		db
			.select({ value: count() })
			.from(member)
			.where(ne(member.status, "approved")),
		db
			.select({ value: count() })
			.from(member)
			.where(gte(member.created_at, sevenDaysAgo)),
		db.select({ value: count() }).from(story),
		db.select({ value: count() }).from(story).where(eq(story.hidden, true)),
	]);

	const oldest = oldestOpenReport[0]?.value ?? null;

	return {
		service: {
			health: [
				/**
				 * `api` is always `ok` because the response arriving is the card's content; if it does not
				 * arrive the screen draws a lookup failure, not 0 or "healthy".
				 */
				{ name: "api", status: "ok" as const, latencyMs: 0 },
				{
					name: "postgres",
					status: dbProbe.status,
					latencyMs: dbProbe.latencyMs,
				},
			],
			uptimeSeconds: Math.round(process.uptime()),
			environment: env.NODE_ENV,
			apiVersion: API_VERSION,
		},
		moderation: {
			openReports: scalar(openReports),
			openCases: scalar(openCases),
			openAppeals: scalar(openAppeals),
			oldestOpenReportAgeHours: oldest ? hoursSince(oldest) : null,
		},
		product: {
			members: scalar(members),
			suspendedMembers: scalar(suspendedMembers),
			stories: scalar(stories),
			hiddenStories: scalar(hiddenStories),
			newMembersLast7Days: scalar(newMembers),
		},
	};
}
