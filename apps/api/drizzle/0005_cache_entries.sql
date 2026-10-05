-- cache_entries.embedding has no fixed dimension; each HNSW index below covers one common
-- size via a cast and a partial predicate (must match INDEXED_DIMENSIONS in src/cache/entries.ts).
CREATE TABLE "cache_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"exact_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text,
	"scope_hash" text,
	"embedding" vector,
	"dimensions" integer,
	"response" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cache_entries_exact_key_unique" UNIQUE("exact_key")
);
--> statement-breakpoint
ALTER TABLE "cache_entries" ADD CONSTRAINT "cache_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cache_entries_workspace_id_scope_hash_dimensions_index" ON "cache_entries" USING btree ("workspace_id","scope_hash","dimensions");--> statement-breakpoint
CREATE INDEX "cache_entries_workspace_id_created_at_id_index" ON "cache_entries" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cache_entries_expires_at_index" ON "cache_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cache_entries_embedding_hnsw_384" ON "cache_entries" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE "dimensions" = 384;--> statement-breakpoint
CREATE INDEX "cache_entries_embedding_hnsw_512" ON "cache_entries" USING hnsw (("embedding"::vector(512)) vector_cosine_ops) WHERE "dimensions" = 512;--> statement-breakpoint
CREATE INDEX "cache_entries_embedding_hnsw_768" ON "cache_entries" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE "dimensions" = 768;--> statement-breakpoint
CREATE INDEX "cache_entries_embedding_hnsw_1024" ON "cache_entries" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE "dimensions" = 1024;--> statement-breakpoint
CREATE INDEX "cache_entries_embedding_hnsw_1536" ON "cache_entries" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE "dimensions" = 1536;
