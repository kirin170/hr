import { describe, expect, it, vi } from 'vitest';
import { CandidatesService } from './candidates.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
const actor = { id: 'hr' } as AuthenticatedUser;
const offer = { jobId: 'j', workflowStage: 'WRITTEN_OFFER', stageStatus: 'ACCEPTED', writtenResult: 'ACCEPTED', backgroundCheckStatus: 'CONFIRMED_OK', offerSentAt: new Date(), onboardDate: new Date() };
function fixture(stage: string, record: unknown) {
 const current = { id:'c', name:'C', jobId:'j', stage, lockedState:'NONE', channel:null, createdAt:new Date(), updatedAt:new Date(), job:null };
 const tx = { candidate:{findFirst:vi.fn().mockResolvedValue(current),updateMany:vi.fn().mockResolvedValue({count:1}),findUniqueOrThrow:vi.fn().mockResolvedValue(current)},offerRecord:{findUnique:vi.fn().mockResolvedValue(record)},reasonOption:{findUnique:vi.fn()}, timelineEvent:{create:vi.fn()},job:{update:vi.fn()} };
 const db = {$transaction:(fn:(tx: unknown)=>unknown)=>fn(tx)} as unknown as PrismaService;
 const auth = {candidateWhere:()=>({}),canAccessSensitiveField:async()=>false} as unknown as AuthorizationService;
 return {service:new CandidatesService(db,auth),tx};
}
describe('persisted onboarding gates',()=>{
 it('requires all written Offer facts and matching job',async()=>{
  for(const record of [null,{...offer,jobId:'other'},{...offer,writtenResult:null},{...offer,backgroundCheckStatus:'CONFIRMED_FAILED'},{...offer,offerSentAt:null},{...offer,onboardDate:null},{...offer,stageStatus:'NOT_PASSED'}]) {
   await expect(fixture('OFFERING',record).service.updateStage('c',{stage:'PENDING_ONBOARD'},actor)).rejects.toThrow();
  }
  const {service,tx}=fixture('OFFERING',offer); await service.updateStage('c',{stage:'PENDING_ONBOARD'},actor); expect(tx.candidate.updateMany).toHaveBeenCalledTimes(2);
 });
 it('rejects wrong reason set and counts confirmed onboarding',async()=>{
  const a=fixture('PENDING_ONBOARD',offer);a.tx.reasonOption.findUnique.mockResolvedValue({id:'a',active:true,type:'ARCHIVE',label:'其他'});await expect(a.service.updateStage('c',{stage:'ARCHIVED',reasonId:'a'},actor)).rejects.toThrow();
  const b=fixture('PENDING_ONBOARD',offer);await b.service.updateStage('c',{stage:'ONBOARDED'},actor);expect(b.tx.job.update).toHaveBeenCalledWith({where:{id:'j'},data:{hiredCount:{increment:1}}});
 });
});
