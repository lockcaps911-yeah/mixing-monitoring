BEGIN;

-- Correct PBV 1 and DKV 1 mappings from Dokumentasi IoT - Line 3.tsv.
-- The previous migration used the wrong PLC output blocks for these valves.
CREATE TEMP TABLE line3_valve_tags ON COMMIT DROP AS
WITH valve_tags(tag, plc_tag) AS (
  VALUES
    ('PBV 1-01', 'Q0_0'),
    ('PBV 1-02', 'Q0_1'),
    ('PBV 1-03', 'Q0_2'),
    ('PBV 1-04', 'Q0_3'),
    ('PBV 1-05', 'Q0_4'),
    ('PBV 1-06', 'Q0_5'),
    ('PBV 1-07', 'Q0_6'),
    ('PBV 1-08', 'Q0_7'),
    ('PBV 1-09', 'Q1_0'),
    ('PBV 1-10', 'Q1_1'),
    ('PBV 1-11', 'Q8_0'),
    ('PBV 1-12', 'Q8_1'),
    ('PBV 1-13', 'Q8_2'),
    ('PBV 1-14', 'Q8_3'),
    ('PBV 1-15', 'Q8_4'),
    ('PBV 1-16', 'Q8_5'),
    ('PBV 1-17', 'Q8_6'),
    ('PBV 1-18', 'Q8_7'),
    ('PBV 1-19', 'Q9_0'),
    ('PBV 1-20', 'Q9_1'),
    ('DKV 1-01', 'Q9_2'),
    ('DKV 1-02', 'Q9_3'),
    ('DKV 1-03', 'Q9_4'),
    ('DKV 1-04', 'Q9_5'),
    ('DKV 1-05', 'Q9_6'),
    ('DKV 1-06', 'Q9_7'),
    ('DKV 1-07', 'Q12_0'),
    ('DKV 1-08', 'Q12_1'),
    ('DKV 1-09', 'Q12_2'),
    ('DKV 1-10', 'Q12_3'),
    ('DKV 1-11', 'Q12_4'),
    ('DKV 1-12', 'Q12_5'),
    ('DKV 1-13', 'Q12_6'),
    ('DKV 1-14', 'Q12_7'),
    ('DKV 1-15', 'Q13_0'),
    ('DKV 1-16', 'Q13_1'),
    ('DKV 1-17', 'Q13_2'),
    ('DKV 1-18', 'Q13_3'),
    ('DKV 1-19', 'Q13_4'),
    ('DKV 1-20', 'Q13_5'),
    ('DKV 1-21', 'Q13_6'),
    ('DKV 1-22', 'Q13_7'),
    ('DKV 1-23', 'Q16_0'),
    ('DKV 1-24', 'Q16_1'),
    ('DKV 1-25', 'Q16_2')
)
SELECT tag, plc_tag FROM valve_tags;

UPDATE valves v
   SET kepserver_tag = '__LINE3_MIGRATION_006__' || v.id::text,
       updated_at = now()
  FROM line3_valve_tags d
 WHERE v.tag = d.tag
   AND v.machine_id IN (
     SELECT id
       FROM machines
      WHERE lower(line_code) = 'line3'
        AND lower(code) = 'mixingl3'
   );

UPDATE valves v
   SET kepserver_tag = 'S7-1200PLC.MIXING LINE3.' || d.plc_tag,
       updated_at = now()
  FROM line3_valve_tags d
 WHERE v.tag = d.tag
   AND v.machine_id IN (
     SELECT id
       FROM machines
      WHERE lower(line_code) = 'line3'
        AND lower(code) = 'mixingl3'
   );

COMMIT;
