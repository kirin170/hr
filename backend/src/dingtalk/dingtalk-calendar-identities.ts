import { Injectable } from '@nestjs/common';
import { IdentityProvider, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkCalendarError } from './dingtalk-calendar.client.js';

/** Calendar APIs require unionId; existing directory identity links hold DingTalk userId. */
@Injectable()
export class DingTalkCalendarIdentities {
  constructor(private readonly db: PrismaService, private readonly api: DingTalkApiClient) {}

  async resolve(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (!unique.length || unique.some(id => !id)) throw new DingTalkCalendarError('invalid_identity', false);
    const links = await this.db.identityLink.findMany({
      where: { provider: IdentityProvider.DINGTALK, userId: { in: unique }, user: { status: UserStatus.ACTIVE } },
      select: { userId: true, subject: true },
    });
    if (links.length !== unique.length) throw new DingTalkCalendarError('identity_not_mapped', false);
    const resolved = new Map<string, string>();
    const seen = new Set<string>();
    for (const link of links) {
      const directoryUser = await this.api.getUser(link.subject);
      if (directoryUser.userid !== link.subject || !directoryUser.unionid || seen.has(directoryUser.unionid)) {
        throw new DingTalkCalendarError('invalid_directory_identity', false);
      }
      seen.add(directoryUser.unionid);
      resolved.set(link.userId, directoryUser.unionid);
    }
    return resolved;
  }
}
