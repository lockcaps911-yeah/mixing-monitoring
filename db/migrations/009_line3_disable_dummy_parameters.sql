BEGIN;

UPDATE parameters p
   SET is_active = FALSE,
       updated_at = now()
  FROM machines m
 WHERE p.machine_id = m.id
   AND lower(m.line_code) = 'line3'
   AND lower(m.code) = 'mixingl3'
   AND upper(coalesce(p.kepserver_tag, '')) LIKE 'DUMMY.%'
   AND p.is_active;

COMMIT;
