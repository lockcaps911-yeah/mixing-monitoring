BEGIN;

-- The Line 3 REST export uses two namespaces:
--   MIXING LINE3    for PLC bit tags
--   MIXING_LINE3DB  for DB2 floating-point tags.
UPDATE parameters p
   SET kepserver_tag = CASE p.tag
     WHEN 'DB2_CE1_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_CE1_01'
     WHEN 'DB2_WM1_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_WM1_01'
     WHEN 'DB2_MS1_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_MS1_01'
     WHEN 'DB2_PT1_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_PT1_01'
     WHEN 'DB2_TT1_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT1_01'
     WHEN 'DB2_TT1_02' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT1_02'
     WHEN 'DB2_TT1_03' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT1_03'
     WHEN 'DB2_TT1_04' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT1_04'
     WHEN 'DB2_TT1_05' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT1_05'
     WHEN 'DB2_CE2_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_CE2_01'
     WHEN 'DB2_WM2_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_WM2_01'
     WHEN 'DB2_MS2_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_MS2_01'
     WHEN 'DB2_PT2_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_PT2_01'
     WHEN 'DB2_TT2_01' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT2_01'
     WHEN 'DB2_TT2_02' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT2_02'
     WHEN 'DB2_TT2_03' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT2_03'
     WHEN 'DB2_TT2_04' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT2_04'
     WHEN 'DB2_TT2_05' THEN 'S7-1200PLC.MIXING_LINE3DB.DB2_TT2_05'
   END,
   updated_at = now()
 WHERE p.machine_id IN (
   SELECT id FROM machines WHERE lower(line_code) = 'line3' AND lower(code) = 'mixingl3'
 )
   AND p.tag LIKE 'DB2\_%' ESCAPE '\';

WITH alarm_tags(tag, kepserver_tag, parameter_type, description) AS (
  VALUES
    ('T1_Steam_Press_High', 'S7-1200PLC.MIXING LINE3.I0_7', 'alarm_status', 'T1 Factory Steam Pressure High'),
    ('T2_Steam_Press_High', 'S7-1200PLC.MIXING LINE3.I1_2', 'alarm_status', 'T2 Factory Steam Pressure High'),
    ('T1_Press_High_Limit', 'S7-1200PLC.MIXING LINE3.M2_5', 'safety_status', 'T1 Tank Pressure Upper-Limit Protection Bit'),
    ('T2_Press_High_Limit', 'S7-1200PLC.MIXING LINE3.M2_6', 'safety_status', 'T2 Tank Pressure Upper-Limit Protection Bit'),
    ('T1_Press_High_Alarm', 'S7-1200PLC.MIXING LINE3.M175_7', 'alarm_status', 'T1 Tank High-Pressure Alarm'),
    ('T2_Press_High_Alarm', 'S7-1200PLC.MIXING LINE3.M175_6', 'alarm_status', 'T2 Tank High-Pressure Alarm')
)
INSERT INTO parameters
  (machine_id, tag, name, parameter_type, data_type, unit, kepserver_tag, description, is_active)
SELECT m.id, a.tag, a.tag, a.parameter_type, 'Boolean', 'ON/OFF', a.kepserver_tag, a.description, TRUE
  FROM machines m CROSS JOIN alarm_tags a
 WHERE lower(m.line_code) = 'line3' AND lower(m.code) = 'mixingl3'
   AND NOT EXISTS (
     SELECT 1 FROM parameters p WHERE p.machine_id = m.id AND lower(p.tag) = lower(a.tag)
   );

WITH valve_tags AS (
  SELECT 'PBV 1-' || lpad(n::text, 2, '0') AS tag,
         CASE WHEN n <= 8 THEN 'Q0_' || (n - 1)::text
              WHEN n <= 10 THEN 'Q1_' || (n - 9)::text
              WHEN n <= 18 THEN 'Q8_' || (n - 11)::text
              ELSE 'Q9_' || (n - 19)::text END AS plc_tag
    FROM generate_series(1, 20) AS n
  UNION ALL
  SELECT 'DKV 1-' || lpad(n::text, 2, '0'),
         CASE WHEN n <= 6 THEN 'Q9_' || (n + 1)::text
              WHEN n <= 14 THEN 'Q12_' || (n - 7)::text
              WHEN n <= 22 THEN 'Q13_' || (n - 15)::text
              ELSE 'Q16_' || (n - 23)::text END
    FROM generate_series(1, 25) AS n
  UNION ALL
  SELECT 'PBV 2-' || lpad(n::text, 2, '0'),
         CASE WHEN n <= 5 THEN 'Q16_' || (n + 2)::text
              WHEN n <= 13 THEN 'Q17_' || (n - 6)::text
              ELSE 'Q20_' || (n - 14)::text END
    FROM generate_series(1, 20) AS n
  UNION ALL
  SELECT 'DKV 2-' || lpad(n::text, 2, '0'),
         CASE WHEN n = 1 THEN 'Q20_7'
              WHEN n <= 9 THEN 'Q21_' || (n - 2)::text
              WHEN n <= 17 THEN 'Q24_' || (n - 10)::text
              ELSE 'Q25_' || (n - 18)::text END
    FROM generate_series(1, 25) AS n
),
resolved AS (
  SELECT tag, 'S7-1200PLC.MIXING LINE3.' || plc_tag AS kepserver_tag
    FROM valve_tags
)
INSERT INTO valves (machine_id, tag, name, kepserver_tag, description, is_active)
SELECT m.id, r.tag, r.tag, r.kepserver_tag, 'Line 3 valve from Dokumentasi IoT - Line 3.tsv', TRUE
  FROM machines m CROSS JOIN resolved r
 WHERE lower(m.line_code) = 'line3' AND lower(m.code) = 'mixingl3'
   AND NOT EXISTS (
     SELECT 1 FROM valves v WHERE v.machine_id = m.id AND lower(v.tag) = lower(r.tag)
   );

-- Re-running the migration also repairs rows created by an earlier partial import.
WITH valve_tags AS (
  SELECT 'PBV 1-' || lpad(n::text, 2, '0') AS tag,
         CASE WHEN n <= 8 THEN 'Q0_' || (n - 1)::text
              WHEN n <= 10 THEN 'Q1_' || (n - 9)::text
              WHEN n <= 18 THEN 'Q8_' || (n - 11)::text
              ELSE 'Q9_' || (n - 19)::text END AS plc_tag
    FROM generate_series(1, 20) AS n
  UNION ALL
  SELECT 'DKV 1-' || lpad(n::text, 2, '0'),
         CASE WHEN n <= 6 THEN 'Q9_' || (n + 1)::text
              WHEN n <= 14 THEN 'Q12_' || (n - 7)::text
              WHEN n <= 22 THEN 'Q13_' || (n - 15)::text
              ELSE 'Q16_' || (n - 23)::text END
    FROM generate_series(1, 25) AS n
  UNION ALL
  SELECT 'PBV 2-' || lpad(n::text, 2, '0'),
         CASE WHEN n <= 5 THEN 'Q16_' || (n + 2)::text
              WHEN n <= 13 THEN 'Q17_' || (n - 6)::text
              ELSE 'Q20_' || (n - 14)::text END
    FROM generate_series(1, 20) AS n
  UNION ALL
  SELECT 'DKV 2-' || lpad(n::text, 2, '0'),
         CASE WHEN n = 1 THEN 'Q20_7'
              WHEN n <= 9 THEN 'Q21_' || (n - 2)::text
              WHEN n <= 17 THEN 'Q24_' || (n - 10)::text
              ELSE 'Q25_' || (n - 18)::text END
    FROM generate_series(1, 25) AS n
)
UPDATE valves v
   SET kepserver_tag = 'S7-1200PLC.MIXING LINE3.' || t.plc_tag,
       updated_at = now()
  FROM valve_tags t
 WHERE v.tag = t.tag
   AND v.machine_id IN (
     SELECT id FROM machines WHERE lower(line_code) = 'line3' AND lower(code) = 'mixingl3'
   );

COMMIT;
