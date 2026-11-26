BEGIN;

-- Line 3 has no XV valves. Deactivate any rows imported from the generic
-- valve list so they are not shown or processed by the application.
UPDATE valves v
   SET is_active = FALSE,
       updated_at = now()
  FROM machines m
 WHERE v.machine_id = m.id
   AND lower(m.line_code) = 'line3'
   AND upper(v.tag) LIKE 'XV%'
   AND v.is_active;

COMMIT;
