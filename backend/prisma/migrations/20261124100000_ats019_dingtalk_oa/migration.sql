ALTER TABLE `job_requisitions`
  ADD COLUMN `oaBusinessId` VARCHAR(191) NULL;

ALTER TABLE `offer_records`
  ADD COLUMN `oaInstanceId` VARCHAR(191) NULL,
  ADD COLUMN `oaInstanceStatus` VARCHAR(32) NULL,
  ADD COLUMN `oaInstanceResult` VARCHAR(32) NULL,
  ADD COLUMN `oaSyncedAt` DATETIME(3) NULL,
  ADD COLUMN `oaSource` VARCHAR(32) NULL;

CREATE INDEX `offer_records_oaInstanceId_idx` ON `offer_records`(`oaInstanceId`);
