CREATE TABLE "deployment_setup" (
	"id" text PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"completed_by" text
);
--> statement-breakpoint
ALTER TABLE "deployment_setup" ADD CONSTRAINT "deployment_setup_completed_by_member_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;