-- ATS-025 承接 ATS-018：记录首次创建远端日程的时间，用于按组织者统计每日新建量。
-- 改期与取消不写入该列，因此计数只反映「新建」，与钉钉每用户每日新建上限口径一致。
ALTER TABLE `interview_calendar_sync`
  ADD COLUMN `eventCreatedAt` DATETIME(3) NULL;

CREATE INDEX `interview_calendar_sync_organizerId_eventCreatedAt_idx`
  ON `interview_calendar_sync`(`organizerId`, `eventCreatedAt`);