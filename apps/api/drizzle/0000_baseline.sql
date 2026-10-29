-- 공개본의 기준선 — 운영 중이던 일곱 개의 마이그레이션을 스키마에서 다시 만든 한 장이다.
-- 운영 배포가 없어졌으므로 옛 데이터를 옮기는 문장(백필·이관)은 싣지 않는다
-- (`docs/oss/PLAN.md` D8). 결제 테이블 열여섯은 여기 없다.
--
-- 갤러리 검색(ILIKE '%q%')이 타는 GIN 인덱스가 이 확장의 연산자 클래스를 요구한다.
-- 인덱스 생성보다 반드시 먼저 와야 하므로 마이그레이션 맨 앞에 둔다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."orientation" AS ENUM('female', 'male', 'all');--> statement-breakpoint
CREATE TYPE "public"."story_play_kind" AS ENUM('chat', 'runtime');--> statement-breakpoint
CREATE TYPE "public"."story_visibility" AS ENUM('public', 'unlisted', 'private', 'archived');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"issuer" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"twoFactorEnabled" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"parent_id" text,
	"author" text,
	"body" text NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_comment_reaction" (
	"comment_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_comment_reaction_comment_id_member_id_kind_pk" PRIMARY KEY("comment_id","member_id","kind")
);
--> statement-breakpoint
CREATE TABLE "guardian_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"status" text NOT NULL,
	"token_hash" text NOT NULL,
	"verification_method" text,
	"verification_provider" text,
	"verification_ref" text,
	"guardian_name" text,
	"guardian_contact" text,
	"terms_version" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"adult" boolean,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_blob" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"adult" boolean DEFAULT false NOT NULL,
	"show_adult" boolean DEFAULT false NOT NULL,
	"managed_generation_allowed" boolean DEFAULT false NOT NULL,
	"age_status" text DEFAULT 'unknown' NOT NULL,
	"age_threshold_date" date,
	"age_recorded_at" timestamp with time zone,
	"terms_acked_version" text DEFAULT '' NOT NULL,
	"terms_acked_at" timestamp with time zone,
	"avatar_media_id" text,
	"avatar_url" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_update_job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text,
	"source_kind" text,
	"source_ref" text,
	"source_commit" text,
	"runtime_version" text,
	"target_release_id" text,
	"to_embedded" boolean DEFAULT false NOT NULL,
	"initial_rollout" integer,
	"note_id" text,
	"reason" text NOT NULL,
	"external_run_id" text,
	"external_run_url" text,
	"result_release_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" text,
	"failure_stage" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	CONSTRAINT "ck_mobile_update_job_kind" CHECK ("mobile_update_job"."kind" in ('publish', 'rollback')),
	CONSTRAINT "ck_mobile_update_job_status" CHECK ("mobile_update_job"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ck_mobile_update_job_channel" CHECK ("mobile_update_job"."channel" in ('preview', 'testflight', 'production')),
	CONSTRAINT "ck_mobile_update_job_platform" CHECK ("mobile_update_job"."platform" in ('ios', 'android')),
	CONSTRAINT "ck_mobile_update_job_rollback_target" CHECK ("mobile_update_job"."kind" <> 'rollback' or "mobile_update_job"."target_release_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "mobile_update_release" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"platform" text NOT NULL,
	"channel" text NOT NULL,
	"runtime_version" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"registered_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"rollout_percentage" integer NOT NULL,
	"status_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"signatures" jsonb NOT NULL,
	"api_origin" text NOT NULL,
	"assets" jsonb NOT NULL,
	"content_key" text NOT NULL,
	"republish_of" text,
	"source_commit" text NOT NULL,
	CONSTRAINT "ck_mobile_update_rollout" CHECK ("mobile_update_release"."rollout_percentage" between 0 and 100),
	CONSTRAINT "ck_mobile_update_status" CHECK ("mobile_update_release"."status" in ('draft', 'active', 'paused', 'rolled_back')),
	CONSTRAINT "ck_mobile_update_kind" CHECK ("mobile_update_release"."kind" in ('update', 'rollback_to_embedded')),
	CONSTRAINT "ck_mobile_update_channel" CHECK ("mobile_update_release"."channel" in ('preview', 'testflight', 'production')),
	CONSTRAINT "ck_mobile_update_platform" CHECK ("mobile_update_release"."platform" in ('ios', 'android'))
);
--> statement-breakpoint
CREATE TABLE "mobile_update_release_event" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_rollout" integer,
	"to_rollout" integer NOT NULL,
	"actor" text NOT NULL,
	"operator_id" text,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_restriction" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"capability" text NOT NULL,
	"action_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "moderation_action" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"actor" text,
	"target_member" text,
	"target_story" text,
	"target_comment_id" text,
	"comment_snapshot" jsonb,
	"kind" text NOT NULL,
	"capability" text,
	"reason" text NOT NULL,
	"public_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"reversed_by" text
);
--> statement-breakpoint
CREATE TABLE "moderation_appeal" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"member_id" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolver" text,
	"resolution_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_case" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_report" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"reporter" text,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolver" text,
	"resolution_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"kind" text NOT NULL,
	"actor" text,
	"story_id" text,
	"comment_id" text,
	"moderation_action_id" text,
	"moderation_appeal_id" text,
	"source_key" text NOT NULL,
	"terms_version" text,
	"terms_notice_phase" text,
	"app_platform" text,
	"app_version" text,
	"read_at" timestamp with time zone,
	"mailed_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notification_source" UNIQUE("recipient","source_key")
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"operator" text,
	"action" text NOT NULL,
	"target_type" text DEFAULT '' NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_app_version_floor" (
	"platform" text PRIMARY KEY NOT NULL,
	"min_version" text,
	"message" text DEFAULT '' NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "ops_feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'default' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "profile_pinned_story" (
	"member_id" text NOT NULL,
	"story_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_pinned_story_member_id_story_id_pk" PRIMARY KEY("member_id","story_id"),
	CONSTRAINT "uq_profile_pinned_story_position" UNIQUE("member_id","position"),
	CONSTRAINT "ck_profile_pinned_story_position" CHECK ("profile_pinned_story"."position" >= 0 and "profile_pinned_story"."position" < 3)
);
--> statement-breakpoint
CREATE TABLE "push_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"registration_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" text,
	"last_error" text,
	"accepted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_push_delivery_target" UNIQUE("notification_id","registration_id")
);
--> statement-breakpoint
CREATE TABLE "push_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"session_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"platform" text NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_push_registration_installation" UNIQUE("session_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "block" (
	"blocker" text NOT NULL,
	"creator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_blocker_creator_pk" PRIMARY KEY("blocker","creator")
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"story_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_member_id_story_id_pk" PRIMARY KEY("member_id","story_id")
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"follower" text NOT NULL,
	"creator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_follower_creator_pk" PRIMARY KEY("follower","creator")
);
--> statement-breakpoint
CREATE TABLE "download_log" (
	"story_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"orientation" "orientation",
	"adult" boolean DEFAULT false NOT NULL,
	"visibility" "story_visibility" DEFAULT 'public' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"prompt_protected" boolean DEFAULT false NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"origin_draft_id" text,
	"play_payload" jsonb,
	"downloads" integer DEFAULT 0 NOT NULL,
	"favorites" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"play_starts" integer DEFAULT 0 NOT NULL,
	"unique_play_starters" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_cover" (
	"story_id" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"version" text GENERATED ALWAYS AS (left(encode(sha256(bytes), 'hex'), 32)) STORED NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_play_log" (
	"story_id" text NOT NULL,
	"member_id" text,
	"session_key" text NOT NULL,
	"kind" "story_play_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_play_log_story_id_session_key_pk" PRIMARY KEY("story_id","session_key")
);
--> statement-breakpoint
CREATE TABLE "story_play_starter" (
	"story_id" text NOT NULL,
	"member_id" text,
	"first_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_view_log" (
	"story_id" text NOT NULL,
	"viewer" text NOT NULL,
	"day" text NOT NULL,
	CONSTRAINT "story_view_log_story_id_viewer_day_pk" PRIMARY KEY("story_id","viewer","day")
);
--> statement-breakpoint
CREATE TABLE "story_media" (
	"story_id" text NOT NULL,
	"media_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "story_media_story_id_media_id_role_pk" PRIMARY KEY("story_id","media_id","role")
);
--> statement-breakpoint
CREATE TABLE "story_runtime" (
	"story_id" text PRIMARY KEY NOT NULL,
	"artifact" jsonb NOT NULL,
	"artifact_format_version" integer NOT NULL,
	"runtime_api_version" integer NOT NULL,
	"compiler_version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"managed_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_keyring" (
	"owner" text PRIMARY KEY NOT NULL,
	"keyring" text NOT NULL,
	"auth_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_pairing" (
	"owner" text NOT NULL,
	"code_hash" text NOT NULL,
	"new_pub" text NOT NULL,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_pairing_owner_code_hash_pk" PRIMARY KEY("owner","code_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_push_dedupe" (
	"owner" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_push_dedupe_owner_idempotency_key_pk" PRIMARY KEY("owner","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sync_record" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"ciphertext" text,
	"envelope" integer NOT NULL,
	"version" integer NOT NULL,
	"seq" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sync_record_owner_id_pk" PRIMARY KEY("owner","id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"owner" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"tombstone_horizon_seq" bigint DEFAULT 0 NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_theme_customization" (
	"member_id" text PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'default' NOT NULL,
	"background" text,
	"surface" text,
	"primary" text,
	"gradient_to" text,
	"gradient_angle" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_parent_id_story_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."story_comment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_author_member_id_fk" FOREIGN KEY ("author") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_comment_reaction" ADD CONSTRAINT "story_comment_reaction_comment_id_story_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."story_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_comment_reaction" ADD CONSTRAINT "story_comment_reaction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_consent" ADD CONSTRAINT "guardian_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verification" ADD CONSTRAINT "identity_verification_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_update_job" ADD CONSTRAINT "mobile_update_job_requested_by_member_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_update_job" ADD CONSTRAINT "mobile_update_job_target_release_id_mobile_update_release_id_fk" FOREIGN KEY ("target_release_id") REFERENCES "public"."mobile_update_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_update_release_event" ADD CONSTRAINT "mobile_update_release_event_release_id_mobile_update_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."mobile_update_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_update_release_event" ADD CONSTRAINT "mobile_update_release_event_operator_id_member_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_restriction" ADD CONSTRAINT "member_restriction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_restriction" ADD CONSTRAINT "member_restriction_action_id_moderation_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_case_id_moderation_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_actor_member_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_target_member_member_id_fk" FOREIGN KEY ("target_member") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_target_story_story_id_fk" FOREIGN KEY ("target_story") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_reversed_by_moderation_action_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."moderation_action"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeal" ADD CONSTRAINT "moderation_appeal_action_id_moderation_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeal" ADD CONSTRAINT "moderation_appeal_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeal" ADD CONSTRAINT "moderation_appeal_resolver_member_id_fk" FOREIGN KEY ("resolver") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_report" ADD CONSTRAINT "moderation_report_case_id_moderation_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_report" ADD CONSTRAINT "moderation_report_reporter_member_id_fk" FOREIGN KEY ("reporter") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_report" ADD CONSTRAINT "moderation_report_resolver_member_id_fk" FOREIGN KEY ("resolver") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_member_id_fk" FOREIGN KEY ("recipient") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_member_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_moderation_action_id_moderation_action_id_fk" FOREIGN KEY ("moderation_action_id") REFERENCES "public"."moderation_action"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_moderation_appeal_id_moderation_appeal_id_fk" FOREIGN KEY ("moderation_appeal_id") REFERENCES "public"."moderation_appeal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_operator_member_id_fk" FOREIGN KEY ("operator") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_app_version_floor" ADD CONSTRAINT "ops_app_version_floor_updated_by_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_feature_flag" ADD CONSTRAINT "ops_feature_flag_updated_by_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_pinned_story" ADD CONSTRAINT "profile_pinned_story_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_pinned_story" ADD CONSTRAINT "profile_pinned_story_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_registration_id_push_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."push_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_registration" ADD CONSTRAINT "push_registration_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_registration" ADD CONSTRAINT "push_registration_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_member_id_fk" FOREIGN KEY ("blocker") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_creator_member_id_fk" FOREIGN KEY ("creator") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_member_id_fk" FOREIGN KEY ("follower") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_creator_member_id_fk" FOREIGN KEY ("creator") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_cover" ADD CONSTRAINT "story_cover_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_play_log" ADD CONSTRAINT "story_play_log_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_play_log" ADD CONSTRAINT "story_play_log_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_play_starter" ADD CONSTRAINT "story_play_starter_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_play_starter" ADD CONSTRAINT "story_play_starter_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_view_log" ADD CONSTRAINT "story_view_log_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_runtime" ADD CONSTRAINT "story_runtime_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_keyring" ADD CONSTRAINT "sync_keyring_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_pairing" ADD CONSTRAINT "sync_pairing_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_push_dedupe" ADD CONSTRAINT "sync_push_dedupe_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_record" ADD CONSTRAINT "sync_record_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_owner_member_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_theme_customization" ADD CONSTRAINT "member_theme_customization_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_idx" ON "account" USING btree ("issuer","accountId");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_story_comment_timeline" ON "story_comment" USING btree ("story_id","created_at","id") WHERE "story_comment"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "idx_story_comment_replies" ON "story_comment" USING btree ("parent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_story_comment_author" ON "story_comment" USING btree ("author","created_at");--> statement-breakpoint
CREATE INDEX "idx_story_comment_reaction_member" ON "story_comment_reaction" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_consent_token_idx" ON "guardian_consent" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_consent_open_idx" ON "guardian_consent" USING btree ("member_id") WHERE "guardian_consent"."status" in ('pending', 'verified');--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_consent_active_idx" ON "guardian_consent" USING btree ("member_id") WHERE "guardian_consent"."consented_at" is not null and "guardian_consent"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "guardian_consent_member_idx" ON "guardian_consent" USING btree ("member_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_verification_open_idx" ON "identity_verification" USING btree ("member_id","purpose") WHERE "identity_verification"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "identity_verification_ref_idx" ON "identity_verification" USING btree ("provider_ref") WHERE "identity_verification"."provider_ref" is not null;--> statement-breakpoint
CREATE INDEX "identity_verification_member_idx" ON "identity_verification" USING btree ("member_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_storage_key" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "idx_media_owner_kind" ON "media" USING btree ("owner","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_media_unready" ON "media" USING btree ("created_at") WHERE "media"."status" <> 'ready';--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "member_nickname_trgm_idx" ON "member" USING gin ("nickname" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mobile_update_job_active_stream" ON "mobile_update_job" USING btree ("channel","platform") WHERE "mobile_update_job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "idx_mobile_update_job_created" ON "mobile_update_job" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_mobile_update_job_target" ON "mobile_update_job" USING btree ("target_release_id");--> statement-breakpoint
CREATE INDEX "idx_mobile_update_stream" ON "mobile_update_release" USING btree ("platform","channel","runtime_version","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_mobile_update_event_release" ON "mobile_update_release_event" USING btree ("release_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_member_restriction_active" ON "member_restriction" USING btree ("member_id","capability") WHERE "member_restriction"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_moderation_action_case" ON "moderation_action" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_action_member" ON "moderation_action" USING btree ("target_member","kind","reversed_by");--> statement-breakpoint
CREATE INDEX "idx_moderation_action_story" ON "moderation_action" USING btree ("target_story");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_appeal_open_action" ON "moderation_appeal" USING btree ("action_id") WHERE "moderation_appeal"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_moderation_appeal_queue" ON "moderation_appeal" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_moderation_appeal_member" ON "moderation_appeal" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_case_open_target" ON "moderation_case" USING btree ("target_type","target_id") WHERE "moderation_case"."status" = 'open' and "moderation_case"."target_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_moderation_case_status" ON "moderation_case" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_moderation_report_queue" ON "moderation_report" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_moderation_report_case" ON "moderation_report" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_moderation_report_open_by_reporter" ON "moderation_report" USING btree ("reporter","target_type","target_id") WHERE "moderation_report"."status" = 'open' and "moderation_report"."reporter" is not null and "moderation_report"."target_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_moderation_report_reporter" ON "moderation_report" USING btree ("reporter");--> statement-breakpoint
CREATE INDEX "idx_notification_inbox" ON "notification" USING btree ("recipient","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notification_unread" ON "notification" USING btree ("recipient") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "idx_notification_actor" ON "notification" USING btree ("recipient","actor");--> statement-breakpoint
CREATE INDEX "idx_notification_terms_version" ON "notification" USING btree ("terms_version") WHERE "notification"."kind" = 'terms_updated';--> statement-breakpoint
CREATE INDEX "idx_notification_app_update" ON "notification" USING btree ("app_platform","app_version") WHERE "notification"."kind" = 'app_update';--> statement-breakpoint
CREATE INDEX "idx_notification_terms_mail_pending" ON "notification" USING btree ("recipient") WHERE "notification"."kind" = 'terms_updated' and "notification"."mailed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_recent" ON "admin_audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_operator" ON "admin_audit_log" USING btree ("operator","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_action" ON "admin_audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_target" ON "admin_audit_log" USING btree ("target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credentialID");--> statement-breakpoint
CREATE INDEX "idx_profile_pinned_story_story" ON "profile_pinned_story" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "idx_push_delivery_due" ON "push_delivery" USING btree ("next_attempt_at") WHERE "push_delivery"."state" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "idx_push_registration_member" ON "push_registration" USING btree ("member_id") WHERE "push_registration"."disabled_at" is null;--> statement-breakpoint
CREATE INDEX "idx_favorite_story" ON "favorite" USING btree ("story_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_follow_creator" ON "follow" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "idx_download_log_story" ON "download_log" USING btree ("story_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_story_public" ON "story" USING btree ("created_at" DESC NULLS LAST) WHERE "story"."hidden" = false and "story"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX "idx_story_owner" ON "story" USING btree ("owner","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_story_owner_origin_draft" ON "story" USING btree ("owner","origin_draft_id") WHERE "story"."origin_draft_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_story_tags" ON "story" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_story_title_trgm" ON "story" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_story_author_trgm" ON "story" USING gin ("author" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_story_description_trgm" ON "story" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_story_play_log_story" ON "story_play_log" USING btree ("story_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_story_play_starter" ON "story_play_starter" USING btree ("story_id","member_id") WHERE "story_play_starter"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_story_play_starter_story" ON "story_play_starter" USING btree ("story_id","first_started_at");--> statement-breakpoint
CREATE INDEX "idx_story_media_media" ON "story_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "sync_pairing_expiry_idx" ON "sync_pairing" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_push_dedupe_expiry_idx" ON "sync_push_dedupe" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_record_seq_idx" ON "sync_record" USING btree ("owner","seq");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");