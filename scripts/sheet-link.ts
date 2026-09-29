/**
 * ผูกแถวในชีตกับ slot ในระบบใหม่ (ทำครั้งเดียวก่อนเปิดซิงค์สองทาง)
 *
 *   bun run sheet:link --dry-run   ตรวจอย่างเดียว
 *   bun run sheet:link             เขียนรหัส slot ลงคอลัมน์ V
 *
 * ใช้เลขแถวที่บันทึกไว้ตอนนำเข้า (sheet_row) และตรวจว่าวัน/เวลาในแถวนั้นยังตรงกันก่อนเขียน
 * เขียนเฉพาะช่อง V ที่ยังว่าง ไม่ทับรหัสที่มีอยู่แล้ว
 */
import { createClient } from "@supabase/supabase-js";
import {
  COLS, SHEET_ID, TABLE_OF, TABS, colLetter, parseRow, readTab, serialDate, serialTime, sheetsApi, str, type TabKey,
} from "../src/lib/sheet";

const DRY = process.argv.includes("--dry-run");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function link(tab: TabKey) {
  const rows = await readTab(tab);
  const dbRows: { id: number; sheet_row: number; live_date: string; start_time: string; end_time: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(TABLE_OF[tab]).select("id, sheet_row, live_date, start_time, end_time")
      .not("sheet_row", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    dbRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const writes: { range: string; values: number[][] }[] = [];
  let already = 0, mismatch = 0;
  const c = COLS[tab];
  for (const s of dbRows) {
    const raw = rows[s.sheet_row - 1] ?? [];
    const p = parseRow(tab, raw);
    if (p?.id === s.id) { already++; continue; }
    // เทียบค่าดิบ (รวมแถวที่เวลาเริ่ม = เวลาจบ ซึ่ง parseRow ข้าม) เพื่อให้แก้แถวนั้นในชีตแล้วอัปเดต slot เดิม
    const same = serialDate(raw[c.date]) === s.live_date && serialTime(raw[c.start]) === s.start_time.slice(0, 5)
      && serialTime(raw[c.end]) === s.end_time.slice(0, 5) && !str(raw[c.id]);
    if (!same) { mismatch++; continue; }
    if (!p) console.log(`  ⚠️ แถว ${s.sheet_row}: เวลาเริ่ม = เวลาจบ (${s.start_time.slice(0, 5)}) ควรแก้เวลาจบในชีต`);
    writes.push({ range: `'${TABS[tab]}'!${colLetter(COLS[tab].id)}${s.sheet_row}`, values: [[s.id]] });
  }
  console.log(`${TABS[tab]}: slot ${dbRows.length} | ผูกแล้ว ${already} | จะผูกเพิ่ม ${writes.length} | แถวไม่ตรง ${mismatch}`);
  if (DRY || !writes.length) return;
  for (let i = 0; i < writes.length; i += 1000) {
    await sheetsApi().spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: writes.slice(i, i + 1000) },
    });
  }
  // หัวคอลัมน์ (แถวหัวตาราง: Deal Mc แถว 3, Admin แถว 2)
  const headRow = tab === "mc" ? 3 : 2;
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TABS[tab]}'!${colLetter(COLS[tab].id)}${headRow}`,
    valueInputOption: "RAW", requestBody: { values: [["Slot ID (ระบบ ห้ามแก้)"]] },
  });
  console.log(`  ✓ เขียนรหัสแล้ว ${writes.length} แถว`);
}

await link("mc");
await link("admin");
if (DRY) console.log("(dry run — ไม่ได้เขียนชีต)");
