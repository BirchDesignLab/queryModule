CREATE TRIGGER query_request_no_replace BEFORE INSERT ON query_request
WHEN EXISTS (SELECT 1 FROM query_request WHERE correlation_id = NEW.correlation_id AND part_id = NEW.part_id)
  OR EXISTS (SELECT 1 FROM query_request WHERE rowid = NEW.rowid)
BEGIN SELECT RAISE(ABORT, 'query_request is insert-once'); END;
--> statement-breakpoint
CREATE TRIGGER query_request_idempotency_once BEFORE INSERT ON query_request
WHEN NEW.part_id = 0 AND NEW.idempotency_key IS NOT NULL
  AND EXISTS (SELECT 1 FROM query_request WHERE part_id = 0 AND user_id = NEW.user_id AND idempotency_key = NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'query_request idempotency key exists'); END;
--> statement-breakpoint
CREATE TRIGGER source_result_no_replace BEFORE INSERT ON source_result
WHEN EXISTS (SELECT 1 FROM source_result WHERE result_id = NEW.result_id
  OR (correlation_id = NEW.correlation_id AND part_id = NEW.part_id AND source_id = NEW.source_id))
  OR EXISTS (SELECT 1 FROM source_result WHERE rowid = NEW.rowid)
BEGIN SELECT RAISE(ABORT, 'source_result rows are never replaced'); END;
--> statement-breakpoint
CREATE TRIGGER query_request_no_delete BEFORE DELETE ON query_request
BEGIN SELECT RAISE(ABORT, 'query_request rows are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER query_request_positive_rowid AFTER INSERT ON query_request
WHEN NEW.rowid < 1
BEGIN SELECT RAISE(ABORT, 'query_request rowids are positive'); END;
--> statement-breakpoint
CREATE TRIGGER source_result_positive_rowid AFTER INSERT ON source_result
WHEN NEW.rowid < 1
BEGIN SELECT RAISE(ABORT, 'source_result rowids are positive'); END;
