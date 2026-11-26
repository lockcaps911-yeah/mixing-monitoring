BEGIN;

INSERT INTO machines (code, line_code, name, is_active)
SELECT 'mixingL3', 'line3', 'Mixing Line 3', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM machines
  WHERE lower(line_code) = 'line3' AND lower(code) = 'mixingl3'
);

INSERT INTO parameters
  (machine_id, tag, name, parameter_type, data_type, unit, kepserver_tag, description, is_active)
SELECT m.id, v.tag, v.tag, v.parameter_type, 'Float', v.unit,
       'S7-1200PLC.MIXING_LINE3.' || v.tag,
       'Line 3 sensor parameter from Dokumentasi IoT - Line 3.tsv',
       TRUE
FROM machines m
-- PLC addresses are kept in the source CSV and must be configured on the
-- corresponding KEPServerEX tags; kepserver_tag stores the REST item ID.
CROSS JOIN (VALUES
  -- tag, parameter type, display unit
  ('DB2_CE1_01', 'conductivity', 'µS/cm'), -- DB2.DBD24
  ('DB2_WM1_01', 'weight', 'kg'),          -- DB2.DBD28
  ('DB2_MS1_01', 'frequency', 'rpm'),      -- DB2.DBD32
  ('DB2_PT1_01', 'pressure', 'bar'),       -- DB2.DBD20
  ('DB2_TT1_01', 'temperature', '°C'),    -- DB2.DBD0
  ('DB2_TT1_02', 'temperature', '°C'),    -- DB2.DBD4
  ('DB2_TT1_03', 'temperature', '°C'),    -- DB2.DBD8
  ('DB2_TT1_04', 'temperature', '°C'),    -- DB2.DBD12
  ('DB2_TT1_05', 'temperature', '°C'),    -- DB2.DBD16
  ('DB2_CE2_01', 'conductivity', 'µS/cm'), -- DB2.DBD60
  ('DB2_WM2_01', 'weight', 'kg'),          -- DB2.DBD64
  ('DB2_MS2_01', 'frequency', 'rpm'),      -- DB2.DBD68
  ('DB2_PT2_01', 'pressure', 'bar'),       -- DB2.DBD56; JSON field follows tag name
  ('DB2_TT2_01', 'temperature', '°C'),    -- DB2.DBD36
  ('DB2_TT2_02', 'temperature', '°C'),    -- DB2.DBD40
  ('DB2_TT2_03', 'temperature', '°C'),    -- DB2.DBD44
  ('DB2_TT2_04', 'temperature', '°C'),    -- DB2.DBD48
  ('DB2_TT2_05', 'temperature', '°C')     -- DB2.DBD52
) AS v(tag, parameter_type, unit)
WHERE lower(m.line_code) = 'line3' AND lower(m.code) = 'mixingl3'
  AND NOT EXISTS (
    SELECT 1 FROM parameters p
    WHERE p.machine_id = m.id AND lower(p.tag) = lower(v.tag)
  );

COMMIT;
