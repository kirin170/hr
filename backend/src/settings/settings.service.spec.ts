import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DictSettingsService } from './dict-settings.service.js';
import { FieldConfigService } from './field-config.service.js';
import { ReasonSettingsService } from './reason-settings.service.js';
import type { AuditContext } from './settings-shared.js';

const actor = {
  id: 'usr_admin',
  displayName: '管理员',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [],
} as unknown as AuthenticatedUser;
const ctx: AuditContext = { requestId: 'req-ats024', ip: '127.0.0.1', userAgent: 'vitest' };

/**
 * 用最小 Prisma 替身验证「配置是否真的生效」：固定必填、版本冲突、选项唯一性、
 * 字典校验与有效配置输出。数据库约束由迁移 SQL 保证，这里不重复测 SQL。
 */
function mockPrisma(overrides: Record<string, Record<string, unknown>> = {}) {
  const tx = {
    reasonOption: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _max: { sortOrder: 0 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r_new', version: 1, active: true, createdAt: new Date(), updatedAt: new Date(), ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    fieldConfig: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    dictItem: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ id: 'd1' })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'd_new', version: 1, active: true, createdAt: new Date(), updatedAt: new Date(), ...data,
      })),
    },
    interviewPlan: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  // 写操作都在 $transaction 回调里用 tx 查询，覆盖项必须合并进同一个 tx，否则事务内仍是默认替身
  const models = tx as unknown as Record<string, Record<string, unknown>>;
  for (const [name, model] of Object.entries(overrides)) {
    models[name] = { ...models[name], ...model };
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    ...tx,
  };
  return { prisma, tx };
}

const asPrisma = (value: ReturnType<typeof mockPrisma>['prisma']) =>
  value as unknown as ConstructorParameters<typeof FieldConfigService>[0];

function services(prisma: ReturnType<typeof mockPrisma>['prisma']) {
  const dicts = new DictSettingsService(prisma as never);
  const fields = new FieldConfigService(asPrisma(prisma), dicts);
  const reasons = new ReasonSettingsService(prisma as never);
  return { fields, reasons, dicts };
}

describe('ATS-024 业务设置 · 字段配置', () => {
  it('有效配置输出固定必填、按配置追加的必填、启用中的字典与归档原因', async () => {
    const { prisma } = mockPrisma({
      fieldConfig: {
        findMany: vi.fn(async () => [{ entity: 'JOB', fieldKey: 'location', required: true, visible: false, version: 2 }]),
      },
      dictItem: {
        findMany: vi.fn(async () => [
          { type: 'CHANNEL', label: '官网投递' },
          { type: 'TAG', label: 'Java' },
        ]),
      },
      reasonOption: {
        findMany: vi.fn(async () => [{ id: 'r_other', label: '其他' }]),
      },
      interviewPlan: {
        findMany: vi.fn(async () => [{ id: 'p1', name: '标准两轮', rounds: 2 }]),
      },
    });
    const effective = await services(prisma).fields.effective();
    const name = effective.fields.CANDIDATE.find((field) => field.key === 'name');
    const location = effective.fields.JOB.find((field) => field.key === 'location');
    expect(name?.required).toBe(true);
    expect(location?.required).toBe(true);
    expect(location?.visible).toBe(false);
    expect(effective.dicts.CHANNEL).toEqual(['官网投递']);
    expect(effective.archiveReasons).toEqual([{ id: 'r_other', label: '其他', isOther: true }]);
    expect(effective.interviewPlans[0]).toMatchObject({ id: 'p1', rounds: 2 });
  });

  it('固定必填字段不能通过后台配置取消，且不会写入审计', async () => {
    const { prisma, tx } = mockPrisma({
      fieldConfig: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({
          id: 'fld_candidate_name', entity: 'CANDIDATE', fieldKey: 'name', required: true, visible: true, version: 1,
        })),
      },
    });
    await expect(
      services(prisma).fields.updateField('fld_candidate_name', { version: 1, required: false }, actor, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('版本冲突返回 409 且不写入审计', async () => {
    const { prisma, tx } = mockPrisma({
      fieldConfig: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({
          id: 'fld_job_location', entity: 'JOB', fieldKey: 'location', required: false, visible: true, version: 3,
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });
    await expect(
      services(prisma).fields.updateField('fld_job_location', { version: 2, required: true }, actor, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('业务保存按配置校验必填，缺失时拒绝', async () => {
    const { prisma } = mockPrisma({
      fieldConfig: {
        findMany: vi.fn(async () => [{ fieldKey: 'location', required: true }]),
      },
    });
    const { fields } = services(prisma);
    await expect(fields.assertRequired('JOB', { title: '前端工程师', departmentId: 'dep_1', headcount: 1 }))
      .rejects.toThrow(/工作地点不能为空/);
    await expect(fields.assertRequired('JOB', { title: '前端工程师', departmentId: 'dep_1', headcount: 1, location: '上海' }))
      .resolves.toBeUndefined();
  });

  it('候选人渠道必须取自启用中的渠道字典', async () => {
    const { prisma } = mockPrisma({
      dictItem: { findFirst: vi.fn(async () => null) },
    });
    const { fields } = services(prisma);
    await expect(fields.assertCandidateChannel('不存在的渠道')).rejects.toThrow(/不在可选项中/);
    await expect(fields.assertCandidateChannel('')).resolves.toBeUndefined();
  });
});

describe('ATS-024 业务设置 · 原因选项与字典', () => {
  it('非法原因集合与重复的「其他」都不能新增', async () => {
    const { prisma } = mockPrisma();
    const { reasons } = services(prisma);
    await expect(reasons.create({ type: 'NOT_A_SET', label: '薪资' }, actor, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(reasons.create({ type: 'ARCHIVE', label: '其他' }, actor, ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  it('「其他」不能改名或停用', async () => {
    const { prisma, tx } = mockPrisma({
      reasonOption: {
        findUnique: vi.fn(async () => ({
          id: 'r_other', type: 'ARCHIVE', label: '其他', active: true, sortOrder: 99, version: 5,
          createdAt: new Date(), updatedAt: new Date(),
        })),
      },
    });
    const { reasons } = services(prisma);
    await expect(reasons.update('r_other', { version: 5, label: '自定义原因' }, actor, ctx))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(reasons.update('r_other', { version: 5, active: false }, actor, ctx))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('原因选项版本过期时返回 409 且不写入审计', async () => {
    const { prisma, tx } = mockPrisma({
      reasonOption: {
        findUnique: vi.fn(async () => ({
          id: 'r_salary', type: 'ARCHIVE', label: '薪资未谈拢', active: true, sortOrder: 1, version: 3,
          createdAt: new Date(), updatedAt: new Date(),
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });
    await expect(services(prisma).reasons.update('r_salary', { version: 2, active: false }, actor, ctx))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('字典类型非法时拒绝新增', async () => {
    const { prisma } = mockPrisma();
    await expect(services(prisma).dicts.create({ type: 'UNKNOWN', label: '任意值' }, actor, ctx))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
