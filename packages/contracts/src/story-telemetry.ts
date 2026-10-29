import { z } from "zod";

/**
 * Play-start telemetry: POST /v2/stories/:id/play-starts, sent only after the device has actually
 * created a session it can use locally.
 * - chat: after the room exists in IndexedDB or SQLite. sessionKey is the room id.
 * - runtime: after the VM session reaches `running`. sessionKey is the library row id. A button
 *   press, a 200 from /play, or the start of navigation is not the event. Only the device knows the
 *   real boundary.
 *
 * The request carries two values. sessionKey is an idempotency key, so resending it does not create
 * a second row. kind records what the device actually set up. The player comes from the session and
 * the story from the path. There are no member id, title, or timestamp fields, and the schema is
 * strict, so such fields return 400.
 *
 * The server does not trust the request. It rechecks eligibility, and for stories the caller cannot
 * play it returns the same 404 as a missing story. The endpoint therefore cannot inflate the
 * metrics of arbitrary stories.
 */

export const STORY_PLAY_KINDS = ["chat", "runtime"] as const;
export const StoryPlayKind = z.enum(STORY_PLAY_KINDS);
export type StoryPlayKind = z.infer<typeof StoryPlayKind>;

/**
 * Shape of a session key. Both a room id (a UUID without hyphens) and a library row id
 * (`runtime-conversation:…:default`) match. Length and characters are narrowed because this value
 * is part of the primary key.
 */
export const STORY_PLAY_SESSION_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export const StoryPlayStartRequest = z
	.object({
		sessionKey: z.string().regex(STORY_PLAY_SESSION_KEY_PATTERN),
		kind: StoryPlayKind,
	})
	.strict();
export type StoryPlayStartRequest = z.infer<typeof StoryPlayStartRequest>;

/**
 * Three successes return recorded: false: a replay with the same key, the owner playing their own
 * story, and a runtime session that was already counted. None of these is an error. A retry after a
 * lost response that received an error would show a failure on screen.
 */
export const StoryPlayStartResponse = z.object({ recorded: z.boolean() });
export type StoryPlayStartResponse = z.infer<typeof StoryPlayStartResponse>;

export const STORY_PLAY_START_ERROR_CODE = {
	rateLimited: "story_play_start_rate_limited",
} as const;
