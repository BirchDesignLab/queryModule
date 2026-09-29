CREATE TRIGGER query_request_origin BEFORE INSERT ON query_request
WHEN NEW.origin NOT IN ('primary', 'alsoRun')
BEGIN SELECT RAISE(ABORT, 'query_request origin must be primary or alsoRun'); END;
