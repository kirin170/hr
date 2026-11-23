import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { CandidatesModule } from '../candidates/candidates.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { InterviewsModule } from './interviews.module.js';
import { DataScope } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MockInterviewCalendar, MockInterviewNotifications } from './interview-adapters.js';
import { InterviewsService } from './interviews.service.js';
const isolated = process.env.ATS014_ISOLATED_TEST === '1' && /^ats014_tmp_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid').pathname.slice(1));
describe.skipIf(!isolated)('ATS-014 isolated MySQL integration', () => {
  const db = new PrismaService(); const service = new InterviewsService(db, new AuthorizationService(db), new MockInterviewNotifications(db), new MockInterviewCalendar(db));
  const actor = (id: string, scope: DataScope, perms: string[]): AuthenticatedUser => ({ id, displayName: id, departmentId: null, departmentIds: [], groupIds: [], roles: [{ code: id, name: id, dataScope: scope, permissions: perms }] });
  const admin = actor('ats014_hr', DataScope.ALL, ['candidate:read', 'candidate:stage:update']); const interviewer = actor('ats014_i1', DataScope.PARTICIPATING, ['candidate:read']);
  let first = ''; let second = ''; let start = ''; let end = '';
  beforeAll(async () => {
    await db.$connect(); await db.user.createMany({ data: [{ id: admin.id, displayName: 'HR' }, { id: interviewer.id, displayName: 'I1' }, { id: 'ats014_i2', displayName: 'I2' }, { id: 'ats014_other', displayName: 'Other' }] });
    await db.job.createMany({ data: [{ id: 'ats014_job1', code: 'ats014_job1', title: 'Job1', departmentId: 'd1' }, { id: 'ats014_job2', code: 'ats014_job2', title: 'Job2', departmentId: 'd2' }] });
    await db.candidate.create({ data: { id: 'ats014_candidate', name: 'Candidate', jobId: 'ats014_job1', stage: 'INTERVIEWING' } });
    start = new Date(Date.now() + 86400000).toISOString(); end = new Date(Date.now() + 90000000).toISOString();
    await db.candidateDepartmentScreening.create({ data: { candidateId: 'ats014_candidate', result: 'PASS', reason: 'ok', availabilitySlots: [{ startAt: start, endAt: end }] } });
  });
  afterAll(async () => { await db.$disconnect(); });
  it('schedules, reads availability, warns conflicts, and records reasons and responses', async () => {
    expect(await service.availability('ats014_candidate', admin)).toHaveLength(1);
    const body = { candidateId: 'ats014_candidate', jobId: 'ats014_job1', round: 1, mode: 'VIDEO', startAt: start, endAt: end, interviewerIds: [interviewer.id, 'ats014_i2'] };
    const created = await service.create(body, admin); first = created.interview.id; expect(created.interview.interviewerIds).toEqual([interviewer.id, 'ats014_i2']);
    const pending = await service.create({ ...body, round: 2 }, admin); second = pending.interview.id; expect(pending.conflicts).toEqual([]);
    const other = actor('ats014_i2', DataScope.PARTICIPATING, ['candidate:read']);
    await Promise.all([service.respond(first, { response: 'ACCEPTED' }, interviewer), service.respond(first, { response: 'ACCEPTED' }, other)]);
    expect((await db.interview.findUniqueOrThrow({where:{id:first}})).responses).toMatchObject({ [interviewer.id]: 'ACCEPTED', ats014_i2: 'ACCEPTED' });
    await service.respond(first, { response: 'DECLINED' }, other);
    const accepted = await service.create({ ...body, round: 3 }, admin); expect(accepted.conflicts).toEqual([interviewer.id]);
    await expect(service.change(first, { action: 'CANCEL', reason: ' ' }, admin)).rejects.toThrow();
    await expect(service.change(first, { action: 'RESCHEDULE', reason: '', startAt:start, endAt:end }, admin)).rejects.toThrow();
    await service.respond(first, { response: 'ACCEPTED' }, interviewer); expect((await db.interview.findUniqueOrThrow({where:{id:first}})).responses).toMatchObject({ [interviewer.id]: 'ACCEPTED' });
    await service.respond(first, { response: 'DECLINED' }, interviewer); expect((await db.interview.findUniqueOrThrow({where:{id:first}})).responses).toMatchObject({ [interviewer.id]: 'DECLINED' });
    await service.change(first, { action: 'RESCHEDULE', reason: '冲突', startAt: start, endAt: end }, admin); await service.change(second, { action: 'CANCEL', reason: '取消原因' }, admin);
    expect(await db.interviewChange.count({where:{ interviewId: {in:[first,second]} }})).toBe(2);
    expect((await service.mockNotifications(first, admin)).map(n => n.recipient)).toContain('candidate:ats014_candidate');
  });
  it('restricts feedback by job and retains proxy information without stage changes', async () => {
    const feedback = await service.addFeedback(first, { interviewerId: interviewer.id, content: '通过', conclusion: 'PASS' }, admin);
    expect(feedback).toMatchObject({ filledByMode: 'PROXY', filledById: admin.id, proxyName: admin.displayName }); expect(feedback.proxyAt).toBeTruthy();
    await service.addFeedback(first, { interviewerId: interviewer.id, content: '本人评价', conclusion: 'HOLD' }, interviewer); expect(await service.feedback(first, interviewer)).toHaveLength(2);
    expect((await db.candidate.findUniqueOrThrow({where:{id:'ats014_candidate'}})).stage).toBe('INTERVIEWING');
    await db.candidate.update({where:{id:'ats014_candidate'},data:{jobId:'ats014_job2'}});
    const next = await service.create({candidateId:'ats014_candidate', jobId:'ats014_job2', round:1, mode:'PHONE', startAt:start, endAt:end, interviewerIds:['ats014_other']},admin);
    await service.addFeedback(next.interview.id, {interviewerId:'ats014_other',content:'新职位评价', conclusion:'REJECT'},admin);
    expect(await service.feedback(first, interviewer)).toHaveLength(2); await expect(service.feedback(next.interview.id, interviewer)).rejects.toThrow();
    await db.candidate.update({where:{id:'ats014_candidate'},data:{jobId:'ats014_job1'}});
  });
  it('appends links and preserves template versions with one-use candidate links', async () => {
    await service.addTranscript(first, {url:'https://example.org/a'},admin); await service.addTranscript(first, {url:'https://example.org/b'},admin); expect(await service.transcripts(first, interviewer)).toHaveLength(2);
    const template = await service.saveRegistrationTemplate({fields:[{key:'name',label:'姓名',type:'text',required:true}]},admin); const invite = await service.inviteRegistration(first, admin);
    await service.saveRegistrationTemplate({fields:[{key:'phone',label:'电话',type:'text',required:false}]},admin); expect((await service.publicRegistration(invite.token)).fields).toEqual(template.fields);
    await expect(service.publicSubmitRegistration(invite.token,{values:{}})).rejects.toThrow(); await service.publicSubmitRegistration(invite.token,{values:{name:'候选人'}});
    await expect(service.publicSubmitRegistration(invite.token,{values:{name:'重放'}})).rejects.toThrow(); expect((await service.registration(first, admin))[0].fields).toEqual(template.fields); await expect(service.registration(first, interviewer)).rejects.toThrow();
  });
  it('exposes authenticated routes and a public one-use registration flow over HTTP', async () => {
    const read = await db.permission.create({ data: { code:'candidate:read', description:'test' } });
    const write = await db.permission.create({ data: { code:'candidate:stage:update', description:'test' } });
    const jobRead = await db.permission.create({ data: { code:'job:read', description:'test' } });
    const role = await db.role.create({ data: { code:'ats014_http', name:'test', dataScope:'ALL', permissions: { create: [{permissionId:read.id}, {permissionId:write.id}, {permissionId:jobRead.id}] } } });
    await db.userRole.create({ data: { userId:admin.id, roleId:role.id } });
    const module = await Test.createTestingModule({ imports:[PrismaModule, AuditModule, AuthorizationModule, AuthModule, InterviewsModule, CandidatesModule, JobsModule] }).compile();
    const app = module.createNestApplication(); await app.init();
    try {
      const token = app.get(AccessTokenService).issue(admin.id).token;
      await request(app.getHttpServer()).get('/interviews').expect(401);
      const list = await request(app.getHttpServer()).get('/interviews').set('Authorization', `Bearer ${token}`).expect(200);
      expect(list.body.some((row: {id:string}) => row.id === first)).toBe(true);
      const invitation = await request(app.getHttpServer()).post(`/interviews/${first}/registration-invite`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
      const secret = invitation.body.token as string;
      await request(app.getHttpServer()).post('/interview-registration/open').send({token:secret}).expect(201);
      await request(app.getHttpServer()).post('/interview-registration/submit').send({token:secret,values:{phone:'123'}}).expect(201);
      await request(app.getHttpServer()).post('/interview-registration/open').send({token:secret}).expect(404);
      const shanghaiDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(d);
      const dayStart = (offset: number) => new Date(`${shanghaiDate(new Date(Date.now() + offset * 86400000))}T08:00:00+08:00`);
      for (const [offset, round] of [[0, 40], [-1, 41]] as const) {
        const at = dayStart(offset);
        await db.interview.create({ data:{ candidateId:'ats014_candidate', jobId:'ats014_job1', round, mode:'PHONE', time:at, endTime:new Date(at.getTime()+3600000), interviewerIds:`|${interviewer.id}|` } });
      }
      await app.listen(0, '127.0.0.1');
      const browserHelperPath = '../../scripts/ats014-ui-check.mjs';
      const { verifyInterviewUi } = await import(browserHelperPath);
      await verifyInterviewUi((app.getHttpServer().address() as { port:number }).port, token, first);
    } finally { await app.close(); }
  });

});
