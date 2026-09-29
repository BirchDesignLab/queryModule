CREATE TRIGGER query_request_no_replace BEFORE INSERT ON query_request
WHEN EXISTS (SELECT 1 FROM query_request WHERE correlation_id = NEW.correlation_id AND part_id = NEW.part_id)
BEGIN SELECT RAISE(ABORT, 'query_request is insert-once'); END;
--> statement-breakpoint
CREATE TRIGGER source_result_no_replace BEFORE INSERT ON source_result
WHEN EXISTS (SELECT 1 FROM source_result WHERE result_id = NEW.result_id
  OR (correlation_id = NEW.correlation_id AND part_id = NEW.part_id AND source_id = NEW.source_id))
BEGIN SELECT RAISE(ABORT, 'source_result rows are never replaced'); END;
--> statement-breakpoint
CREATE TRIGGER query_request_no_delete BEFORE DELETE ON query_request
BEGIN SELECT RAISE(ABORT, 'query_request rows are never deleted'); END;
