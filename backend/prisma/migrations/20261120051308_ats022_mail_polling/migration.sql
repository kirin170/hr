-- AlterTable
ALTER TABLE `mail_inbox_configs` ADD COLUMN `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `folder` VARCHAR(191) NOT NULL DEFAULT 'INBOX',
    ADD COLUMN `host` VARCHAR(191) NULL,
    ADD COLUMN `lastCreatedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastDuplicateCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastError` TEXT NULL,
    ADD COLUMN `lastErrorAt` DATETIME(3) NULL,
    ADD COLUMN `lastFetchedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastPollStatus` VARCHAR(191) NULL,
    ADD COLUMN `lastSkippedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastUid` VARCHAR(191) NULL,
    ADD COLUMN `lastUidValidity` VARCHAR(191) NULL,
    ADD COLUMN `pollIntervalSeconds` INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN `port` INTEGER NULL,
    ADD COLUMN `secretCipher` TEXT NULL,
    ADD COLUMN `secure` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `username` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `mail_message_logs` (
    `id` VARCHAR(191) NOT NULL,
    `mailboxAddress` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NULL,
    `fromAddress` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `attachmentCount` INTEGER NOT NULL DEFAULT 0,
    `intakeCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mail_message_logs_mailboxAddress_createdAt_idx`(`mailboxAddress`, `createdAt`),
    INDEX `mail_message_logs_outcome_idx`(`outcome`),
    UNIQUE INDEX `mail_message_logs_mailboxAddress_messageId_key`(`mailboxAddress`, `messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
