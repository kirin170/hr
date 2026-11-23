-- ATS-013 人才库归档、激活与万级查询
-- 1) 人才库归档记录补齐历史字段（归档原因快照、未填写档标识、激活回写），并建立关系与索引
ALTER TABLE `talent_pool_entries`
    ADD COLUMN `reasonText` TEXT NULL,
    ADD COLUMN `reasonMissing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reactivatedAt` DATETIME(3) NULL,
    ADD COLUMN `reactivatedById` VARCHAR(191) NULL;

-- 历史数据：已激活记录回填激活时间，ReasonId 非空视为已填写归档原因
UPDATE `talent_pool_entries` SET `reactivatedAt` = `updatedAt` WHERE `reactivatedJobId` IS NOT NULL AND `reactivatedAt` IS NULL;
UPDATE `talent_pool_entries` SET `reasonMissing` = true WHERE `reasonId` IS NULL;

CREATE INDEX `talent_pool_entries_candidateId_archivedAt_idx` ON `talent_pool_entries`(`candidateId`, `archivedAt`);
CREATE INDEX `talent_pool_entries_archivedAt_idx` ON `talent_pool_entries`(`archivedAt`);

ALTER TABLE `talent_pool_entries`
    ADD CONSTRAINT `talent_pool_entries_candidateId_fkey`
        FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 候选人：归档来源渠道快照 + 万级列表/阶段计数索引
ALTER TABLE `candidates` ADD COLUMN `archiveChannel` VARCHAR(191) NULL;

CREATE INDEX `candidates_stage_updatedAt_createdAt_idx` ON `candidates`(`stage`, `updatedAt`, `createdAt`);
CREATE INDEX `candidates_poolType_stage_idx` ON `candidates`(`poolType`, `stage`);
CREATE INDEX `candidates_archiveChannel_stage_idx` ON `candidates`(`archiveChannel`, `stage`);
