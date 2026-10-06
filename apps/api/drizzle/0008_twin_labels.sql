CREATE TABLE "twin_labels" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"same" boolean NOT NULL,
	"labelled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_labels" ADD CONSTRAINT "twin_labels_request_id_request_logs_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_labels" ADD CONSTRAINT "twin_labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twin_labels_workspace_id_index" ON "twin_labels" USING btree ("workspace_id");