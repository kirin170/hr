-- AlterTable
ALTER TABLE `interview_transcript_links` ADD COLUMN `source` ENUM('MANUAL', 'DINGTALK') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `minutesId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `interview_transcript_links_minutesId_idx` ON `interview_transcript_links`(`minutesId`);

-- AlterTable
ALTER TABLE `ai_runs` ADD COLUMN `interviewId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `ai_runs_interviewId_createdAt_idx` ON `ai_runs`(`interviewId`, `createdAt`);

-- CreateTable
CREATE TABLE `interview_transcript_materials` (
    `id` VARCHAR(191) NOT NULL,
    `linkId` VARCHAR(191) NOT NULL,
    `interviewId` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL,
    `source` ENUM('DINGTALK', 'MANUAL_ENTRY') NOT NULL,
    `minutesId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NULL,
    `summary` MEDIUMTEXT NULL,
    `originalText` MEDIUMTEXT NULL,
    `segments` JSON NULL,
    `contentHash` VARCHAR(191) NOT NULL,
    `sourceRef` VARCHAR(191) NOT NULL,
    `fetchedBy` VARCHAR(191) NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `interview_transcript_materials_linkId_contentHash_key`(`linkId`, `contentHash`),
    INDEX `interview_transcript_materials_interviewId_round_idx`(`interviewId`, `round`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `interview_transcript_materials` ADD CONSTRAINT `interview_transcript_materials_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `interview_transcript_links`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
