ALTER TABLE `candidates`
    ADD COLUMN `channel` VARCHAR(191) NULL,
    ADD COLUMN `archiveReasonText` TEXT NULL,
    MODIFY COLUMN `tags` TEXT NULL;

CREATE TABLE `candidate_department_screenings` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `result` ENUM('PASS', 'HOLD', 'REJECT') NOT NULL,
    `reason` TEXT NULL,
    `availabilitySlots` JSON NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `candidate_department_screenings_candidateId_result_revokedAt_idx` (`candidateId`, `result`, `revokedAt`),
    INDEX `candidate_department_screenings_reviewerId_candidateId_idx` (`reviewerId`, `candidateId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `candidate_department_screenings_candidateId_fkey`
      FOREIGN KEY (`candidateId`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `candidate_department_screenings_reviewerId_fkey`
      FOREIGN KEY (`reviewerId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `saved_candidate_filters` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `filters` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `saved_candidate_filters_userId_name_key` (`userId`, `name`),
    INDEX `saved_candidate_filters_userId_updatedAt_idx` (`userId`, `updatedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `saved_candidate_filters_userId_fkey`
      FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
