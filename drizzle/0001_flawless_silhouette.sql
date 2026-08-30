ALTER TABLE "turns" ADD COLUMN "cache_read_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "cache_write_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "stop_reason" text;