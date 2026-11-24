-- ATS-023：需求类型维度接入（字典 REQUISITION_TYPE，空值统计为“未填写”）
ALTER TABLE `job_requisitions` ADD COLUMN `requisitionType` VARCHAR(191) NULL;

CREATE INDEX `job_requisitions_requisitionType_idx` ON `job_requisitions`(`requisitionType`);
