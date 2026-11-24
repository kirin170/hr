CREATE TABLE `onboarding_reminders` (
  `id` VARCHAR(191) NOT NULL,
  `candidateId` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `recipientId` VARCHAR(191) NOT NULL,
  `onboardDate` DATETIME(3) NOT NULL,
  `dueAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `readAt` DATETIME(3) NULL,
  UNIQUE INDEX `onboarding_reminder_dedupe` (`candidateId`, `recipientId`, `onboardDate`, `dueAt`),
  INDEX `onboarding_reminders_recipientId_createdAt_idx` (`recipientId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
