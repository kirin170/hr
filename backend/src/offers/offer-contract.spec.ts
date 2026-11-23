import { describe, expect, it } from 'vitest';
import { canEnterPendingOnboard, failureReasonType, nextOfferStage, OFFER_STAGES, validateFailureReason } from './offer-contract.js';

describe('Offer contract (PRD §4.2)', () => {
  it('requires explicit acceptance and advances one stage only', () => {
    for (let i = 0; i < OFFER_STAGES.length - 1; i++) {
      expect(nextOfferStage({ stage: OFFER_STAGES[i], status: 'ACCEPTED' })).toEqual({ stage: OFFER_STAGES[i + 1], status: 'PENDING' });
      expect(() => nextOfferStage({ stage: OFFER_STAGES[i], status: 'PENDING' })).toThrow();
      expect(() => nextOfferStage({ stage: OFFER_STAGES[i], status: 'NOT_PASSED' })).toThrow();
    }
    expect(() => nextOfferStage({ stage: 'WRITTEN_OFFER', status: 'ACCEPTED' })).toThrow();
  });
  it('separates company failures from candidate refusals', () => {
    for (const stage of OFFER_STAGES) expect(failureReasonType(stage, 'COMPANY')).toBe('ARCHIVE');
    expect(failureReasonType('ORAL_OFFER', 'CANDIDATE')).toBe('OFFER_REJECT');
    expect(failureReasonType('WRITTEN_OFFER', 'CANDIDATE')).toBe('OFFER_REJECT');
    expect(() => failureReasonType('OA_APPROVAL', 'CANDIDATE')).toThrow();
    expect(() => failureReasonType('BACKGROUND_APPROVAL', 'CANDIDATE')).toThrow();
  });
  it('requires an active option from the correct set and explanation for other', () => {
    const option = { id: '1', type: 'ARCHIVE', label: '其他·可填写', active: true };
    expect(() => validateFailureReason('OA_APPROVAL', 'COMPANY', option, '  ')).toThrow();
    expect(() => validateFailureReason('OA_APPROVAL', 'CANDIDATE', option, '说明')).toThrow();
    expect(() => validateFailureReason('ORAL_OFFER', 'CANDIDATE', option, '说明')).toThrow();
    expect(() => validateFailureReason('OA_APPROVAL', 'COMPANY', { ...option, active: false }, '说明')).toThrow();
    expect(validateFailureReason('OA_APPROVAL', 'COMPANY', option, '  说明  ')).toEqual({ reasonType: 'ARCHIVE', reasonId: '1', reasonText: '说明' });
  });
  it('requires accepted written offer, send time and start date independently', () => {
    const date = new Date('2026-12-01T00:00:00Z');
    const state = { stage: 'WRITTEN_OFFER' as const, status: 'ACCEPTED' as const };
    expect(canEnterPendingOnboard(state, date, date)).toBe(true);
    expect(canEnterPendingOnboard(state, null, date)).toBe(false);
    expect(canEnterPendingOnboard(state, date, null)).toBe(false);
    expect(canEnterPendingOnboard({ ...state, status: 'PENDING' }, date, date)).toBe(false);
    expect(canEnterPendingOnboard({ stage: 'BACKGROUND_APPROVAL', status: 'ACCEPTED' }, date, date)).toBe(false);
  });
});
