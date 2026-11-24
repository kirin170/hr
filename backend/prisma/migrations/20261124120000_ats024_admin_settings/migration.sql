-- ATS-024 业务设置与配置审计
-- 原因选项补齐排序、乐观锁版本与修改人；只增列不改含义，历史记录的 reasonId/原因快照保持不变
ALTER TABLE `reason_options`
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updatedById` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `reason_options_type_active_sortOrder_idx` ON `reason_options`(`type`, `active`, `sortOrder`);

-- 通用字典：职能类型 / 职级 / 需求类型 / 渠道 / 标签；稳定 ID + 启停，停用不删除
CREATE TABLE `dict_items` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dict_items_type_label_key`(`type`, `label`),
    INDEX `dict_items_type_active_sortOrder_idx`(`type`, `active`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 字段配置：职位 / 需求 / 候选人字段的必填与显示；固定必填字段由服务端注册表强制
CREATE TABLE `field_configs` (
    `id` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `fieldKey` VARCHAR(191) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `visible` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `field_configs_entity_fieldKey_key`(`entity`, `fieldKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 面试方案：轮次模板，职位通过 interviewPlanId 引用；停用后已有职位保持原引用
CREATE TABLE `interview_plans` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `rounds` INTEGER NOT NULL,
    `description` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 字段配置默认行：与 field-registry.ts 一一对应；固定必填字段在注册表里强制，这里只落可配置部分
INSERT INTO `field_configs` (`id`, `entity`, `fieldKey`, `required`, `visible`, `sortOrder`, `version`, `createdAt`, `updatedAt`) VALUES
  ('fld_job_title', 'JOB', 'title', false, true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_departmentId', 'JOB', 'departmentId', false, true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_headcount', 'JOB', 'headcount', false, true, 2, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_location', 'JOB', 'location', false, true, 3, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_recruiterId', 'JOB', 'recruiterId', false, true, 4, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_requirements', 'JOB', 'requirements', false, true, 5, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_interviewPlanId', 'JOB', 'interviewPlanId', false, true, 6, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_job_sources', 'JOB', 'sources', false, true, 7, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_title', 'REQUISITION', 'title', false, true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_departmentId', 'REQUISITION', 'departmentId', false, true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_headcount', 'REQUISITION', 'headcount', false, true, 2, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_recruitmentStartDate', 'REQUISITION', 'recruitmentStartDate', false, true, 3, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_jobLevel', 'REQUISITION', 'jobLevel', false, true, 4, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_recruiterId', 'REQUISITION', 'recruiterId', false, true, 5, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_requirements', 'REQUISITION', 'requirements', false, true, 6, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_requisition_note', 'REQUISITION', 'note', false, true, 7, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_name', 'CANDIDATE', 'name', false, true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_phone', 'CANDIDATE', 'phone', false, true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_email', 'CANDIDATE', 'email', false, true, 2, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_currentCompany', 'CANDIDATE', 'currentCompany', false, true, 3, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_currentTitle', 'CANDIDATE', 'currentTitle', false, true, 4, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_experience', 'CANDIDATE', 'experience', false, true, 5, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_education', 'CANDIDATE', 'education', false, true, 6, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_school', 'CANDIDATE', 'school', false, true, 7, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_channel', 'CANDIDATE', 'channel', false, true, 8, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_tags', 'CANDIDATE', 'tags', false, true, 9, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fld_candidate_summary', 'CANDIDATE', 'summary', false, true, 10, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- 字典默认项：取自现有业务表单中已在使用的内容，停用不删除
INSERT INTO `dict_items` (`id`, `type`, `label`, `active`, `sortOrder`, `version`, `createdAt`, `updatedAt`) VALUES
  ('dict_channel_1', 'CHANNEL', '官网投递', true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_2', 'CHANNEL', '内部推荐', true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_3', 'CHANNEL', 'BOSS直聘', true, 2, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_4', 'CHANNEL', '猎聘', true, 3, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_5', 'CHANNEL', '脉脉', true, 4, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_6', 'CHANNEL', '校园招聘', true, 5, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_channel_7', 'CHANNEL', '招聘邮箱', true, 6, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_tag_1', 'TAG', '新简历', true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_level_1', 'JOB_LEVEL', 'P4', true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_level_2', 'JOB_LEVEL', 'P5', true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_level_3', 'JOB_LEVEL', 'P6', true, 2, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_level_4', 'JOB_LEVEL', 'P7', true, 3, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dict_level_5', 'JOB_LEVEL', 'P8', true, 4, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- 面试方案默认项：只约定轮次数，不改变评价结论与阶段流转规则
INSERT INTO `interview_plans` (`id`, `name`, `rounds`, `description`, `active`, `sortOrder`, `version`, `createdAt`, `updatedAt`) VALUES
  ('plan_default_2', '标准两轮', 2, '初试 + 复试，适用于多数社招职位', true, 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('plan_default_3', '标准三轮', 3, '初试 + 复试 + 终面', true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- ATS-024 新增权限：配置查看与管理默认只授予系统管理员；角色自定义过的授权不被覆盖
INSERT INTO `permissions` (`id`, `code`, `description`, `createdAt`) VALUES
  ('perm_setting_read', 'setting:read', '查看管理后台配置与运行状态', CURRENT_TIMESTAMP(3)),
  ('perm_setting_manage', 'setting:manage', '维护业务配置（字段、字典、原因、面试方案）', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`code` IN ('setting:read', 'setting:manage')
WHERE r.`code` = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );
