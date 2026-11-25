import { Test } from '@nestjs/testing';
import { DataScope } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module.js';
import type { AiRunService } from '../ai/ai-run.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CandidatesModule } from '../candidates/candidates.module.js';
import { MINUTES_SOURCE, MinutesSourceError, type MinutesSource } from '../dingtalk/dingtalk-minutes.client.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { InterviewTranscriptsService } from './interview-transcripts.service.js';
import { InterviewsController, InterviewRegistrationController } from './interviews.controller.js';
import { MockInterviewCalendar, MockInterviewNotifications, INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS } from './interview-adapters.js';
import { InterviewsService } from './interviews.service.js';

const isolated = process.env.ATS020_ISOLATED_TEST === '1'
  && /^ats020_tmp_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid').pathname.slice(1));

const MINUTES_ID = 'a1b2c3d4e5f60718';
const MINUTES_URL = `https://shanji.dingtalk.com/app/transcribes/${MINUTES_ID}`;

/**
 * 隔离库测试用内存听记源：真实读取走部署机上的 dws 服务账号，
 * 集成测试只验证 ATS 侧的数据范围、留存与交付，不拉起 CLI。
 */
class FakeMinutesSource implements MinutesSource {
  constructor(private readonly deniedOperator: string) {}

  capability() {
    return Promise.resolve({ state: 'AVAILABLE' as const, configured: true, checkedAt: new Date().toISOString(), code: null });
  }

  fetch(minutesId: string, operator: string) {
    if (operator === this.deniedOperator) {
      return Promise.reject(new MinutesSourceError('DENIED', 'MINUTES_CLI_DENIED'));
    }
    if (minutesId !== MINUTES_ID) {
      return Promise.reject(new MinutesSourceError('NOT_FOUND', 'MINUTES_NOT_FOUND'));
    }
    return Promise.resolve({
      minutesId,
      title: '一面听记',
      summary: '候选人介绍了订单系统改造经历',
      originalText: '面试官：请介绍项目\n候选人：负责订单系统改造',
      segments: [
        { index: 0, startMs: 0, endMs: 1500, speaker: '面试官', text: '请介绍项目' },
        { index: 1, startMs: 1500, endMs: 5000, speaker: '候选人', text: '负责订单系统改造' },
      ],
      transcriptUnavailable: null,
    });
  }
}

describe.skipIf(!isolated)('ATS-020 isolated MySQL integration', () => {
  const db = new PrismaService();
  const auth = new AuthorizationService(db);
  const actor = (id: string, scope: DataScope, perms: string[]): AuthenticatedUser => ({
    id, displayName: id, departmentId: null, departmentIds: [], groupIds: [],
    roles: [{ code: id, name: id, dataScope: scope, permissions: perms }],
  });
  const hr = actor('ats020_hr', DataScope.ALL, ['candidate:read', 'candidate:stage:update']);
  const interviewer = actor('ats020_i1', DataScope.PARTICIPATING, ['candidate:read']);
  const deniedInterviewer = actor('ats020_i2', DataScope.PARTICIPATING, ['candidate:read']);
  const outsider = actor('ats020_out', DataScope.SELF, ['candidate:read']);
  const noIdentity = actor('ats020_noid', DataScope.ALL, ['candidate:read']);
  const minutes = new FakeMinutesSource(deniedInterviewer.id);
  const service = new InterviewTranscriptsService(
    db,
    auth,
    new TimelineService(db),
    minutes,
    {} as unknown as AiRunService,
  );
  const interviews = new InterviewsService(db, auth, new MockInterviewNotifications(db), new MockInterviewCalendar(db));

  let interviewId = '';
  let linkId = '';

  beforeAll(async () => {
    await db.$connect();

    await db.user.createMany({
      data: [
        { id: hr.id, displayName: 'HR' },
        { id: interviewer.id, displayName: 'I1' },
        { id: deniedInterviewer.id, displayName: 'I2' },
        { id: outsider.id, displayName: 'Out' },
        { id: noIdentity.id, displayName: 'NoIdentity' },
      ],
    });
    await db.job.create({
      data: { id: 'ats020_job', code: 'ats020_job', title: '后端工程师', departmentId: 'ats020_dept', requirements: '五年以上 Java 经验，熟悉订单系统' },
    });
    await db.candidate.create({ data: { id: 'ats020_candidate', name: '候选人', jobId: 'ats020_job', stage: 'INTERVIEWING' } });
    const interview = await db.interview.create({
      data: {
        candidateId: 'ats020_candidate', jobId: 'ats020_job', round: 2, mode: 'VIDEO',
        time: new Date('2026-11-24T02:00:00.000Z'), endTime: new Date('2026-11-24T03:00:00.000Z'),
        interviewerIds: `|${interviewer.id}|${deniedInterviewer.id}|`,
      },
    });
    interviewId = interview.id;
    const link = await db.interviewTranscriptLink.create({
      data: { interviewId, candidateId: 'ats020_candidate', jobId: 'ats020_job', round: 2, url: MINUTES_URL, createdBy: hr.id, source: 'DINGTALK' },
    });
    linkId = link.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('reports tenant capability and reads material as the operator', async () => {
    expect(await service.capability(hr)).toMatchObject({ state: 'AVAILABLE', configured: true, manualEntryAvailable: true });

    const result = await service.fetchMaterial(interviewId, linkId, interviewer);
    expect(result.deduplicated).toBe(false);
    expect(result.material).toMatchObject({
      round: 2,
      source: 'DINGTALK',
      minutesId: MINUTES_ID,
      summary: '候选人介绍了订单系统改造经历',
    });
    expect(result.material.segments).toHaveLength(2);

    const stored = await db.interviewTranscriptMaterial.findMany({ where: { linkId } });
    expect(stored).toHaveLength(1);
    const link = await db.interviewTranscriptLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.minutesId).toBe(MINUTES_ID);
    expect(link.url).toBe(MINUTES_URL);
  });

  it('repeated reads deduplicate without overwriting the existing source link', async () => {
    const again = await service.fetchMaterial(interviewId, linkId, interviewer);
    expect(again.deduplicated).toBe(true);
    expect(await db.interviewTranscriptMaterial.count({ where: { linkId } })).toBe(1);
    expect((await db.interviewTranscriptLink.findUniqueOrThrow({ where: { id: linkId } })).url).toBe(MINUTES_URL);
  });

  it('rejects out-of-scope readers, ignores operator DingTalk binding, and keeps denials leak-free', async () => {
    await expect(service.fetchMaterial(interviewId, linkId, outsider)).rejects.toMatchObject({ status: 404 });

    // 服务账号读取：操作者未绑定钉钉身份也可读，归属由 ATS 审计记录
    const unbound = await service.fetchMaterial(interviewId, linkId, noIdentity);
    expect(unbound.material.minutesId).toBe(MINUTES_ID);

    const denied = await service.fetchMaterial(interviewId, linkId, deniedInterviewer).catch((error: unknown) => error);
    expect(denied).toMatchObject({ status: 403 });
    expect((denied as Error).message).not.toContain('候选人介绍了订单系统改造经历');
    const deniedEvent = await db.timelineEvent.findFirst({ where: { entityId: interviewId, action: 'interview.transcript.material_failed' }, orderBy: { createdAt: 'desc' } });
    expect(deniedEvent?.payload).toMatchObject({ code: 'MINUTES_CLI_DENIED', kind: 'DENIED' });
  });

  it('keeps manual entry as the degraded channel with write permission', async () => {
    await expect(service.addManualMaterial(interviewId, linkId, { originalText: '人工录入' }, interviewer)).rejects.toMatchObject({ status: 403 });
    const entered = await service.addManualMaterial(interviewId, linkId, { summary: 'HR 手工整理的摘要' }, hr);
    expect(entered.material).toMatchObject({ source: 'MANUAL_ENTRY', summary: 'HR 手工整理的摘要' });
    expect(await db.interviewTranscriptMaterial.count({ where: { linkId } })).toBe(2);
  });

  it('delivers material through the unified INTERVIEW_EVAL contract', async () => {
    await db.job.update({ where: { id: 'ats020_job' }, data: { requirements: null } });
    await expect(service.deliverToInterviewEval(interviewId, linkId, {}, hr)).rejects.toMatchObject({ status: 400 });
    await db.job.update({ where: { id: 'ats020_job' }, data: { requirements: '五年以上 Java 经验，熟悉订单系统' } });

    await db.interviewFeedback.create({
      data: { interviewId, interviewerId: interviewer.id, filledById: interviewer.id, filledByMode: 'SELF', content: '基础扎实', conclusion: 'PASS' },
    });
    const dingtalkMaterial = await db.interviewTranscriptMaterial.findFirstOrThrow({ where: { linkId, source: 'DINGTALK' } });
    const delivered = await service.deliverToInterviewEval(interviewId, linkId, { materialId: dingtalkMaterial.id }, hr);
    expect(delivered.airRun).toMatchObject({ type: 'INTERVIEW_EVAL', status: 'PENDING', isDraft: true });
    const run = await db.aIRun.findUniqueOrThrow({ where: { id: delivered.airRun.id } });
    expect(run.interviewId).toBe(interviewId);
    expect(run.inputRefs).not.toContain('负责订单系统改造');
    expect(JSON.parse(run.inputRefs ?? '{}')).toMatchObject({
      schema: 'interview-eval.v1',
      boundaries: { builtinMinutesSummaryUsedAsConclusion: false, aiOutputIsDraft: true, requiresManualConfirmation: true },
      transcript: { minutesId: MINUTES_ID, source: 'DINGTALK', textRef: 'interview_transcript_materials.originalText' },
    });
    expect((await service.evalRuns(interviewId, hr)).map((item) => item.id)).toContain(run.id);
  });

  it('appends links per round without overwriting earlier ones', async () => {
    const second = await interviews.addTranscript(interviewId, { url: `${MINUTES_URL}?round=2` }, hr);
    expect(second.minutesId).toBe(MINUTES_ID);
    const links = await interviews.transcripts(interviewId, hr);
    expect(links.map((item) => item.id)).toContain(linkId);
    expect(links.find((item) => item.id === linkId)?.url).toBe(MINUTES_URL);
    expect(links.find((item) => item.id === second.id)?.materials).toEqual([]);
  });

  it('exposes permission-checked transcript routes over HTTP', async () => {
    const read = await db.permission.create({ data: { code: 'candidate:read', description: 'test' } });
    const write = await db.permission.create({ data: { code: 'candidate:stage:update', description: 'test' } });
    const jobRead = await db.permission.create({ data: { code: 'job:read', description: 'test' } });
    const role = await db.role.create({
      data: { code: 'ats020_http', name: 'test', dataScope: 'ALL', permissions: { create: [{ permissionId: read.id }, { permissionId: write.id }, { permissionId: jobRead.id }] } },
    });
    await db.userRole.create({ data: { userId: hr.id, roleId: role.id } });

    const module = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, AuthorizationModule, AuthModule, CandidatesModule, JobsModule],
      controllers: [InterviewsController, InterviewRegistrationController],
      providers: [
        InterviewsService,
        InterviewTranscriptsService,
        TimelineService,
        { provide: MINUTES_SOURCE, useValue: minutes },
        { provide: INTERVIEW_CALENDAR, useClass: MockInterviewCalendar },
        { provide: INTERVIEW_NOTIFICATIONS, useClass: MockInterviewNotifications },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const token = app.get(AccessTokenService).issue(hr.id).token;
      await request(app.getHttpServer()).get('/interviews/minutes/capability').expect(401);
      const capability = await request(app.getHttpServer()).get('/interviews/minutes/capability').set('Authorization', `Bearer ${token}`).expect(200);
      expect(capability.body.state).toBe('AVAILABLE');
      const materials = await request(app.getHttpServer()).get(`/interviews/${interviewId}/transcripts/${linkId}/materials`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(materials.body.materials.length).toBeGreaterThanOrEqual(2);
      const fetched = await request(app.getHttpServer()).post(`/interviews/${interviewId}/transcripts/${linkId}/fetch`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
      expect(fetched.body.deduplicated).toBe(true);
      const runs = await request(app.getHttpServer()).get(`/interviews/${interviewId}/interview-eval`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(runs.body.length).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });
});
