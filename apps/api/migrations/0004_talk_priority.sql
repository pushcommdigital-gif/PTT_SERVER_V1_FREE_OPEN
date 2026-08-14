-- Dispatcher priority / override: per-user PTT talk-priority (1..15, higher wins).
-- Emergency (SOS / Lone Worker) is handled as an absolute flag in floor-control,
-- NOT via this number. No BEGIN/COMMIT (postgres.js simple protocol = implicit
-- transaction).

ALTER TABLE users ADD COLUMN IF NOT EXISTS talk_priority integer NOT NULL DEFAULT 1;

-- Backfill from role hierarchy so it works out of the box:
--   dispatcher-and-above (hierarchy_level >= 40) -> 10
--   mid-level / supervisor (20..39)              -> 5
--   everyone else                                -> 1 (the column default)
UPDATE users u
SET talk_priority = 10
FROM roles r
WHERE u.role = r.name
  AND u.department_id = r.department_id
  AND r.is_deleted = false
  AND r.hierarchy_level >= 40;

UPDATE users u
SET talk_priority = 5
FROM roles r
WHERE u.role = r.name
  AND u.department_id = r.department_id
  AND r.is_deleted = false
  AND r.hierarchy_level >= 20
  AND r.hierarchy_level < 40;
