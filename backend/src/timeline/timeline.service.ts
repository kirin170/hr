import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TimelineInput {
  entityType: string;
  entityId: string;
  action: string;
  payload?: Prisma.InputJsonValue;
  actorId?: string | null;
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: TimelineInput): Promise<void> {
    await this.prisma.timelineEvent.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        payload: input.payload,
        actorId: input.actorId ?? null,
      },
    });
  }
}
