import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  EXCEL_COLUMNS,
  EXCEL_ERROR,
  EXCEL_TEMPLATE_SHEET,
  buildExcelTemplate,
  buildFailedRowsWorkbook,
  parseExcelRows,
  validateExcelRow,
} from './intake-excel.js';

async function workbookBuffer(
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('简历导入');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from((await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

const headers = EXCEL_COLUMNS.map((column) => column.header);

describe('Excel 批量导入解析与行校验', () => {
  it('按中文表头解析数据行并跳过空行', async () => {
    const buffer = await workbookBuffer(headers, [
      ['张三', '13800000001', 'zhangsan@example.com', 'MJ000001', 'CAMPUS', '内推人A', 'REF-001', '内推'],
      ['', '', '', '', '', '', '', ''],
      ['李四', '', 'lisi@example.com', '', '', '', '', ''],
    ]);

    const rows = await parseExcelRows(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      values: {
        name: '张三',
        phone: '13800000001',
        email: 'zhangsan@example.com',
        jobCode: 'MJ000001',
        source: 'CAMPUS',
        referrerName: '内推人A',
        referralCode: 'REF-001',
        note: '内推',
      },
    });
    expect(rows[1].rowNumber).toBe(4);
  });

  it('支持英文 key 表头', async () => {
    const buffer = await workbookBuffer(
      ['name', 'phone', 'email'],
      [['王五', '13800000002', 'ww@example.com']],
    );

    const rows = await parseExcelRows(buffer);

    expect(rows[0].values.name).toBe('王五');
  });

  it('模板只有表头与填写说明，不会被误导入', async () => {
    const buffer = await buildExcelTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets[0].name).toBe(EXCEL_TEMPLATE_SHEET);
    expect(workbook.worksheets).toHaveLength(2);
    await expect(parseExcelRows(buffer)).resolves.toHaveLength(0);
  });

  it('校验必填、手机号、邮箱与来源枚举', () => {
    const ok = validateExcelRow({
      rowNumber: 2,
      values: { name: ' 张三 ', phone: '138-0000-0001', email: 'a@b.com' },
    });
    expect(ok).toEqual({
      ok: true,
      value: {
        name: '张三',
        phone: '13800000001',
        email: 'a@b.com',
        jobCode: null,
        source: 'UPLOAD',
        referrerName: null,
        referralCode: null,
        note: null,
      },
    });

    expect(validateExcelRow({ rowNumber: 3, values: { name: '  ' } })).toMatchObject({
      ok: false,
      code: EXCEL_ERROR.NAME_REQUIRED,
    });
    expect(
      validateExcelRow({ rowNumber: 4, values: { name: '李四', phone: 'abc' } }),
    ).toMatchObject({ ok: false, code: EXCEL_ERROR.INVALID_PHONE });
    expect(
      validateExcelRow({ rowNumber: 5, values: { name: '李四', email: 'not-an-email' } }),
    ).toMatchObject({ ok: false, code: EXCEL_ERROR.INVALID_EMAIL });
    expect(
      validateExcelRow({ rowNumber: 6, values: { name: '李四', source: 'UNKNOWN' } }),
    ).toMatchObject({ ok: false, code: EXCEL_ERROR.INVALID_SOURCE });
  });

  it('失败行导出保留模板列并追加错误码与原因', async () => {
    const buffer = await buildFailedRowsWorkbook([
      {
        rowNumber: 7,
        name: '李四',
        phone: 'abc',
        jobCode: 'MJ000009',
        source: 'UPLOAD',
        errorCode: EXCEL_ERROR.INVALID_PHONE,
        errorMessage: '手机号格式不正确：abc',
      },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    const headerRow = sheet.getRow(1).values as (string | undefined)[];

    expect(headerRow).toContain('错误码');
    expect(headerRow).toContain('失败原因');
    expect(sheet.getRow(2).getCell(1).value).toBe('李四');
    expect(sheet.getRow(2).getCell(9).value).toBe(EXCEL_ERROR.INVALID_PHONE);

    // 导出文件可再次按模板列解析，便于修正后重新导入
    const rows = await parseExcelRows(buffer);
    expect(rows[0].values).toMatchObject({ name: '李四', jobCode: 'MJ000009' });
  });
});
