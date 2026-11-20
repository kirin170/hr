import { extname } from 'node:path';
import { simpleParser } from 'mailparser';
import {
  EMAIL_EXCEL_EXTENSIONS,
  EMAIL_RESUME_EXTENSIONS,
  EMAIL_WRAPPER_EXTENSIONS,
  EMAIL_WRAPPER_MAX_DEPTH,
} from './mail.constants.js';

export type MailAttachmentInput = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type ClassifiedMailAttachments = {
  /** PDF / Word / 图片：走统一 AI 解析 */
  resume: MailAttachmentInput[];
  /** Excel / CSV：独立表格导入，不进 AI 解析 */
  excel: MailAttachmentInput[];
  /** 本期不支持的格式 */
  unsupported: MailAttachmentInput[];
};

/**
 * 附件分流（FR-ENT-1 / 功能需求 §3.1）：
 * PDF/Word/图片 → AI 解析；Excel → 独立表格导入；.eml 先解包再分流。
 */
export async function classifyMailAttachments(
  attachments: MailAttachmentInput[],
  depth = 0,
): Promise<ClassifiedMailAttachments> {
  const result: ClassifiedMailAttachments = { resume: [], excel: [], unsupported: [] };

  for (const attachment of attachments) {
    const extension = extname(attachment.fileName ?? '').toLowerCase();

    if (EMAIL_WRAPPER_EXTENSIONS.has(extension)) {
      if (depth >= EMAIL_WRAPPER_MAX_DEPTH) {
        result.unsupported.push(attachment);
        continue;
      }
      const nested = await unwrapEml(attachment);
      if (!nested) {
        result.unsupported.push(attachment);
        continue;
      }
      const inner = await classifyMailAttachments(nested, depth + 1);
      result.resume.push(...inner.resume);
      result.excel.push(...inner.excel);
      result.unsupported.push(...inner.unsupported);
      continue;
    }

    if (EMAIL_RESUME_EXTENSIONS.has(extension)) {
      result.resume.push(attachment);
      continue;
    }
    if (EMAIL_EXCEL_EXTENSIONS.has(extension)) {
      result.excel.push(attachment);
      continue;
    }
    result.unsupported.push(attachment);
  }

  return result;
}

/** 解包嵌套邮件：BOSS/猎聘等渠道常把简历包成 .eml 附件投递 */
async function unwrapEml(attachment: MailAttachmentInput): Promise<MailAttachmentInput[] | null> {
  try {
    const parsed = await simpleParser(attachment.buffer);
    const nested = parsed.attachments
      .filter((item) => item.content && item.filename)
      .map((item) => ({
        fileName: item.filename ?? 'attachment',
        mimeType: item.contentType ?? 'application/octet-stream',
        buffer: item.content,
      }));
    // 解包后没有任何可用附件时按“不支持”归因，避免邮件被静默丢弃
    return nested.length ? nested : null;
  } catch {
    return null;
  }
}
