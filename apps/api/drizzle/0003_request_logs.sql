CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"model" text,
	"layer" text,
	"status" text,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"embedding_model" text,
	"embedding_tokens" integer,
	"match_score" double precision,
	"prompt_preview" text,
	"matched_prompt" text
);
--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_key_id_gateway_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."gateway_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_logs_workspace_id_created_at_id_index" ON "request_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_logs_created_at_index" ON "request_logs" USING btree ("created_at");