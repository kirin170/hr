import { BadRequestException, Controller, Get, Post, Query, Body, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../auth/auth.decorators.js';
import {
  DingTalkCallbackCrypto,
  type DingTalkCallbackSignature,
} from './dingtalk-callback-crypto.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';

type CallbackQuery = Record<string, unknown>;

@Controller('api/v1/dingtalk/events')
@PublicRoute()
export class DingTalkCallbackController {
  constructor(
    private readonly crypto: DingTalkCallbackCrypto,
    private readonly sync: DingTalkSyncService,
  ) {}

  @Get()
  verifyUrl(@Query() query: CallbackQuery, @Res() response: Response) {
    const input = this.signatureInput(query, this.value(query.encrypt ?? query.Encrypt));
    if (!input || !this.crypto.verify(input)) {
      throw new UnauthorizedException('钉钉回调签名无效');
    }
    const challenge = this.crypto.decrypt(input.encrypted).message;
    response.setHeader('Cache-Control', 'no-store');
    return response.json(this.crypto.encryptReply(challenge, input.timestamp, input.nonce));
  }

  @Post()
  async receive(
    @Query() query: CallbackQuery,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const input = this.signatureInput(query, this.value(body?.encrypt ?? body?.Encrypt));
    if (!input || !this.crypto.verify(input)) {
      throw new UnauthorizedException('钉钉回调签名无效');
    }

    const message = this.crypto.decrypt(input.encrypted).message;
    if (message !== 'success') {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        throw new BadRequestException('钉钉事件内容不是有效 JSON');
      }
      await this.sync.acceptCallback(payload);
    }
    response.setHeader('Cache-Control', 'no-store');
    return response.json(this.crypto.encryptReply('success', input.timestamp, input.nonce));
  }

  private signatureInput(
    query: CallbackQuery,
    encrypted: string | undefined,
  ): DingTalkCallbackSignature | null {
    const signature = this.value(query.msg_signature ?? query.signature);
    const timestamp = this.value(query.timestamp ?? query.timeStamp);
    const nonce = this.value(query.nonce);
    if (!signature || !timestamp || !nonce || !encrypted) return null;
    return { signature, timestamp, nonce, encrypted };
  }

  private value(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }
}
