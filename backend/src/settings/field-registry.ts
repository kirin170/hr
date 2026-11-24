/**
 * 字段配置注册表（ATS-024 / FR-ADM-3）。
 *
 * 这里登记的是“允许配置的字段”及其生效方式；固定必填条件写死在注册表里，
 * 后台只能在不违反固定条件的前提下调整必填与显示，不能新增、删除或绕过。
 */
export const CONFIG_ENTITIES = ['JOB', 'REQUISITION', 'CANDIDATE'] as const;
export type ConfigEntity = (typeof CONFIG_ENTITIES)[number];

export const CONFIG_ENTITY_LABELS: Record<ConfigEntity, string> = {
  JOB: '职位字段',
  REQUISITION: '需求字段',
  CANDIDATE: '候选人字段',
};

/**
 * server：保存时由服务端按配置校验必填；
 * form：只驱动业务表单的显示与必填标记；
 * fixed：由领域流程强制，后台不提供开关说明以外的配置。
 */
export type FieldEffect = 'server' | 'form';

export type FieldDefinition = {
  entity: ConfigEntity;
  key: string;
  label: string;
  fixedRequired: boolean;
  fixedVisible: boolean;
  effect: FieldEffect;
  description: string;
};

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  { entity: 'JOB', key: 'title', label: '职位名称', fixedRequired: true, fixedVisible: true, effect: 'server', description: '固定必填：新建职位时服务端校验。' },
  { entity: 'JOB', key: 'departmentId', label: '所属部门', fixedRequired: true, fixedVisible: true, effect: 'server', description: '固定必填；正式部门以钉钉组织同步为来源。' },
  { entity: 'JOB', key: 'headcount', label: '招聘人数', fixedRequired: true, fixedVisible: true, effect: 'server', description: '固定必填：至少填写 0，且不能小于已入职人数。' },
  { entity: 'JOB', key: 'location', label: '工作地点', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建职位时按配置校验必填。' },
  { entity: 'JOB', key: 'recruiterId', label: '招聘负责人', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建职位时按配置校验必填。' },
  { entity: 'JOB', key: 'requirements', label: '招聘要求', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建职位时按配置校验必填；为空时 AI 评估入口禁用。' },
  { entity: 'JOB', key: 'interviewPlanId', label: '面试方案', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建职位时按配置校验必填；只能选用启用中的面试方案。' },
  { entity: 'JOB', key: 'sources', label: '招聘渠道', fixedRequired: false, fixedVisible: false, effect: 'form', description: '职位表单按“渠道”字典提供建议，允许填写多个。' },

  { entity: 'REQUISITION', key: 'title', label: '需求名称', fixedRequired: true, fixedVisible: true, effect: 'form', description: '固定必填：随 OA 审批同步生成时校验。' },
  { entity: 'REQUISITION', key: 'departmentId', label: '所属部门', fixedRequired: true, fixedVisible: true, effect: 'form', description: '固定必填：随 OA 审批同步带出。' },
  { entity: 'REQUISITION', key: 'headcount', label: '需求人数', fixedRequired: true, fixedVisible: true, effect: 'form', description: '固定必填：随 OA 审批同步带出。' },
  { entity: 'REQUISITION', key: 'recruitmentStartDate', label: '开始招聘时间', fixedRequired: true, fixedVisible: true, effect: 'form', description: '固定必填：生成需求时必填，仅关闭前可改；周期按需求级自然日差计算，不可配置。' },
  { entity: 'REQUISITION', key: 'jobLevel', label: '职级', fixedRequired: false, fixedVisible: false, effect: 'form', description: '需求表单按“职级”字典提供建议。' },
  { entity: 'REQUISITION', key: 'recruiterId', label: '招聘负责人', fixedRequired: false, fixedVisible: false, effect: 'form', description: '需求表单按配置标记必填。' },
  { entity: 'REQUISITION', key: 'requirements', label: '招聘要求', fixedRequired: false, fixedVisible: false, effect: 'form', description: '需求表单按配置标记必填。' },
  { entity: 'REQUISITION', key: 'note', label: '备注', fixedRequired: false, fixedVisible: false, effect: 'form', description: '需求表单按配置控制显示与必填。' },

  { entity: 'CANDIDATE', key: 'name', label: '候选人姓名', fixedRequired: true, fixedVisible: true, effect: 'server', description: '固定必填：新建候选人时服务端校验。' },
  { entity: 'CANDIDATE', key: 'phone', label: '手机号', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填；读写仍需联系方式独立授权。' },
  { entity: 'CANDIDATE', key: 'email', label: '邮箱', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填；读写仍需联系方式独立授权。' },
  { entity: 'CANDIDATE', key: 'currentCompany', label: '当前公司', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
  { entity: 'CANDIDATE', key: 'currentTitle', label: '当前职位', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
  { entity: 'CANDIDATE', key: 'experience', label: '工作年限', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
  { entity: 'CANDIDATE', key: 'education', label: '最高学历', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
  { entity: 'CANDIDATE', key: 'school', label: '毕业院校', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
  { entity: 'CANDIDATE', key: 'channel', label: '渠道', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填，取值须为启用中的“渠道”字典项。' },
  { entity: 'CANDIDATE', key: 'tags', label: '标签', fixedRequired: false, fixedVisible: false, effect: 'form', description: '候选人表单按“标签”字典提供建议，允许自由填写。' },
  { entity: 'CANDIDATE', key: 'summary', label: '简历摘要', fixedRequired: false, fixedVisible: false, effect: 'server', description: '新建候选人时按配置校验必填。' },
];

export function isConfigEntity(value: unknown): value is ConfigEntity {
  return typeof value === 'string' && (CONFIG_ENTITIES as readonly string[]).includes(value);
}

/** 值为空：未提供、空白字符串或空数组均视为未填写。 */
export function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 通用字典类型（FR-ADM-3）。 */
export const DICT_TYPES = ['CHANNEL', 'TAG', 'JOB_LEVEL', 'JOB_FUNCTION', 'REQUISITION_TYPE'] as const;
export type DictType = (typeof DICT_TYPES)[number];

export const DICT_TYPE_LABELS: Record<DictType, { label: string; effect: string; integrated: boolean }> = {
  CHANNEL: { label: '渠道', effect: '新建候选人的渠道取值校验，职位/候选人筛选建议', integrated: true },
  TAG: { label: '标签', effect: '候选人标签输入建议与筛选', integrated: true },
  JOB_LEVEL: { label: '职级', effect: '招聘需求表单职级建议', integrated: true },
  JOB_FUNCTION: { label: '职能类型', effect: '职位暂无职能类型字段，随职位模型扩展后接入表单', integrated: false },
  REQUISITION_TYPE: { label: '需求类型', effect: '招聘需求表单、OA 同步与报表“需求类型”维度统一取值，空值统计为“未填写”', integrated: true },
};

export function isDictType(value: unknown): value is DictType {
  return typeof value === 'string' && (DICT_TYPES as readonly string[]).includes(value);
}
