CREATE TRIGGER query_request_no_update BEFORE UPDATE ON query_request
BEGIN SELECT RAISE(ABORT, 'query_request is insert-once'); END;
--> statement-breakpoint
CREATE TRIGGER source_result_write_once BEFORE UPDATE ON source_result
WHEN OLD.status <> 'pending' OR NEW.status = 'pending'
  OR NEW.result_id IS NOT OLD.result_id OR NEW.correlation_id IS NOT OLD.correlation_id
  OR NEW.part_id IS NOT OLD.part_id OR NEW.source_id IS NOT OLD.source_id
  OR NEW.user_id IS NOT OLD.user_id OR NEW.credential_user_id IS NOT OLD.credential_user_id
  OR NEW.delegation_id IS NOT OLD.delegation_id OR NEW.adapter_kind IS NOT OLD.adapter_kind
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'source_result status is write-once from pending'); END;
--> statement-breakpoint
CREATE TRIGGER source_result_no_delete BEFORE DELETE ON source_result
BEGIN SELECT RAISE(ABORT, 'source_result rows are never deleted'); END;
