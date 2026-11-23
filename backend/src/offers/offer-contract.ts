import { BadRequestException, ConflictException } from '@nestjs/common';

/** PRD §4.2：阶段推进是独立的人工动作。 */
export const OFFER_STAGES = [
  'APPROVAL_MATERIALS', 'OA_APPROVAL', 'ORAL_OFFER',
  'BACKGROUND_MATERIALS', 'BACKGROUND_APPROVAL', 'WRITTEN_OFFER',
] as const;
export type OfferStage = typeof OFFER_STAGES[number];
export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'NOT_PASSED';
export type FailureInitiator = 'COMPANY' | 'CANDIDATE';
export type OfferReasonType = 'ARCHIVE' | 'OFFER_REJECT';

export interface OfferState { stage: OfferStage; status: OfferStatus }
export interface ReasonOption { id: string; type: string; label: string; active: boolean }

export function nextOfferStage(state: OfferState): OfferState {
  const index = OFFER_STAGES.indexOf(state.stage);
  if (index < 0 || state.status !== 'ACCEPTED' || index === OFFER_STAGES.length - 1) {
    throw new ConflictException('只有已接受的非最终阶段可以显式推进');
  }
  return { stage: OFFER_STAGES[index + 1], status: 'PENDING' };
}

export function failureReasonType(stage: OfferStage, initiator: FailureInitiator): OfferReasonType {
  if (!OFFER_STAGES.includes(stage) || !['COMPANY', 'CANDIDATE'].includes(initiator)) {
    throw new BadRequestException('失败阶段或发起方无效');
  }
  if (initiator === 'CANDIDATE') {
    if (stage !== 'ORAL_OFFER' && stage !== 'WRITTEN_OFFER') {
      throw new BadRequestException('候选人拒绝仅适用于口头或书面 Offer');
    }
    return 'OFFER_REJECT';
  }
  return 'ARCHIVE';
}

export function validateFailureReason(stage: OfferStage, initiator: FailureInitiator,
  option: ReasonOption | null, text: unknown): { reasonType: OfferReasonType; reasonId: string; reasonText: string | null } {
  const reasonType = failureReasonType(stage, initiator);
  if (!option || !option.active || option.type !== reasonType || !option.id) {
    throw new BadRequestException('请选择对应原因集中的有效原因');
  }
  if (text != null && typeof text !== 'string') throw new BadRequestException('原因说明无效');
  const reasonText = typeof text === 'string' ? text.trim() || null : null;
  if (option.label.startsWith('其他') && !reasonText) throw new BadRequestException('其他原因必须填写说明');
  return { reasonType, reasonId: option.id, reasonText };
}

export function canEnterPendingOnboard(state: OfferState, sentAt: Date | null, onboardDate: Date | null): boolean {
  return state.stage === 'WRITTEN_OFFER' && state.status === 'ACCEPTED' &&
    !!sentAt && Number.isFinite(sentAt.getTime()) && !!onboardDate && Number.isFinite(onboardDate.getTime());
}
