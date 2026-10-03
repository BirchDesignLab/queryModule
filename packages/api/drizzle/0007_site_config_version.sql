CREATE TABLE `site_config_version` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`document` text NOT NULL,
	`config_hash` text,
	`base_version` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_by` text,
	`published_at` integer,
	`rollback_of` integer,
	CONSTRAINT "site_config_version_status_check" CHECK("site_config_version"."status" IN ('draft', 'published', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_config_version_site_version_uq` ON `site_config_version` (`site_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_config_version_one_published_uq` ON `site_config_version` (`site_id`) WHERE status = 'published';--> statement-breakpoint
CREATE TRIGGER site_config_version_frozen BEFORE UPDATE ON site_config_version
WHEN (OLD.status <> 'draft' AND (NEW.document IS NOT OLD.document OR NEW.config_hash IS NOT OLD.config_hash OR NEW.status = 'draft' OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.published_by IS NOT OLD.published_by OR NEW.published_at IS NOT OLD.published_at OR NEW.base_version IS NOT OLD.base_version OR NEW.rollback_of IS NOT OLD.rollback_of))
  OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.version IS NOT OLD.version OR NEW.rowid IS NOT OLD.rowid
  OR (NEW.status = 'published' AND OLD.status <> 'published' AND EXISTS (SELECT 1 FROM site_config_version WHERE site_id = NEW.site_id AND status = 'published'))
BEGIN SELECT RAISE(ABORT, 'site_config_version history is never rewritten'); END;
--> statement-breakpoint
CREATE TRIGGER site_config_version_no_delete BEFORE DELETE ON site_config_version
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'site_config_version history is never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER site_config_version_no_replace BEFORE INSERT ON site_config_version
WHEN EXISTS (SELECT 1 FROM site_config_version WHERE id = NEW.id OR (site_id = NEW.site_id AND version = NEW.version) OR rowid = NEW.rowid
  OR (NEW.status = 'published' AND site_id = NEW.site_id AND status = 'published'))
BEGIN SELECT RAISE(ABORT, 'site_config_version rows are never replaced'); END;
--> statement-breakpoint
CREATE TRIGGER site_config_version_positive_rowid AFTER INSERT ON site_config_version
WHEN NEW.rowid < 1
BEGIN SELECT RAISE(ABORT, 'site_config_version rowids are positive'); END;
