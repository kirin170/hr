ALTER TABLE `offer_records`
  ADD COLUMN `workflowStage` VARCHAR(191) NULL,
  ADD COLUMN `stageStatus` VARCHAR(191) NULL,
  ADD COLUMN `workflowVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `hireLevel` VARCHAR(191) NULL,
  ADD COLUMN `salaryReturned` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `writtenResult` ENUM('ACCEPTED', 'REJECTED') NULL,
  ADD COLUMN `failureInitiator` VARCHAR(191) NULL,
  ADD COLUMN `failureReasonType` VARCHAR(191) NULL,
  ADD COLUMN `failureReasonLabel` VARCHAR(191) NULL,
  ADD COLUMN `failureReasonText` TEXT NULL;

ALTER TABLE `offer_records` MODIFY `materials` TEXT NULL;

INSERT INTO `reason_options` (`id`, `type`, `label`, `active`)
SELECT x.id, 'ARCHIVE', x.label, true FROM (
  SELECT 'ats015_a1' id, '岗位要求不匹配' label UNION ALL SELECT 'ats015_a2','面试评估不通过'
  UNION ALL SELECT 'ats015_a3','录用审批不通过' UNION ALL SELECT 'ats015_a4','背调审批不通过'
  UNION ALL SELECT 'ats015_a5','职位关闭/招聘计划调整' UNION ALL SELECT 'ats015_a6','其他·可填写'
) x WHERE NOT EXISTS (SELECT 1 FROM `reason_options` r WHERE r.type = 'ARCHIVE');
INSERT INTO `reason_options` (`id`, `type`, `label`, `active`)
SELECT x.id, 'OFFER_REJECT', x.label, true FROM (
  SELECT 'ats015_b1' id, '薪资待遇不符预期' label UNION ALL SELECT 'ats015_b2','接受其他 Offer'
  UNION ALL SELECT 'ats015_b3','岗位/发展方向不匹配' UNION ALL SELECT 'ats015_b4','工作地点/通勤不合适'
  UNION ALL SELECT 'ats015_b5','个人原因' UNION ALL SELECT 'ats015_b6','其他·可填写'
) x WHERE NOT EXISTS (SELECT 1 FROM `reason_options` r WHERE r.type = 'OFFER_REJECT');
