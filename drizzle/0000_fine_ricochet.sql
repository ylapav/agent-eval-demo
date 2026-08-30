CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"topic" text NOT NULL,
	"preferred_window" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" text NOT NULL,
	"doc_title" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"score" real NOT NULL,
	"threshold" real NOT NULL,
	"passed" text NOT NULL,
	"cases" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"material" text,
	"colors" jsonb DEFAULT '[]'::jsonb,
	"price_eur" real,
	"unit" text,
	"lead_time_days" integer,
	"warranty_years" integer,
	"in_stock" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"priority" text NOT NULL,
	"summary" text NOT NULL,
	"contact_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"source" text NOT NULL,
	"user_message" text NOT NULL,
	"assistant_message" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb,
	"retrieved_chunk_ids" jsonb DEFAULT '[]'::jsonb,
	"model_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"cost_estimate_usd" real DEFAULT 0,
	"latency_ms" integer DEFAULT 0,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_doc_idx" ON "chunks" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "turns_session_idx" ON "turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "turns_created_idx" ON "turns" USING btree ("created_at");