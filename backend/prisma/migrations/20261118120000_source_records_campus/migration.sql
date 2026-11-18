-- ATS-009：简历来源记录与校园招聘投递门户。
-- 1) 入场记录补充推荐人/来源标识字段，供来源台账与查询筛选使用；
-- 2) 新增来源台账，查重合并时把重复记录的来源保留到原候选人；
-- 3) 新增校招投递与个人意愿表，人工分配正式职位后保留原始意愿。

ALTER TABLE `resume_intakes`
    ADD COLUMN `referrerName` VARCHAR(191) NULL,
    ADD COLUMN `referrerContact` VARCHAR(191) NULL,
    ADD COLUMN `referralCode` VARCHAR(191) NULL,
    ADD COLUMN `sourceNote` TEXT NULL;

CREATE INDEX `resume_intakes_referrerName_idx` ON `resume_intakes`(`referrerName`);
CREATE INDEX `resume_intakes_referralCode_idx` ON `resume_intakes`(`referralCode`);

CREATE TABLE `candidate_source_records` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `intakeId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `entryMode` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `referrerName` VARCHAR(191) NULL,
    `referrerContact` VARCHAR(191) NULL,
    `referralCode` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `mergedFromCandidateId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `candidate_source_records_intakeId_key`(`intakeId`),
    INDEX `candidate_source_records_candidateId_createdAt_idx`(`candidateId`, `createdAt`),
    INDEX `candidate_source_records_source_idx`(`source`),
    INDEX `candidate_source_records_jobId_idx`(`jobId`),
    INDEX `candidate_source_records_referrerName_idx`(`referrerName`),
    INDEX `candidate_source_records_referralCode_idx`(`referralCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `campus_applications` (
    `id` VARCHAR(191) NOT NULL,
    `intakeId` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `jobIsVirtual` BOOLEAN NOT NULL DEFAULT false,
    `preferences` TEXT NOT NULL,
    `school` VARCHAR(191) NULL,
    `major` VARCHAR(191) NULL,
    `graduationYear` VARCHAR(191) NULL,
    `expectedCity` VARCHAR(191) NULL,
    `availableFrom` DATETIME(3) NULL,
    `remark` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUBMITTED',
    `assignedJobId` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NULL,
    `assignedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `campus_applications_intakeId_key`(`intakeId`),
    INDEX `campus_applications_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `campus_applications_jobId_idx`(`jobId`),
    INDEX `campus_applications_candidateId_idx`(`candidateId`),
    INDEX `campus_applications_assignedJobId_idx`(`assignedJobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
