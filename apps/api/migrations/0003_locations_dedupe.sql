-- GPS de-duplication. Two Android producers (the map view-model and the PTT foreground
-- service) each uploaded the fused provider's fix, so ~50% of stored rows were exact
-- duplicates (same user_id + timestamp + lat/lon). Those skew map-matching (repeated,
-- zero-time-delta points) and inflate storage.
--
-- Remove existing duplicates (keep one row per user+timestamp — the dupes are identical,
-- so which survivor is kept doesn't matter), then add a unique index so any future
-- double-submit is silently ignored (paired with ON CONFLICT DO NOTHING on insert).
-- No BEGIN/COMMIT: the migrate runner uses postgres.js simple protocol (implicit txn).

DELETE FROM locations a
USING locations b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.timestamp = b.timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_user_ts ON locations (user_id, timestamp);
