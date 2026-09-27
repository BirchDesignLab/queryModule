CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_event WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
