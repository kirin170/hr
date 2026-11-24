INSERT INTO `reason_options` (`id`, `type`, `label`, `active`)
SELECT x.id, 'ONBOARD_ABANDON', x.label, true FROM (
  SELECT 'ats016_c1' id, '接受其他 Offer' label UNION ALL SELECT 'ats016_c2','原单位挽留'
  UNION ALL SELECT 'ats016_c3','入职时间无法匹配' UNION ALL SELECT 'ats016_c4','工作地点/通勤原因'
  UNION ALL SELECT 'ats016_c5','个人/家庭原因' UNION ALL SELECT 'ats016_c6','其他·可填写'
) x WHERE NOT EXISTS (SELECT 1 FROM `reason_options` r WHERE r.type = 'ONBOARD_ABANDON');
