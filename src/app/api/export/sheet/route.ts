import { google, type sheets_v4 } from "googleapis";
import { fail, ok, requireOwner } from "@/lib/api";
import { cleanBook, isUrl, sheetNames, type Cell } from "@/lib/export";
import { googleAuth } from "@/lib/google";

// ส่งออกเป็น Google Sheet (หน้าเจ้าของ: สรุปรายเดือน / สถิติไลฟ์) เฉพาะ Owner
//   POST { title, sheets: [{ name, rows, header }] } -> สร้างไฟล์ใหม่ในไดรฟ์ของบัญชีระบบ
//   แชร์สิทธิ์แก้ไขให้อีเมลของคนที่กด (ไม่ส่งอีเมลแจ้ง) แล้วคืนลิงก์ { url }

const NUMBER_FORMAT = {
  int: { type: "NUMBER", pattern: "#,##0" },
  money: { type: "NUMBER", pattern: "#,##0.00" },
  pct: { type: "PERCENT", pattern: "0.00%" },
  dec: { type: "NUMBER", pattern: "0.0" },
} as const;

const HEADER_BG = { red: 0.992, green: 0.91, blue: 0.941 }; // ชมพูอ่อน #fde8f0

function cellData(c: Cell, bold: boolean): sheets_v4.Schema$CellData {
  const format: sheets_v4.Schema$CellFormat = {};
  if (bold) {
    format.textFormat = { bold: true };
    format.backgroundColor = HEADER_BG;
  }
  if (c === null || c === undefined || c === "") return bold ? { userEnteredFormat: format } : {};
  if (typeof c === "object") {
    if (c.v === null) return {};
    return { userEnteredValue: { numberValue: c.v }, userEnteredFormat: { ...format, numberFormat: NUMBER_FORMAT[c.f] } };
  }
  if (typeof c === "number") return { userEnteredValue: { numberValue: c }, ...(bold ? { userEnteredFormat: format } : {}) };
  // ข้อความเก็บเป็นข้อความเสมอ (ขึ้นต้นด้วย = ก็ไม่กลายเป็นสูตร) / ลิงก์กดได้
  if (isUrl(c) && !bold) return { userEnteredValue: { stringValue: c }, userEnteredFormat: { textFormat: { link: { uri: c } } } };
  return { userEnteredValue: { stringValue: c }, ...(bold ? { userEnteredFormat: format } : {}) };
}

function googleError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  if (/insufficient|scope/i.test(msg)) return "บัญชีระบบยังไม่ได้ให้สิทธิ์ Google Sheets (ต้องเชื่อมบัญชีใหม่)";
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) return "ยังไม่ได้เปิด Google Sheets API / Drive API ใน Google Cloud";
  return `สร้าง Google Sheet ไม่สำเร็จ: ${msg.slice(0, 200)}`;
}

export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ส่งออกข้อมูล");
  if ("res" in r) return r.res;
  const book = cleanBook(await request.json().catch(() => null));
  if (!book) return fail("ข้อมูลที่ส่งออกไม่ถูกต้อง หรือใหญ่เกินไป");
  const auth = googleAuth();
  if (!auth) return fail("ยังไม่ได้เชื่อมบัญชี Google ของระบบ", 500);

  const sheets = google.sheets({ version: "v4", auth });
  const names = sheetNames(book.sheets);
  try {
    const { data: file } = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: book.title, locale: "th_TH", timeZone: "Asia/Bangkok" },
        sheets: book.sheets.map((s, i) => {
          const header = s.header ?? 0;
          return {
            properties: {
              sheetId: i,
              title: names[i],
              gridProperties: {
                rowCount: Math.max(s.rows.length, 1),
                columnCount: Math.max(1, ...s.rows.map((row) => row.length)),
                frozenRowCount: header >= 0 ? header + 1 : 0,
              },
            },
          };
        }),
      },
      fields: "spreadsheetId,spreadsheetUrl",
    });
    const id = file.spreadsheetId!;

    const requests: sheets_v4.Schema$Request[] = [];
    book.sheets.forEach((s, i) => {
      const header = s.header ?? 0;
      if (s.rows.length) {
        requests.push({
          updateCells: {
            start: { sheetId: i, rowIndex: 0, columnIndex: 0 },
            rows: s.rows.map((row, ri) => ({ values: row.map((c) => cellData(c, ri === header)) })),
            fields: "userEnteredValue,userEnteredFormat",
          },
        });
      }
      requests.push({ autoResizeDimensions: { dimensions: { sheetId: i, dimension: "COLUMNS", startIndex: 0 } } });
    });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });

    // แชร์ให้คนที่กด (ถ้าเป็นเจ้าของไฟล์อยู่แล้ว Google จะตอบ error ไม่เป็นไร) แล้วตรวจว่าเปิดได้จริง
    const drive = google.drive({ version: "v3", auth });
    const shareErr = await drive.permissions.create({
      fileId: id,
      sendNotificationEmail: false,
      requestBody: { type: "user", role: "writer", emailAddress: r.me.email },
    }).then(() => null, (err: unknown) => err);
    const { data: perms } = await drive.permissions.list({ fileId: id, fields: "permissions(emailAddress)" });
    const email = r.me.email.toLowerCase();
    if (!perms.permissions?.some((p) => p.emailAddress?.toLowerCase() === email)) {
      return fail(`สร้าง Google Sheet แล้ว แต่แชร์ให้ ${r.me.email} ไม่สำเร็จ${shareErr ? `: ${(shareErr as Error).message?.slice(0, 150)}` : ""}`, 500);
    }

    return ok({ url: file.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit` });
  } catch (err) {
    return fail(googleError(err), 500);
  }
}
