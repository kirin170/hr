import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  ['authz:read', '查看角色、用户组和用户'],
  ['authz:admin', '管理用户与角色'],
  ['authz:field-grant:manage', '管理敏感字段授权'],
  ['organization:sync', '触发钉钉组织架构同步'],
  ['audit:read', '查看审计日志'],
  ['audit:export', '导出审计日志'],
  ['candidate:read', '查看权限范围内候选人'],
  ['candidate:create', '创建候选人'],
  ['candidate:stage:update', '推进候选人阶段'],
  ['job:read', '查看权限范围内职位'],
  ['job:create', '创建职位'],
  ['job:update', '编辑职位与招聘要求'],
  ['job:close', '关闭职位'],
  ['requisition:read', '查看权限范围内招聘需求'],
  ['requisition:manage', '维护招聘需求、开始招聘时间、关闭与回退'],
  ['requisition:sync', '触发钉钉 OA 招聘需求同步'],
  ['intake:read', '查看权限范围内简历入场记录'],
  ['intake:manage', '接收和处理简历入场记录'],
  ['retention:manage', '查看保留期限并触发到期清理'],
  ['ai:read', '查看权限范围内 AI 解析草稿'],
  ['ai:confirm', '确认 AI 解析草稿'],
];

const roles = [
  {
    code: 'ADMIN',
    name: '系统管理员',
    dataScope: 'ALL',
    permissionCodes: permissions.map(([code]) => code),
  },
  {
    code: 'RECRUITER',
    name: '招聘 HR',
    dataScope: 'OWN_JOBS',
    permissionCodes: [
      'candidate:read',
      'candidate:create',
      'candidate:stage:update',
      'job:read',
      'job:create',
      'job:update',
      'job:close',
      'requisition:read',
      'requisition:manage',
      'requisition:sync',
      'intake:read',
      'intake:manage',
      'ai:read',
      'ai:confirm',
    ],
  },
  {
    code: 'HIRING_MANAGER',
    name: '用人经理',
    dataScope: 'DEPARTMENT',
    permissionCodes: ['candidate:read', 'candidate:stage:update', 'job:read', 'requisition:read', 'intake:read', 'ai:read'],
  },
  {
    code: 'INTERVIEWER',
    name: '面试官',
    dataScope: 'PARTICIPATING',
    permissionCodes: ['candidate:read', 'job:read', 'ai:read'],
  },
];

try {
  const permissionIds = new Map();
  for (const [code, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      create: { code, description },
      update: { description },
      select: { id: true },
    });
    permissionIds.set(code, permission.id);
  }

  for (const definition of roles) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      create: {
        code: definition.code,
        name: definition.name,
        dataScope: definition.dataScope,
      },
      update: { name: definition.name, dataScope: definition.dataScope },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissionCodes.map((code) => ({
        roleId: role.id,
        permissionId: permissionIds.get(code),
      })),
    });
  }

  console.info(`Seeded ${permissions.length} permissions and ${roles.length} roles.`);
} finally {
  await prisma.$disconnect();
}
