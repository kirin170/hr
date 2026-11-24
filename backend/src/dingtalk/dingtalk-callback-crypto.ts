import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export type DingTalkCallbackSignature = {
  timestamp: string;
  nonce: string;
  encrypted: string;
  signature: string;
};

export type DingTalkEncryptedReply = {
  msg_signature: string;
  timeStamp: string;
  nonce: string;
  encrypt: string;
};

export class DingTalkCallbackCrypto {
  verify(input: DingTalkCallbackSignature): boolean {
    const config = this.configuration();
    if (
      !input.timestamp ||
      !input.nonce ||
      !input.encrypted ||
      !/^[a-f0-9]{40}$/i.test(input.signature)
    ) {
      return false;
    }
    const expected = createHash('sha1')
      .update([config.token, input.timestamp, input.nonce, input.encrypted].sort().join(''))
      .digest('hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    const suppliedBytes = Buffer.from(input.signature, 'hex');
    return (
      expectedBytes.length === suppliedBytes.length &&
      timingSafeEqual(expectedBytes, suppliedBytes)
    );
  }

  decrypt(encrypted: string): { message: string; ownerKey: string } {
    const { key, ownerKey } = this.configuration();
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
      decipher.setAutoPadding(false);
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]);
    } catch {
      throw new BadRequestException('钉钉回调密文无效');
    }

    const unpadded = this.unpad(plaintext);
    if (unpadded.length < 20) throw new BadRequestException('钉钉回调明文无效');
    const messageLength = unpadded.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    if (messageEnd > unpadded.length) throw new BadRequestException('钉钉回调明文长度无效');
    const message = unpadded.subarray(messageStart, messageEnd).toString('utf8');
    const actualOwnerKey = unpadded.subarray(messageEnd).toString('utf8');
    if (actualOwnerKey !== ownerKey) throw new BadRequestException('钉钉回调应用标识不匹配');
    return { message, ownerKey: actualOwnerKey };
  }

  encryptReply(message: string, timestamp: string, nonce: string): DingTalkEncryptedReply {
    const { key, ownerKey, token } = this.configuration();
    const messageBytes = Buffer.from(message, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(messageBytes.length);
    const randomPrefix = randomBytes(16);
    const content = this.pad(Buffer.concat([
      randomPrefix,
      length,
      messageBytes,
      Buffer.from(ownerKey, 'utf8'),
    ]));
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(content), cipher.final()]).toString('base64');
    const signature = createHash('sha1')
      .update([token, timestamp, nonce, encrypted].sort().join(''))
      .digest('hex');
    return {
      msg_signature: signature,
      timeStamp: timestamp,
      nonce,
      encrypt: encrypted,
    };
  }

  private configuration() {
    const token = process.env.DINGTALK_CALLBACK_TOKEN;
    const encodedKey = process.env.DINGTALK_CALLBACK_AES_KEY;
    // .env 里留空键是常见写法，空字符串要回退到应用标识，否则回调会被判为未配置。
    const ownerKey = process.env.DINGTALK_CALLBACK_OWNER_KEY || process.env.DINGTALK_CLIENT_ID;
    if (!token || !encodedKey || !ownerKey) {
      throw new ServiceUnavailableException('钉钉事件回调尚未配置');
    }
    const key = Buffer.from(`${encodedKey}=`, 'base64');
    if (key.length !== 32) {
      throw new ServiceUnavailableException('钉钉回调 AES 密钥配置无效');
    }
    return { token, key, ownerKey };
  }

  private pad(input: Buffer): Buffer {
    const padLength = 32 - (input.length % 32);
    return Buffer.concat([input, Buffer.alloc(padLength, padLength)]);
  }

  private unpad(input: Buffer): Buffer {
    const padLength = input.at(-1);
    if (!padLength || padLength > 32 || input.length < padLength) {
      throw new BadRequestException('钉钉回调填充无效');
    }
    for (const byte of input.subarray(input.length - padLength)) {
      if (byte !== padLength) throw new BadRequestException('钉钉回调填充无效');
    }
    return input.subarray(0, input.length - padLength);
  }
}
