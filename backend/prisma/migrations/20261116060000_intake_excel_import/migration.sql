-- ATS-008：补齐简历入场 UI、批量导入与监控。
-- 1) 入场记录补充查重合并留痕，合并后来源与附件仍保留在本条记录上；
-- 2) 新增 Excel 批量导入批次与行级结果，Excel 走独立表格导入，不进入 AI 解析管道；
-- 3) 监控页按职位/邮箱/接收时间筛选，补充对应索引。

ALTER TABLE `resume_intakes`
    ADD COLUMN `mergedAt` DATETIME(3) NULL,
    ADD COLUMN `mergedById` VARCHAR(191) NULL,
    ADD COLUMN `mailboxAddress` VARCHAR(191) NULL;

CREATE INDEX `resume_intakes_jobId_idx` ON `resume_intakes`(`jobId`);
CREATE INDEX `resume_intakes_mailFrom_idx` ON `resume_intakes`(`mailFrom`);
CREATE INDEX `resume_intakes_mailboxAddress_idx` ON `resume_intakes`(`mailboxAddress`);

-- AI 解析输入引用为 JSON 文本，重试时追加 mockOutcome 会超出 VARCHAR(191) 导致重试失败
ALTER TABLE `ai_runs` MODIFY `inputRefs` TEXT NULL;

CREATE TABLE `excel_import_batches` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `successRows` INTEGER NOT NULL DEFAULT 0,
    `duplicateRows` INTEGER NOT NULL DEFAULT 0,
    `failedRows` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `excel_import_batches_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `excel_import_rows` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `payload` JSON NULL,
    `status` ENUM('SUCCESS', 'DUPLICATE', 'FAILED') NOT NULL DEFAULT 'FAILED',
    `candidateId` VARCHAR(191) NULL,
    `intakeId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `excel_import_rows_batchId_status_idx`(`batchId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `excel_import_batches`
    ADD CONSTRAINT `excel_import_batches_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `excel_import_rows`
    ADD CONSTRAINT `excel_import_rows_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `excel_import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
