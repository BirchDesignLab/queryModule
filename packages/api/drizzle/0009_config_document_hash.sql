ALTER TABLE `site_config_version` ADD `document_hash` text;--> statement-breakpoint
DROP TRIGGER site_config_version_frozen;
--> statement-breakpoint
CREATE TRIGGER site_config_version_frozen BEFORE UPDATE ON site_config_version
WHEN (OLD.status <> 'draft' AND (NEW.document IS NOT OLD.document OR NEW.config_hash IS NOT OLD.config_hash OR NEW.status = 'draft' OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.published_by IS NOT OLD.published_by OR NEW.published_at IS NOT OLD.published_at OR NEW.base_version IS NOT OLD.base_version OR NEW.rollback_of IS NOT OLD.rollback_of))
  OR (OLD.document_hash IS NOT NULL AND NEW.document_hash IS NOT OLD.document_hash)
  OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')
  OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.version IS NOT OLD.version OR NEW.rowid IS NOT OLD.rowid
  OR (NEW.status = 'published' AND OLD.status <> 'published' AND EXISTS (SELECT 1 FROM site_config_version WHERE site_id = NEW.site_id AND status = 'published'))
BEGIN SELECT RAISE(ABORT, 'site_config_version history is never rewritten'); END;
