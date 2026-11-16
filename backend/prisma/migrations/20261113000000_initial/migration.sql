-- CreateTable
CREATE TABLE `jobs` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `recruiterId` VARCHAR(191) NULL,
    `requirements` TEXT NULL,
    `headcount` INTEGER NOT NULL DEFAULT 0,
    `hiredCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `interviewPlanId` VARCHAR(191) NULL,
    `sources` VARCHAR(191) NULL,
    `isVirtual` BOOLEAN NOT NULL DEFAULT false,
    `requisitionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `jobs_code_key`(`code`),
    UNIQUE INDEX `jobs_requisitionId_key`(`requisitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_requisitions` (
    `id` VARCHAR(191) NOT NULL,
    `oaApprovalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `jobLevel` VARCHAR(191) NULL,
    `headcount` INTEGER NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'DINGTALK_OA',
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `submittedAt` DATETIME(3) NOT NULL,
    `recruitment_start_date` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `cycleDays` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_requisitions_oaApprovalId_key`(`oaApprovalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidates` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `poolType` ENUM('NONE', 'UNASSIGNED', 'VIRTUAL') NOT NULL DEFAULT 'NONE',
    `stage` ENUM('UNASSIGNED', 'VIRTUAL_POOL', 'RECOMMENDED', 'HR_SCREENING', 'DEPT_SCREENING', 'INTERVIEWING', 'OFFERING', 'PENDING_ONBOARD', 'ONBOARDED', 'PROBATION', 'ENDED', 'ARCHIVED') NOT NULL DEFAULT 'UNASSIGNED',
    `source` VARCHAR(191) NULL,
    `entryMode` VARCHAR(191) NULL,
    `browserImportTaskId` VARCHAR(191) NULL,
    `intentId` VARCHAR(191) NULL,
    `tags` VARCHAR(191) NULL,
    `rating` INTEGER NULL,
    `experience` VARCHAR(191) NULL,
    `education` VARCHAR(191) NULL,
    `school` VARCHAR(191) NULL,
    `currentCompany` VARCHAR(191) NULL,
    `currentTitle` VARCHAR(191) NULL,
    `summary` TEXT NULL,
    `resumeName` VARCHAR(191) NULL,
    `workHistory` JSON NULL,
    `note` TEXT NULL,
    `archiveReasonId` VARCHAR(191) NULL,
    `lockedState` ENUM('NONE', 'OPERABLE', 'INOPERABLE') NOT NULL DEFAULT 'NONE',
    `parsedProfileId` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `candidates_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interviews` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL DEFAULT 1,
    `mode` ENUM('ONSITE', 'VIDEO', 'PHONE') NOT NULL,
    `time` DATETIME(3) NOT NULL,
    `location` VARCHAR(191) NULL,
    `interviewerIds` VARCHAR(191) NULL,
    `status` ENUM('TO_SCHEDULE', 'FEEDBACK_PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'TO_SCHEDULE',
    `calendarEventId` VARCHAR(191) NULL,
    `cancelReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interview_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `interviewId` VARCHAR(191) NOT NULL,
    `interviewerId` VARCHAR(191) NOT NULL,
    `filledById` VARCHAR(191) NOT NULL,
    `filledByMode` VARCHAR(191) NOT NULL DEFAULT 'SELF',
    `proxyName` VARCHAR(191) NULL,
    `proxyAt` DATETIME(3) NULL,
    `content` TEXT NOT NULL,
    `aiSuggestionRunId` VARCHAR(191) NULL,
    `visibleToInterviewers` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offer_records` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `stage` ENUM('MATERIAL_PENDING', 'OA_PENDING', 'SALARY_RETURNED', 'NEGOTIATING', 'ORAL_ACCEPTED', 'ORAL_REJECTED', 'BG_IN_PROGRESS', 'BG_CONFIRMED', 'BG_FAILED', 'OFFER_TO_SEND', 'OFFER_SENT') NOT NULL DEFAULT 'MATERIAL_PENDING',
    `oaApprovalId` VARCHAR(191) NULL,
    `oralResult` ENUM('ACCEPTED', 'REJECTED') NULL,
    `rejectReasonId` VARCHAR(191) NULL,
    `backgroundCheckStatus` ENUM('PENDING', 'CONFIRMED_OK', 'CONFIRMED_FAILED') NOT NULL DEFAULT 'PENDING',
    `materials` VARCHAR(191) NULL,
    `onboardDate` DATETIME(3) NULL,
    `offerSentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `offer_records_candidateId_key`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `probation_records` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `converted` BOOLEAN NOT NULL DEFAULT false,
    `convertedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `probation_records_candidateId_key`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `talent_pool_entries` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `archivedAt` DATETIME(3) NOT NULL,
    `sourceStage` VARCHAR(191) NOT NULL,
    `reasonId` VARCHAR(191) NULL,
    `reactivatedJobId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reason_options` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('ARCHIVE', 'OFFER_REJECT', 'ONBOARD_ABANDON') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_runs` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('RESUME_PARSE', 'RESUME_EVAL', 'INTERVIEW_EVAL') NOT NULL,
    `inputRefs` VARCHAR(191) NULL,
    `output` TEXT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `isDraft` BOOLEAN NOT NULL DEFAULT true,
    `confirmedBy` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confidence` JSON NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `browser_import_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `operatorId` VARCHAR(191) NOT NULL,
    `sourceSite` VARCHAR(191) NOT NULL,
    `sourceCandidateId` VARCHAR(191) NULL,
    `sourcePageUrl` VARCHAR(191) NULL,
    `targetJobId` VARCHAR(191) NULL,
    `pagePayload` JSON NULL,
    `resumeFileId` VARCHAR(191) NULL,
    `fileHash` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'PARSING', 'SUCCESS', 'DUPLICATE', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `candidateId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `browser_import_tasks_requestId_key`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timeline_events` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resume_files` (
    `id` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `resume_files_sha256_key`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resume_intakes` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `entryMode` VARCHAR(191) NOT NULL,
    `status` ENUM('RECEIVED', 'PARSING', 'PARSED', 'DUPLICATE', 'NEEDS_MANUAL', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `candidateId` VARCHAR(191) NULL,
    `jobId` VARCHAR(191) NULL,
    `intentId` VARCHAR(191) NULL,
    `resumeFileId` VARCHAR(191) NULL,
    `airRunId` VARCHAR(191) NULL,
    `duplicateOfCandidateId` VARCHAR(191) NULL,
    `mailFrom` VARCHAR(191) NULL,
    `mailSubject` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `resume_intakes_status_idx`(`status`),
    INDEX `resume_intakes_entryMode_idx`(`entryMode`),
    INDEX `resume_intakes_candidateId_idx`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_inbox_configs` (
    `id` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'MOCK',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastPolledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mail_inbox_configs_address_key`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departments_code_key`(`code`),
    INDEX `departments_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `employeeNo` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `departmentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_employeeNo_key`(`employeeNo`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_departmentId_status_idx`(`departmentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_links` (
    `id` VARCHAR(191) NOT NULL,
    `provider` ENUM('LOCAL', 'DINGTALK') NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `identity_links_userId_idx`(`userId`),
    UNIQUE INDEX `identity_links_provider_subject_key`(`provider`, `subject`),
    UNIQUE INDEX `identity_links_provider_userId_key`(`provider`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `dataScope` ENUM('SELF', 'DEPARTMENT', 'OWN_JOBS', 'PARTICIPATING', 'DEPARTMENT_AND_PARTICIPATING', 'ALL') NOT NULL DEFAULT 'SELF',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `scopeOverride` ENUM('SELF', 'DEPARTMENT', 'OWN_JOBS', 'PARTICIPATING', 'DEPARTMENT_AND_PARTICIPATING', 'ALL') NULL,
    `assignedById` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_roleId_idx`(`roleId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_groups` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_groups_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_group_members` (
    `userId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_group_members_groupId_idx`(`groupId`),
    PRIMARY KEY (`userId`, `groupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_access_grants` (
    `id` VARCHAR(191) NOT NULL,
    `field` ENUM('CANDIDATE_CONTACT', 'BACKGROUND_MATERIALS', 'BANK_STATEMENTS') NOT NULL,
    `canRead` BOOLEAN NOT NULL DEFAULT false,
    `canWrite` BOOLEAN NOT NULL DEFAULT false,
    `userId` VARCHAR(191) NULL,
    `userGroupId` VARCHAR(191) NULL,
    `grantedById` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `field_access_grants_field_userId_expiresAt_idx`(`field`, `userId`, `expiresAt`),
    INDEX `field_access_grants_field_userGroupId_expiresAt_idx`(`field`, `userGroupId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_sessions_tokenHash_key`(`tokenHash`),
    INDEX `refresh_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `refresh_sessions_familyId_revokedAt_idx`(`familyId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `resourceType` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `beforeSummary` JSON NULL,
    `afterSummary` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `outcome` ENUM('SUCCESS', 'DENIED') NOT NULL DEFAULT 'SUCCESS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `audit_logs_resourceType_resourceId_createdAt_idx`(`resourceType`, `resourceId`, `createdAt`),
    INDEX `audit_logs_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `job_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interviews` ADD CONSTRAINT `interviews_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `resume_intakes` ADD CONSTRAINT `resume_intakes_resumeFileId_fkey` FOREIGN KEY (`resumeFileId`) REFERENCES `resume_files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_links` ADD CONSTRAINT `identity_links_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_members` ADD CONSTRAINT `user_group_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_members` ADD CONSTRAINT `user_group_members_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `user_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_access_grants` ADD CONSTRAINT `field_access_grants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_access_grants` ADD CONSTRAINT `field_access_grants_userGroupId_fkey` FOREIGN KEY (`userGroupId`) REFERENCES `user_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_access_grants` ADD CONSTRAINT `field_access_grants_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_sessions` ADD CONSTRAINT `refresh_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
