-- ATS-005：附件私有存储、上传防护与生命周期。
-- 附件记录补充存储驱动、敏感材料分类、到期时间与最近访问时间；
-- 新增保留期限清理批次记录，清理同时覆盖对象存储文件与结构化记录。

ALTER TABLE `resume_files`
    ADD COLUMN `storageDriver` VARCHAR(191) NOT NULL DEFAULT 'local',
    ADD COLUMN `category` ENUM('CANDIDATE_CONTACT', 'BACKGROUND_MATERIALS', 'BANK_STATEMENTS') NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `lastAccessedAt` DATETIME(3) NULL;

CREATE INDEX `resume_files_expiresAt_idx` ON `resume_files`(`expiresAt`);

CREATE TABLE `retention_runs` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `cutoff` DATETIME(3) NOT NULL,
    `scanned` INTEGER NOT NULL DEFAULT 0,
    `expired` INTEGER NOT NULL DEFAULT 0,
    `deletedFiles` INTEGER NOT NULL DEFAULT 0,
    `detachedIntakes` INTEGER NOT NULL DEFAULT 0,
    `failedDeletes` INTEGER NOT NULL DEFAULT 0,
    `dryRun` BOOLEAN NOT NULL DEFAULT false,
    `actorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `retention_runs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
