-- semantic_entries.embedding has no fixed dimension; each HNSW index below covers one common
-- size via a cast and a partial predicate (must match INDEXED_DIMENSIONS in src/semantic/store.ts).
CREATE TABLE "semantic_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"embedding" vector NOT NULL,
	"dimensions" integer NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"semantic_enabled" boolean NOT NULL,
	"twin_threshold" double precision NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"embedding_model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "semantic_entries" ADD CONSTRAINT "semantic_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "semantic_entries_workspace_id_scope_hash_dimensions_index" ON "semantic_entries" USING btree ("workspace_id","scope_hash","dimensions");--> statement-breakpoint
CREATE INDEX "semantic_entries_expires_at_index" ON "semantic_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "semantic_entries_embedding_hnsw_384" ON "semantic_entries" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE "dimensions" = 384;--> statement-breakpoint
CREATE INDEX "semantic_entries_embedding_hnsw_512" ON "semantic_entries" USING hnsw (("embedding"::vector(512)) vector_cosine_ops) WHERE "dimensions" = 512;--> statement-breakpoint
CREATE INDEX "semantic_entries_embedding_hnsw_768" ON "semantic_entries" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE "dimensions" = 768;--> statement-breakpoint
CREATE INDEX "semantic_entries_embedding_hnsw_1024" ON "semantic_entries" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE "dimensions" = 1024;--> statement-breakpoint
CREATE INDEX "semantic_entries_embedding_hnsw_1536" ON "semantic_entries" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE "dimensions" = 1536;
