-- ATS-021：AI 三场景正式适配的调用记录、人工编辑留痕与职位级开关
ALTER TABLE `ai_runs`
  ADD COLUMN `providerName` VARCHAR(191) NULL,
  ADD COLUMN `modelName` VARCHAR(191) NULL,
  ADD COLUMN `templateVersion` VARCHAR(191) NULL,
  ADD COLUMN `latencyMs` INTEGER NULL,
  ADD COLUMN `promptTokens` INTEGER NULL,
  ADD COLUMN `completionTokens` INTEGER NULL,
  ADD COLUMN `costMicros` INTEGER NULL,
  ADD COLUMN `validation` JSON NULL,
  ADD COLUMN `editedBy` VARCHAR(191) NULL,
  ADD COLUMN `editedAt` DATETIME(3) NULL,
  ADD COLUMN `dedupeKey` VARCHAR(191) NULL;

CREATE INDEX `ai_runs_type_createdAt_idx` ON `ai_runs`(`type`, `createdAt`);
CREATE INDEX `ai_runs_dedupeKey_status_idx` ON `ai_runs`(`dedupeKey`, `status`);

ALTER TABLE `jobs`
  ADD COLUMN `aiEvalEnabled` BOOLEAN NOT NULL DEFAULT true;
