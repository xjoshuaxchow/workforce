ALTER TABLE attempts ADD COLUMN IF NOT EXISTS response_at timestamptz;
UPDATE attempts a
SET response_at=e.received_at,
 response=CASE e.payload->>'option_id' WHEN 'ACCEPT' THEN 'accept' ELSE 'decline' END
FROM (
 SELECT DISTINCT ON (correlation_id) correlation_id,received_at,payload
 FROM message_events WHERE processed AND payload->>'type'='reply'
 AND payload->>'option_id' IN ('ACCEPT','DECLINE')
 ORDER BY correlation_id,received_at,id
) e
WHERE a.id::text=e.correlation_id AND a.response IS NOT NULL AND a.response_at IS NULL;
