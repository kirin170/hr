-- Track the principal that created each resume intake so SELF data scope
-- remains enforceable even for duplicate or rejected intakes without candidates.
ALTER TABLE `resume_intakes`
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD INDEX `resume_intakes_createdById_idx`(`createdById`);

ALTER TABLE `resume_intakes`
    ADD CONSTRAINT `resume_intakes_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `system_settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
