ALTER TABLE `departments`
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `dingtalk_sync_events` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NULL,
    `corpId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(191) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `dingtalk_sync_events_eventId_key` (`eventId`),
    INDEX `dingtalk_sync_events_status_receivedAt_idx` (`status`, `receivedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_departments` (
    `userId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `departmentId`),
    INDEX `user_departments_departmentId_userId_idx` (`departmentId`, `userId`),
    CONSTRAINT `user_departments_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `user_departments_departmentId_fkey`
        FOREIGN KEY (`departmentId`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `user_departments` (`userId`, `departmentId`, `isPrimary`)
SELECT `id`, `departmentId`, true
FROM `users`
WHERE `departmentId` IS NOT NULL;
