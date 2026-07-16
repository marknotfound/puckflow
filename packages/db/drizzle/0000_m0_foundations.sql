CREATE TYPE "public"."job_status" AS ENUM('pending', 'claimed', 'completed', 'canceled', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"team_id" uuid,
	"request_id" varchar(128) NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"deterministic_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"completed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_deterministic_key_unique" UNIQUE("deterministic_key"),
	CONSTRAINT "jobs_attempt_count_nonnegative" CHECK ("jobs"."attempt_count" >= 0),
	CONSTRAINT "jobs_max_attempts_positive" CHECK ("jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"team_id" uuid,
	"actor_user_id" uuid,
	"payload" jsonb NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"status" "webhook_event_status" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"sanitized_error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"clerk_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","next_attempt_at","due_at");--> statement-breakpoint
CREATE INDEX "outbox_events_undispatched_idx" ON "outbox_events" USING btree ("occurred_at","id") WHERE "outbox_events"."dispatched_at" IS NULL;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO puckflow_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users, webhook_events, audit_logs, outbox_events, jobs TO puckflow_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM puckflow_app;
