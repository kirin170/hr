import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { StorageService } from '../storage/storage.service.js';
import type { ResumeContent } from './ai.types.js';
import { AI_ERROR_CODES, AiProviderError } from './model-provider.js';

export interface ResumeFileRef {
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  size: number;
}

const MAX_TEXT_CHARS = 60_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

/**
 * 简历内容装载：PDF/Word 抽取纯文本，图片按多模态直读。
 *
 * 这是轻量实现，不引入额外依赖：支持 DOCX（zip + document.xml）、
 * 常规文本型 PDF（FlateDecode 内容流），不支持的格式明确抛
 * AI_CONTENT_UNSUPPORTED 并降级人工，不伪造解析结果。
 */
@Injectable()
export class ResumeContentLoader {
  constructor(private readonly storage: StorageService) {}

  async load(file: ResumeFileRef): Promise<ResumeContent> {
    const buffer = await this.storage.readObject(file.storageKey);
    const mime = (file.mimeType ?? '').toLowerCase();
    const extension = file.fileName.toLowerCase().split('.').pop() ?? '';
    const textHash = createHash('sha256').update(buffer).digest('hex');
    const base = { mimeType: mime || `application/${extension}`, sourceRef: `resume:${file.fileName}`, textHash };

    if (IMAGE_MIME.has(mime) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
      if (buffer.length > MAX_IMAGE_BYTES) {
        throw new AiProviderError(
          AI_ERROR_CODES.CONTENT_UNSUPPORTED,
          `图片简历超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，无法直读，请人工处理`,
          { retryable: false },
        );
      }
      const imageMime = mime.startsWith('image/') ? mime : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
      return {
        ...base,
        mimeType: imageMime,
        text: null,
        imageDataUrl: `data:${imageMime};base64,${buffer.toString('base64')}`,
        truncated: false,
      };
    }

    let text: string;
    if (mime.startsWith('text/') || ['txt', 'md', 'csv'].includes(extension)) {
      text = buffer.toString('utf8');
    } else if (extension === 'docx' || mime.includes('officedocument.wordprocessingml')) {
      text = extractDocxText(buffer);
    } else if (extension === 'pdf' || mime === 'application/pdf') {
      text = extractPdfText(buffer);
    } else {
      throw new AiProviderError(
        AI_ERROR_CODES.CONTENT_UNSUPPORTED,
        `暂不支持 ${extension || mime || '未知'} 格式的简历文本抽取（支持 PDF/DOCX/文本/图片），请人工处理`,
        { retryable: false },
      );
    }

    const normalized = text
      .split('\u0000')
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    if (normalized.length < 20) {
      throw new AiProviderError(
        AI_ERROR_CODES.CONTENT_UNSUPPORTED,
        '未能从简历中提取到可用文本（可能是扫描件或加密文件），请人工处理',
        { retryable: false },
      );
    }

    const truncated = normalized.length > MAX_TEXT_CHARS;
    return {
      ...base,
      text: truncated ? normalized.slice(0, MAX_TEXT_CHARS) : normalized,
      imageDataUrl: null,
      truncated,
    };
  }
}

/** 从 DOCX（zip）中读取 word/document.xml 并转纯文本。 */
export function extractDocxText(buffer: Buffer): string {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new AiProviderError(AI_ERROR_CODES.CONTENT_UNSUPPORTED, 'DOCX 缺少正文内容', { retryable: false });
  return decodeXmlText(xml.toString('utf8'));
}

const MAX_INFLATE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 120_000;

function safeFromCodePoint(codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return '';
  }
  return String.fromCodePoint(codePoint);
}

function decodeXmlText(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

/** 读取 zip 指定条目（支持 store/deflate），找不到返回 null。 */
export function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return null;
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (localOffset + 30 > buffer.length) return null;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return data.length <= MAX_INFLATE_BYTES ? data : null;
    if (method === 8) {
      try {
        return inflateRawSync(data, { maxOutputLength: MAX_INFLATE_BYTES });
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }
  return -1;
}

/** 从 PDF 内容流抽取文本（仅支持未加密、非 CID 字体的常规文本型 PDF）。 */
export function extractPdfText(buffer: Buffer): string {
  const chunks: string[] = [];
  let totalChars = 0;
  let cursor = 0;
  while (cursor < buffer.length && totalChars < MAX_PDF_TEXT_CHARS) {
    const streamIndex = buffer.indexOf('stream', cursor);
    if (streamIndex === -1) break;
    let dataStart = streamIndex + 6;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const endIndex = buffer.indexOf('endstream', dataStart);
    if (endIndex === -1) break;
    let data = buffer.subarray(dataStart, endIndex);
    const dictionary = buffer.toString('latin1', Math.max(0, streamIndex - 500), streamIndex);
    if (dictionary.includes('/FlateDecode')) {
      try {
        data = inflateSync(data, { maxOutputLength: MAX_INFLATE_BYTES });
      } catch {
        try {
          data = inflateRawSync(data, { maxOutputLength: MAX_INFLATE_BYTES });
        } catch {
          cursor = endIndex + 9;
          continue;
        }
      }
    }
    const text = decodePdfContentStream(data.toString('latin1'));
    if (text.trim()) {
      const remaining = MAX_PDF_TEXT_CHARS - totalChars;
      const clipped = text.length > remaining ? text.slice(0, remaining) : text;
      chunks.push(clipped);
      totalChars += clipped.length;
    }
    cursor = endIndex + 9;
  }
  return chunks.join('\n');
}

function decodePdfContentStream(content: string): string {
  const tokenPattern = /\((?:\\[\s\S]|[^()\\])*\)|<[0-9A-Fa-f\s]+>|\b(?:Tj|TJ|Td|TD|T\*|ET)\b/g;
  let output = '';
  let pending = '';
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(content)) !== null) {
    const token = match[0];
    if (token.startsWith('(')) {
      pending += decodePdfLiteral(token.slice(1, -1));
    } else if (token.startsWith('<')) {
      pending += decodePdfHex(token.slice(1, -1));
    } else if (token === 'Tj' || token === 'TJ') {
      output += pending;
      pending = '';
    } else {
      output += `${pending}\n`;
      pending = '';
    }
  }
  if (pending) output += pending;
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function decodePdfLiteral(value: string): string {
  const unescaped = value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escape: string) => {
    switch (escape) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '(':
        return '(';
      case ')':
        return ')';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(escape, 8));
    }
  });

  // 部分工具导出的 PDF 直接以 UTF-8 写入字面量字符串；能按 UTF-8 解通就按 UTF-8，
  // 否则回落到逐字节（WinAnsi/PDFDocEncoding）解释。
  const bytes = Buffer.from(unescaped, 'latin1');
  if (bytes.some((byte) => byte > 0x7f)) {
    const utf8 = bytes.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;
  }
  return unescaped;
}

function decodePdfHex(value: string): string {
  const hex = value.replace(/\s+/g, '');
  if (!hex) return '';
  const bytes = Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('utf8');
}
