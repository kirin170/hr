-- ATS-010：通用浏览器导入 API 与任务审计。
-- 1) 浏览器导入任务补充来源页面脱敏 URL、平台候选人 ID、附件文件名与操作者，
--    并按 requestId + operatorId 幂等唯一；
-- 2) 候选人补来源平台 ID，支持按平台 ID 查重；
-- 3) 新增短期系统令牌表，只存令牌哈希与操作者绑定，过期即失效。

ALTER TABLE `browser_import_tasks`
    ADD COLUMN `sourcePageHost` VARCHAR(191) NULL,
    ADD COLUMN `fileName` VARCHAR(191) NULL,
    ADD COLUMN `errorStage` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `browser_import_tasks_operatorId_idx` ON `browser_import_tasks`(`operatorId`);
CREATE INDEX `browser_import_tasks_sourceSite_sourceCandidateId_idx` ON `browser_import_tasks`(`sourceSite`, `sourceCandidateId`);
CREATE UNIQUE INDEX `browser_import_tasks_requestId_operatorId_key` ON `browser_import_tasks`(`requestId`, `operatorId`);

ALTER TABLE `candidates`
    ADD COLUMN `sourcePlatformId` VARCHAR(191) NULL;

CREATE INDEX `candidates_sourcePlatformId_idx` ON `candidates`(`sourcePlatformId`);

CREATE TABLE `system_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `operatorId` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `issuedById` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `system_tokens_tokenHash_key`(`tokenHash`),
    INDEX `system_tokens_operatorId_idx`(`operatorId`),
    INDEX `system_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
