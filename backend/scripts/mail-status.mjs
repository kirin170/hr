// 邮箱抓取结果核对：打印最近邮件处理台账与对应入场记录（不输出凭据）。
import { PrismaClient } from '@prisma/client';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 忽略缺失的 env 文件
  }
}

const prisma = new PrismaClient();

try {
  const configs = await prisma.mailInboxConfig.findMany({ orderBy: { createdAt: 'asc' } });
  console.log('== 邮箱配置 ==');
  for (const config of configs) {
    console.log(
      `- ${config.address} provider=${config.provider} active=${config.active} host=${config.host ?? '-'} ` +
        `lastUid=${config.lastUid ?? '-'} lastPolledAt=${config.lastPolledAt?.toISOString() ?? '-'} ` +
        `status=${config.lastPollStatus ?? '-'} created=${config.lastCreatedCount} duplicate=${config.lastDuplicateCount} skipped=${config.lastSkippedCount}`,
    );
  }

  const logs = await prisma.mailMessageLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log('\n== 最近邮件处理台账 ==');
  for (const log of logs) {
    console.log(
      `- [${log.outcome}] uid=${log.uid ?? '-'} ${log.fromAddress ?? '-'} | ${(log.subject ?? '(无主题)').slice(0, 40)} | ` +
        `附件=${log.attachmentCount} 建档=${log.intakeCount} | ${(log.detail ?? '').slice(0, 120)}`,
    );
  }

  const intakes = await prisma.resumeIntake.findMany({
    where: { entryMode: 'EMAIL_AUTO' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      resumeFile: { select: { fileName: true, size: true, sha256: true } },
    },
  });
  const candidateIds = intakes.map((intake) => intake.candidateId).filter(Boolean);
  const candidates = candidateIds.length
    ? await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, poolType: true, stage: true, jobId: true },
      })
    : [];
  const candidateMap = new Map(candidates.map((item) => [item.id, item]));
  console.log('\n== 邮箱入场记录 ==');
  for (const intake of intakes) {
    const candidate = intake.candidateId ? candidateMap.get(intake.candidateId) : undefined;
    console.log(
      `- ${intake.id} status=${intake.status} file=${intake.resumeFile?.fileName ?? '-'} ` +
        `(${intake.resumeFile?.size ?? 0}B) pool=${candidate?.poolType ?? '-'} stage=${candidate?.stage ?? '-'} job=${intake.jobId ?? 'null'} ` +
        `mailbox=${intake.mailboxAddress ?? '-'}`,
    );
  }

  const counts = await prisma.resumeIntake.groupBy({
    by: ['status'],
    where: { entryMode: 'EMAIL_AUTO' },
    _count: { _all: true },
  });
  console.log('\n== 邮箱入场状态分布 ==');
  for (const row of counts) console.log(`- ${row.status}: ${row._count._all}`);
} finally {
  await prisma.$disconnect();
}
