-- 약관 기능을 들어낸다(동의 게이트·개정 공지·공지 메일). 열을 지우기 전에 그 종류의 알림 행부터
-- 지운다 — 남겨 두면 어떤 화면도 그리지 못하는 행이 편지함에 쌓이고, 응답은 그 행을 버리면서
-- 읽지 않음 수에는 남는다. 푸시 전달 행은 외래 키의 cascade가 함께 데려간다.
DELETE FROM "notification" WHERE "kind" = 'terms_updated';--> statement-breakpoint
DROP INDEX "idx_notification_terms_version";--> statement-breakpoint
DROP INDEX "idx_notification_terms_mail_pending";--> statement-breakpoint
ALTER TABLE "guardian_consent" DROP COLUMN "terms_version";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "terms_acked_version";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "terms_acked_at";--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "terms_version";--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "terms_notice_phase";--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "mailed_at";