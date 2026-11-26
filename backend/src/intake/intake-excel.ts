import ExcelJS from 'exceljs';
import { ALLOWED_SOURCES, ENTRY_MODE, INTAKE_SOURCE } from './intake.constants.js';

/** Excel 批量导入列定义：与模板、解析、失败导出共用一份，避免口径漂移（FR-ENT-8） */
export const EXCEL_COLUMNS = [
  { key: 'name', header: '姓名', width: 16, required: true, hint: '必填，候选人姓名' },
  { key: 'phone', header: '手机号', width: 18, required: false, hint: '选填，6～20 位数字，可带 + 前缀' },
  { key: 'email', header: '邮箱', width: 26, required: false, hint: '选填，用于查重与联系' },
  {
    key: 'jobCode',
    header: '职位编号',
    width: 16,
    required: false,
    hint: '选填，如 MJ000001；填写后直接进入该职位「人才推荐」，留空进待分配池',
  },
  {
    key: 'source',
    header: '简历来源',
    width: 14,
    required: false,
    hint: `选填，默认 ${INTAKE_SOURCE.UPLOAD}；可选 ${[...ALLOWED_SOURCES].join(' / ')}`,
  },
  {
    key: 'referrerName',
    header: '推荐人',
    width: 16,
    required: false,
    hint: '选填，内推人姓名或员工标识；写入来源记录并可查询筛选',
  },
  {
    key: 'referralCode',
    header: '来源标识',
    width: 16,
    required: false,
    hint: '选填，内推码或渠道活动标识；写入来源记录并可查询筛选',
  },
  { key: 'note', header: '备注', width: 30, required: false, hint: '选填，进入候选人备注' },
] as const;

export type ExcelColumnKey = (typeof EXCEL_COLUMNS)[number]['key'];

/** Excel 独立导入的进入方式，明确不进入 AI 解析管道（PRD §6.4） */
export const EXCEL_ENTRY_MODE = ENTRY_MODE.EXCEL_IMPORT;

export const EXCEL_TEMPLATE_SHEET = '简历导入';
export const EXCEL_GUIDE_SHEET = '填写说明';

export interface ExcelRawRow {
  rowNumber: number;
  values: Partial<Record<ExcelColumnKey, string>>;
}

export interface ExcelRowValue {
  name: string;
  phone: string | null;
  email: string | null;
  jobCode: string | null;
  source: string;
  referrerName: string | null;
  referralCode: string | null;
  note: string | null;
}

export type ExcelRowValidation =
  | { ok: true; value: ExcelRowValue }
  | { ok: false; code: string; message: string };

export const EXCEL_ERROR = {
  EMPTY_WORKBOOK: 'EMPTY_WORKBOOK',
  UNSUPPORTED_EXCEL_FORMAT: 'UNSUPPORTED_EXCEL_FORMAT',
  NO_ROWS: 'NO_ROWS',
  TOO_MANY_ROWS: 'TOO_MANY_ROWS',
  NAME_REQUIRED: 'NAME_REQUIRED',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  INVALID_PHONE: 'INVALID_PHONE',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_SOURCE: 'INVALID_SOURCE',
  REFERRER_TOO_LONG: 'REFERRER_TOO_LONG',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  CONTACT_REQUIRED: 'CONTACT_REQUIRED',
} as const;

/** 单批次行数上限：避免超大文件一次性占用内存，超出即拒绝并提示拆分 */
export const EXCEL_MAX_ROWS = 500;

const PHONE_PATTERN = /^\+?\d{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as { text?: unknown; result?: unknown; hyperlink?: unknown };
    if (typeof rich.text === 'string') return rich.text.trim();
    if (typeof rich.result === 'string' || typeof rich.result === 'number') {
      return String(rich.result).trim();
    }
    if (typeof rich.hyperlink === 'string') return rich.hyperlink.trim();
  }
  return '';
}

function headerMap(worksheet: ExcelJS.Worksheet): Map<number, ExcelColumnKey> {
  const map = new Map<number, ExcelColumnKey>();
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell.value).toLowerCase();
    if (!text) return;
    const column = EXCEL_COLUMNS.find(
      (item) => item.header === text || item.key.toLowerCase() === text,
    );
    if (column) map.set(colNumber, column.key);
  });
  return map;
}

/** 读取首个工作表的有效数据行；表头按中文列名或英文 key 识别 */
export async function parseExcelRows(buffer: Buffer): Promise<ExcelRawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ExcelImportError(EXCEL_ERROR.EMPTY_WORKBOOK, 'Excel 中没有可读取的工作表');
  }

  const columns = headerMap(worksheet);
  if (columns.size === 0) {
    throw new ExcelImportError(
      EXCEL_ERROR.EMPTY_WORKBOOK,
      '未识别到表头，请使用下载的 Excel 模板',
    );
  }

  const rows: ExcelRawRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Partial<Record<ExcelColumnKey, string>> = {};
    let filled = false;
    columns.forEach((key, colNumber) => {
      const text = cellText(row.getCell(colNumber).value);
      if (text) filled = true;
      values[key] = text;
    });
    if (filled) rows.push({ rowNumber, values });
  });
  return rows;
}

/** 行级校验：姓名必填，联系方式格式与来源枚举在此收敛，职位存在性由服务层校验 */
export function validateExcelRow(row: ExcelRawRow): ExcelRowValidation {
  const name = (row.values.name ?? '').trim();
  if (!name) {
    return { ok: false, code: EXCEL_ERROR.NAME_REQUIRED, message: '姓名必填' };
  }
  if (name.length > 50) {
    return { ok: false, code: EXCEL_ERROR.NAME_TOO_LONG, message: '姓名超过 50 个字符' };
  }

  const phoneRaw = (row.values.phone ?? '').replace(/[\s-]/g, '');
  if (phoneRaw && !PHONE_PATTERN.test(phoneRaw)) {
    return {
      ok: false,
      code: EXCEL_ERROR.INVALID_PHONE,
      message: `手机号格式不正确：${row.values.phone}`,
    };
  }

  const email = (row.values.email ?? '').trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    return {
      ok: false,
      code: EXCEL_ERROR.INVALID_EMAIL,
      message: `邮箱格式不正确：${email}`,
    };
  }

  const source = (row.values.source ?? '').trim().toUpperCase() || INTAKE_SOURCE.UPLOAD;
  if (!ALLOWED_SOURCES.has(source)) {
    return {
      ok: false,
      code: EXCEL_ERROR.INVALID_SOURCE,
      message: `简历来源不支持：${row.values.source}，可选 ${[...ALLOWED_SOURCES].join(' / ')}`,
    };
  }

  const referrerName = (row.values.referrerName ?? '').trim();
  const referralCode = (row.values.referralCode ?? '').trim();
  if (referrerName.length > 50 || referralCode.length > 50) {
    return {
      ok: false,
      code: EXCEL_ERROR.REFERRER_TOO_LONG,
      message: '推荐人或来源标识超过 50 个字符',
    };
  }

  return {
    ok: true,
    value: {
      name,
      phone: phoneRaw || null,
      email: email || null,
      jobCode: (row.values.jobCode ?? '').trim() || null,
      source,
      referrerName: referrerName || null,
      referralCode: referralCode || null,
      note: (row.values.note ?? '').trim() || null,
    },
  };
}

export class ExcelImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExcelImportError';
  }
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as unknown as ArrayBuffer);
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2FF' } };
    cell.alignment = { vertical: 'middle' };
  });
}

/** 模板下载：仅表头 + 填写说明，示例数据放在说明页，避免被误导入 */
export async function buildExcelTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(EXCEL_TEMPLATE_SHEET);
  sheet.columns = EXCEL_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const guide = workbook.addWorksheet(EXCEL_GUIDE_SHEET);
  guide.columns = [
    { header: '列名', key: 'header', width: 14 },
    { header: '是否必填', key: 'required', width: 12 },
    { header: '填写说明', key: 'hint', width: 62 },
  ];
  styleHeader(guide.getRow(1));
  for (const column of EXCEL_COLUMNS) {
    guide.addRow({
      header: column.header,
      required: column.required ? '必填' : '选填',
      hint: column.hint,
    });
  }
  guide.addRow({});
  guide.addRow({
    header: '规则',
    required: '',
    hint: `单个文件最多 ${EXCEL_MAX_ROWS} 行；Excel 走独立表格导入，不进入 AI 解析管道；手机号或邮箱命中已有候选人时按查重跳过并保留来源。`,
  });
  return toBuffer(workbook);
}

export interface FailedRowExport {
  rowNumber: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  jobCode?: string | null;
  source?: string | null;
  referrerName?: string | null;
  referralCode?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** 防止导出 Excel 被注入公式（= + - @ \t \r 开头时前置单引号中和）。 */
function neutralizeFormulaCell(value: string | null | undefined): string {
  const text = value ?? '';
  if (!text) return '';
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** 失败行导出：与模板列一致，追加错误码与失败原因，便于修正后重新导入 */
export async function buildFailedRowsWorkbook(rows: FailedRowExport[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('失败行');
  sheet.columns = [
    ...EXCEL_COLUMNS.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width,
    })),
    { header: '错误码', key: 'errorCode', width: 20 },
    { header: '失败原因', key: 'errorMessage', width: 46 },
    { header: '原行号', key: 'rowNumber', width: 10 },
  ];
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) {
    sheet.addRow({
      name: neutralizeFormulaCell(row.name),
      phone: neutralizeFormulaCell(row.phone),
      email: neutralizeFormulaCell(row.email),
      jobCode: neutralizeFormulaCell(row.jobCode),
      source: neutralizeFormulaCell(row.source),
      referrerName: neutralizeFormulaCell(row.referrerName),
      referralCode: neutralizeFormulaCell(row.referralCode),
      note: '',
      errorCode: neutralizeFormulaCell(row.errorCode),
      errorMessage: neutralizeFormulaCell(row.errorMessage),
      rowNumber: row.rowNumber,
    });
  }
  return toBuffer(workbook);
}
