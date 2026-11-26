BEGIN;

UPDATE parameters p
   SET kepserver_tag = CASE p.tag
         WHEN 'T1_Press_High_Alarm' THEN 'S7-1200PLC.MIXING LINE3.M175_7'
         WHEN 'T2_Press_High_Alarm' THEN 'S7-1200PLC.MIXING LINE3.M175_6'
       END,
       description = CASE p.tag
         WHEN 'T1_Press_High_Alarm' THEN 'T1 Tank High-Pressure Alarm'
         WHEN 'T2_Press_High_Alarm' THEN 'T2 Tank High-Pressure Alarm'
       END,
       updated_at = now()
  FROM machines m
 WHERE p.machine_id = m.id
   AND lower(m.line_code) = 'line3'
   AND lower(m.code) = 'mixingl3'
   AND p.tag IN ('T1_Press_High_Alarm', 'T2_Press_High_Alarm');

COMMIT;
