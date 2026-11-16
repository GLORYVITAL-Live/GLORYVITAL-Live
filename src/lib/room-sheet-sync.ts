import "server-only";
import type { sheets_v4 } from "googleapis";
import { spreadsheetIdOf } from "@/lib/frames";
import { withSyncLock } from "@/lib/lock";
import {
  ROOM_COLS, buildRoomSheet, pairRoomSlots, roomSheetText, teamTabTitle,
  type RawSide, type RoomCell, type RoomSheet,
} from "@/lib/room-sheet";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";

// เขียนตารางห้องไลฟ์ลงชีตตารางไลฟ์ของแอดมินประจำ (หน้าตา + กติกาอยู่ที่ src/lib/room-sheet.ts)
//   ลิงก์ชีตอยู่ที่ settings.room_sheet_id (ตั้งด้วย SQL ไม่อยู่ในโค้ด เพราะ repo เป็นสาธารณะ · SQL 20261201000000_room_sheet)
//   ทุกชั่วโมง (cron notify รอบต้นชั่วโมง) เดือนนี้ + เดือนหน้า · ปุ่ม "ลงตารางห้องไลฟ์" ในหน้า Plan Slot Live = เดือนที่เปิดอยู่
//   เขียนเฉพาะเมื่อข้อความ / ช่องที่รวมไว้ต่างจากในแท็บ (ไม่มีอะไรเปลี่ยน = ไม่แตะชีต) · แท็บเดิมที่ทีมทำมือไม่ถูกแตะ
//   เดือนที่ยังไม่มีคิวเลยและยังไม่มีแท็บ = ไม่สร้างแท็บว่าง (ยกเว้นกดปุ่มเอง)

export type RoomSyncResult = {
  month: string; title: string; url: string; placed: number; skipped: string[];
  /** true = เขียนแท็บใหม่ · false = ไม่มีอะไรเปลี่ยน / ไม่มีคิว */
  written: boolean;
  created: boolean;
};

const NOTE = "แท็บนี้เว็บสร้างให้อัตโนมัติจากคิว Mc + Admin ในเว็บ (อัปเดตทุกชั่วโมง หรือกดปุ่ม \"ลงตารางห้องไลฟ์\" ในหน้า Plan Slot Live)"
  + " — แก้ในแท็บนี้จะถูกเขียนทับ ให้แก้คิวที่เว็บแทน";

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const LINE = { style: "SOLID", color: rgb("#000000") };

function cellData(c: RoomCell | null, note?: string): sheets_v4.Schema$CellData {
  if (!c) return {};
  return {
    ...(c.text ? { userEnteredValue: { stringValue: c.text } } : {}),
    userEnteredFormat: {
      backgroundColor: rgb(c.bg),
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      wrapStrategy: c.wrap ? "WRAP" : "OVERFLOW_CELL",
      textFormat: { fontFamily: c.prompt ? "Prompt" : "Arial", fontSize: c.size ?? 10, bold: !!c.bold, foregroundColor: rgb(c.fg ?? "#000000") },
      ...(c.border ? { borders: { top: LINE, bottom: LINE, left: LINE, right: LINE } } : {}),
    },
    ...(note ? { note } : {}),
  };
}

const mergeKey = (m: { r0: number; r1: number; c0: number; c1: number }) => `${m.r0},${m.r1},${m.c0},${m.c1}`;

/** id ชีตจาก settings (ยังไม่รัน SQL / ยังไม่ตั้ง = ข้าม พร้อมเหตุผล) */
export async function roomSheetId(): Promise<{ id: string } | { skipped: string }> {
  const { data, error } = await createAdminClient().from("settings").select("room_sheet_id").eq("id", 1).maybeSingle();
  if (error) return { skipped: /room_sheet_id/.test(error.message) ? "ยังไม่ได้รัน SQL 20261201000000_room_sheet ใน Supabase" : error.message };
  const raw = String(data?.room_sheet_id ?? "").trim();
  if (!raw) return { skipped: "ยังไม่ได้ตั้งลิงก์ชีตตารางห้องไลฟ์ (settings.room_sheet_id)" };
  const id = spreadsheetIdOf(raw);
  return id ? { id } : { skipped: "ค่า settings.room_sheet_id ไม่ใช่ลิงก์หรือ id ของ Google Sheets" };
}

/** คิว Mc (แท็บ Deal Mc) + Admin ของเดือน รวมวันแรกของเดือนถัดไป (คิวก่อน 05:00 = แถวของวันสุดท้าย) */
export async function loadRoomSlots(month: string) {
  const db = createAdminClient();
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  type Row = Omit<RawSide, "name"> & { person: { name: string } | null };
  const all = async (table: "mc_slots" | "admin_slots") => {
    const cols = "platform, live_date, start_time, end_time, is_cancelled, confirmed";
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const q = table === "mc_slots"
        ? db.from(table).select(`${cols}, campaign, person:staff!mc_id(name)`).eq("sheet_tab", "mc")
        : db.from(table).select(`${cols}, person:staff!admin_id(name)`);
      const { data, error } = await q.gte("live_date", first).lte("live_date", next).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as unknown as Row[]));
      if ((data ?? []).length < 1000) return out.map(({ person, ...x }) => ({ ...x, name: person?.name ?? null }));
    }
  };
  const [mc, admin] = await Promise.all([all("mc_slots"), all("admin_slots")]);
  return pairRoomSlots(mc, admin);
}

function heightRuns(sheetId: number, heights: number[]): sheets_v4.Schema$Request[] {
  const out: sheets_v4.Schema$Request[] = [];
  for (let i = 0; i < heights.length;) {
    let j = i;
    while (j < heights.length && heights[j] === heights[i]) j++;
    out.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: j }, properties: { pixelSize: heights[i] }, fields: "pixelSize",
      },
    });
    i = j;
  }
  return out;
}

function writeRequests(sheetId: number, built: RoomSheet): sheets_v4.Schema$Request[] {
  return [
    // ล้างทั้งแท็บก่อน (ช่องรวม + ค่า + รูปแบบ + โน้ต) แล้วเขียนใหม่ทั้งหมด
    //   เลิกรวมช่องก่อนตั้งแถว / คอลัมน์ที่ตรึงไว้ (ช่องที่รวมคร่อมเส้นตรึง = Google ไม่ยอม)
    { unmergeCells: { range: { sheetId } } },
    { updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat,note" } },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { rowCount: built.rows.length, columnCount: ROOM_COLS, frozenRowCount: 2, frozenColumnCount: 3 } },
        fields: "gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)",
      },
    },
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: built.rows.map((row, r) => ({ values: row.map((c, k) => cellData(c, r === 0 && k === 0 ? NOTE : undefined)) })),
        fields: "userEnteredValue,userEnteredFormat,note",
      },
    },
    ...built.merges.map((m) => ({
      mergeCells: { range: { sheetId, startRowIndex: m.r0, endRowIndex: m.r1, startColumnIndex: m.c0, endColumnIndex: m.c1 }, mergeType: "MERGE_ALL" },
    })),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: ROOM_COLS }, properties: { pixelSize: 100 }, fields: "pixelSize",
      },
    },
    ...heightRuns(sheetId, built.heights),
  ];
}

/** error จาก Google → บอกว่าต้องแก้อะไร */
function googleError(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  if (/requested entity was not found/i.test(msg)) return "ไม่พบชีตตาม settings.room_sheet_id — ตรวจว่าคัดลอกลิงก์ครบ";
  if (/permission|forbidden/i.test(msg)) return "บัญชี Google ของระบบไม่มีสิทธิ์แก้ชีตตารางห้องไลฟ์ — แชร์สิทธิ์ผู้แก้ไขให้บัญชีระบบ";
  return `เขียนตารางห้องไลฟ์ไม่สำเร็จ: ${msg.slice(0, 200)}`;
}

async function run(months: string[], createEmpty: boolean): Promise<RoomSyncResult[] | { skipped: string }> {
  const target = await roomSheetId();
  if ("skipped" in target) return target;
  const spreadsheetId = target.id;
  const api = sheetsApi();
  const url = (gid: number) => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`;
  try {
    const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,index,gridProperties(rowCount))" });
    const tabs = (meta.data.sheets ?? []).map((s) => s.properties!);
    const out: RoomSyncResult[] = [];
    for (const month of months) {
      const built = buildRoomSheet(month, await loadRoomSlots(month));
      const base = { month, title: built.title, placed: built.placed, skipped: built.skipped };
      let tab = tabs.find((t) => t.title === built.title);
      if (!tab && !built.placed && !createEmpty) {
        out.push({ ...base, url: "", written: false, created: false });
        continue;
      }
      if (tab) {
        // เทียบกับในแท็บ: ข้อความทุกช่อง + ช่องที่รวมไว้ + จำนวนแถว เหมือนเดิม = ไม่ต้องเขียน
        const [vals, merged] = await Promise.all([
          api.spreadsheets.values.get({ spreadsheetId, range: `'${built.title}'!A1:AC${Math.max(tab.gridProperties?.rowCount ?? 1, built.rows.length)}` }),
          api.spreadsheets.get({ spreadsheetId, ranges: [`'${built.title}'`], fields: "sheets(merges)" }),
        ]);
        const sameText = JSON.stringify(vals.data.values ?? []) === JSON.stringify(roomSheetText(built.rows));
        const have = (merged.data.sheets?.[0]?.merges ?? []).map((m) => mergeKey({
          r0: m.startRowIndex ?? 0, r1: m.endRowIndex ?? 0, c0: m.startColumnIndex ?? 0, c1: m.endColumnIndex ?? 0,
        })).sort();
        const sameMerges = JSON.stringify(have) === JSON.stringify(built.merges.map(mergeKey).sort());
        if (sameText && sameMerges && tab.gridProperties?.rowCount === built.rows.length) {
          out.push({ ...base, url: url(tab.sheetId!), written: false, created: false });
          continue;
        }
      }
      let created = false;
      if (!tab) {
        // วางต่อจากแท็บของทีมเดือนเดียวกัน (ไม่มี = ต่อจากแท็บแรก)
        const team = tabs.find((t) => t.title === teamTabTitle(month));
        const added = await api.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: built.title, index: (team?.index ?? 0) + 1,
                  gridProperties: { rowCount: built.rows.length, columnCount: ROOM_COLS, frozenRowCount: 2, frozenColumnCount: 3 },
                },
              },
            }],
          },
        });
        tab = added.data.replies?.[0]?.addSheet?.properties ?? undefined;
        if (tab?.sheetId === undefined || tab.sheetId === null) throw new Error("สร้างแท็บไม่สำเร็จ");
        // แท็บที่อยู่ถัดไปเลื่อนไป 1 ลำดับ (เดือนถัดไปจะได้วางต่อจากแท็บของทีมถูกที่)
        const at = tab.index ?? 0;
        for (const t of tabs) if ((t.index ?? 0) >= at) t.index = (t.index ?? 0) + 1;
        tabs.push(tab);
        created = true;
      }
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: writeRequests(tab.sheetId!, built) } });
      out.push({ ...base, url: url(tab.sheetId!), written: true, created });
    }
    return out;
  } catch (err) {
    throw new Error(googleError(err));
  }
}

/**
 * อัปเดตตารางห้องไลฟ์ของเดือนที่ระบุ (YYYY-MM)
 *   createEmpty = สร้างแท็บแม้ยังไม่มีคิว (กดปุ่มเอง) · waitMs = รอล็อกได้นานเท่าไร (ไม่ได้ล็อก = { skipped })
 */
export async function syncRoomSheet(months: string[], { createEmpty = false, waitMs = 1_000 } = {}) {
  const res = await withSyncLock("room-sheet", () => run(months, createEmpty), waitMs);
  return res ?? { skipped: "กำลังอัปเดตตารางห้องไลฟ์อยู่ ลองใหม่อีกครั้ง" };
}
