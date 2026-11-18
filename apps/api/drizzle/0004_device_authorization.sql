CREATE TABLE "deviceCode" (
	"id" text PRIMARY KEY NOT NULL,
	"deviceCode" text NOT NULL,
	"userCode" text NOT NULL,
	"userId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"lastPolledAt" timestamp with time zone,
	"pollingInterval" integer,
	"clientId" text,
	"scope" text
);
--> statement-breakpoint
ALTER TABLE "deviceCode" ADD CONSTRAINT "deviceCode_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_deviceCode_idx" ON "deviceCode" USING btree ("deviceCode");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_userCode_idx" ON "deviceCode" USING btree ("userCode");