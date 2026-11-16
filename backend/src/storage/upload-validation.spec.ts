import { describe, expect, it } from 'vitest';
import {
  UPLOAD_ERROR,
  detectFileKind,
  normalizeMimeType,
  resumeMaxBytes,
  validateUpload,
  type UploadLimits,
} from './upload-validation.js';

const limits: UploadLimits = {
  maxBytes: 1024,
  allowedExtensions: new Set(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp']),
};

const pdf = (): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('body')]);
const docx = (): Buffer =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('docx-body')]);
const doc = (): Buffer =>
  Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from('doc-body'),
  ]);
const png = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('png-body'),
  ]);
const jpg = (): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg-body')]);
const webp = (): Buffer =>
  Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from('webp-body'),
  ]);

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('统一上传校验（NFR-11 / 技术设计 §8.1）', () => {
  it('接受扩展名、声明 MIME 与文件头一致的 PDF 与 Word', () => {
    expect(
      validateUpload(
        { fileName: '张三-简历.PDF', mimeType: 'application/pdf', buffer: pdf() },
        limits,
      ),
    ).toMatchObject({ ok: true, extension: '.pdf', kind: 'pdf', mimeType: 'application/pdf' });

    expect(
      validateUpload(
        { fileName: 'resume.docx', mimeType: DOCX_MIME, buffer: docx() },
        limits,
      ),
    ).toMatchObject({ ok: true, kind: 'docx', mimeType: DOCX_MIME });

    expect(
      validateUpload(
        { fileName: 'resume.doc', mimeType: 'application/msword', buffer: doc() },
        limits,
      ),
    ).toMatchObject({ ok: true, kind: 'doc' });
  });

  it('接受图片简历，并把 .jpeg 归一为 jpg', () => {
    expect(
      validateUpload(
        { fileName: 'resume.jpeg', mimeType: 'image/jpeg', buffer: jpg() },
        limits,
      ),
    ).toMatchObject({ ok: true, extension: '.jpeg', kind: 'jpg' });

    expect(
      validateUpload(
        { fileName: 'resume.png', mimeType: 'image/png', buffer: png() },
        limits,
      ),
    ).toMatchObject({ ok: true, kind: 'png' });

    expect(
      validateUpload(
        { fileName: 'resume.webp', mimeType: 'image/webp', buffer: webp() },
        limits,
      ),
    ).toMatchObject({ ok: true, kind: 'webp' });
  });

  it('拒绝空文件与超过大小上限的文件', () => {
    expect(
      validateUpload({ fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }, limits),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.EMPTY_FILE });

    const oversize = Buffer.concat([pdf(), Buffer.alloc(1024)]);
    expect(
      validateUpload(
        { fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: oversize },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.FILE_TOO_LARGE });
  });

  it('拒绝未在允许清单内的扩展名', () => {
    expect(
      validateUpload(
        { fileName: 'resume.exe', mimeType: 'application/octet-stream', buffer: pdf() },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.UNSUPPORTED_FORMAT });
    expect(
      validateUpload(
        { fileName: 'resume', mimeType: 'application/pdf', buffer: pdf() },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.UNSUPPORTED_FORMAT });
  });

  it('拒绝扩展名与声明 MIME 不一致', () => {
    expect(
      validateUpload(
        { fileName: 'resume.pdf', mimeType: 'image/png', buffer: pdf() },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.MIME_MISMATCH });
  });

  it('拒绝扩展名与实际文件内容不一致，不信任浏览器声明', () => {
    expect(
      validateUpload(
        { fileName: 'resume.png', mimeType: 'image/png', buffer: pdf() },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.CONTENT_MISMATCH });

    expect(
      validateUpload(
        { fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not-a-pdf') },
        limits,
      ),
    ).toMatchObject({ ok: false, code: UPLOAD_ERROR.CONTENT_MISMATCH });
  });

  it('按配置解析大小上限与 MIME 归一化', () => {
    expect(resumeMaxBytes({ RESUME_MAX_MB: '5' })).toBe(5 * 1024 * 1024);
    expect(resumeMaxBytes({ RESUME_MAX_MB: 'abc' })).toBe(20 * 1024 * 1024);
    expect(resumeMaxBytes({})).toBe(20 * 1024 * 1024);
    expect(normalizeMimeType('Application/PDF; charset=binary')).toBe('application/pdf');
    expect(normalizeMimeType(undefined)).toBe('application/octet-stream');
  });

  it('文件头识别覆盖允许的类型', () => {
    expect(detectFileKind(pdf())).toBe('pdf');
    expect(detectFileKind(docx())).toBe('docx');
    expect(detectFileKind(doc())).toBe('doc');
    expect(detectFileKind(png())).toBe('png');
    expect(detectFileKind(jpg())).toBe('jpg');
    expect(detectFileKind(webp())).toBe('webp');
    expect(detectFileKind(Buffer.from('plain text'))).toBeNull();
  });
});
