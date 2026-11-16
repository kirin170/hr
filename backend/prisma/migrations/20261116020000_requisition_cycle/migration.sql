-- ATS-007: 职位与招聘需求（HC）分离，需求级招聘周期闭环。
-- 存量已关闭需求本期不补录开始/关闭时间：开始招聘时间改为可空，
-- 并以 cycleEligible=false 标记，排除在周期统计之外。

ALTER TABLE `job_requisitions`
    MODIFY COLUMN `recruitment_start_date` DATETIME(3) NULL,
    ADD COLUMN `oaApprovalTitle` VARCHAR(191) NULL,
    ADD COLUMN `recruiterId` VARCHAR(191) NULL,
    ADD COLUMN `cycleEligible` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `requirements` TEXT NULL;

CREATE INDEX `job_requisitions_status_closedAt_idx` ON `job_requisitions`(`status`, `closedAt`);
CREATE INDEX `job_requisitions_departmentId_status_idx` ON `job_requisitions`(`departmentId`, `status`);
CREATE INDEX `job_requisitions_recruiterId_idx` ON `job_requisitions`(`recruiterId`);

CREATE INDEX `jobs_departmentId_status_idx` ON `jobs`(`departmentId`, `status`);
CREATE INDEX `jobs_recruiterId_idx` ON `jobs`(`recruiterId`);
