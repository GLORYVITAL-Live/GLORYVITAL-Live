import "server-only";
import type { sheets_v4 } from "googleapis";
import { spreadsheetIdOf } from "@/lib/frames";
import { withSyncLock } from "@/lib/lock";
import {
  ROOM_AGENCIES, ROOM_COLS, adminDayCounts, adminSummaryEdits, buildRoomSheet, footprintCells, keepTeamAdmins, keepTeamCells, nameKey, pairRoomSlots,
  roomSheetText, teamTabTitle, webFootprint,
  type GridCell, type RawAgency, type RawSide, type RoomCell, type RoomSheet,
} from "@/lib/room-sheet";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";

// เขียนตารางห้องไลฟ์ลงชีตตารางไลฟ์ของแอดมินประจำ (หน้าตา + กติกาอยู่ที่ src/lib/room-sheet.ts)
//   ลิงก์ชีตอยู่ที่ settings.room_sheet_id (ตั้งด้วย SQL ไม่อยู่ในโค้ด เพราะ repo เป็นสาธารณะ · SQL 20261201000000_room_sheet)
//   ทุกชั่วโมง (cron notify รอบต้นชั่วโมง) เดือนนี้ + เดือนหน้า · ปุ่ม "ลงตารางห้องไลฟ์" ในหน้า Plan Slot Live = เดือนที่เปิดอยู่
//   เขียนเฉพาะเมื่อข้อความ / ช่องที่รวมไว้ต่างจากในแท็บ (ไม่มีอะไรเปลี่ยน = ไม่แตะชีต) · แท็บเดิมที่ทีมทำมือไม่ถูกแตะ
//   ชื่อแอดมินที่ทีมพิมพ์ในตารางก่อนลงแท็บ Admin เสริม = เก็บไว้ (src/lib/room-sheet.ts keepTeamAdmins)
//   ช่องที่ทีมใส่เองนอกช่องคิว (กิจกรรม ข้อความ สี ช่องรวม) = เก็บไว้ (keepTeamCells · ตำแหน่งช่องคิวจดไว้ที่ CELLS_KEY)
//   เขียนเฉพาะช่วงตาราง (แถว 1 ถึงวันสุดท้าย) — แถวใต้ตารางที่ทีมเพิ่มเอง (สรุปวันหยุดแอดมิน) ไม่ถูกแตะ (META_KEY)
//   เดือนที่ยังไม่มีคิวเลยและยังไม่มีแท็บ = ไม่สร้างแท็บว่าง (ยกเว้นกดปุ่มเอง)
//   สรุปวันหยุดแอดมินที่ทีมทำไว้ใต้ตาราง: กรอกเฉพาะจำนวนคิว (src/lib/room-sheet.ts adminSummaryEdits)

export type RoomSyncResult = {
  month: string; title: string; url: string; placed: number; skipped: string[];
  /** true = เขียนแท็บใหม่ · false = ไม่มีอะไรเปลี่ยน / ไม่มีคิว */
  written: boolean;
  created: boolean;
  /** จำนวนช่องในสรุปวันหยุดแอดมินที่กรอกจำนวนคิวใหม่ */
  summary: number;
};

const NOTE = "ตาราง (แถว 1 ถึงวันสุดท้าย) เว็บสร้างให้อัตโนมัติจากคิว Mc + Admin ในเว็บ (อัปเดตทุกชั่วโมง หรือกดปุ่ม \"ลงตารางห้องไลฟ์\" ในหน้า Plan Slot Live)"
  + " — แก้ในตารางจะถูกเขียนทับ ให้แก้คิวที่เว็บแทน ยกเว้นชื่อแอดมิน (แถวสีฟ้า) ที่พิมพ์ไว้ในคิวที่เว็บยังไม่มีชื่อแอดมิน = เว็บเก็บไว้ (ลงแท็บ Admin เสริมแล้ว ชื่อจากเว็บจะแทน · คิวย้ายเวลา = ชื่อไม่ตามไป)"
  + " · ช่องว่างนอกคิวที่ทีมใส่เอง (กิจกรรม ข้อความ สี ช่องรวม) เว็บเก็บไว้ ยกเว้นคิวจริงย้ายมาลงตรงนั้น"
  + " · แถวใต้ตารางเป็นของทีม เว็บไม่แตะ ยกเว้นกรอกจำนวนคิวในสรุปวันหยุด (ช่องที่พิมพ์ off / Holiday / Sick leave ไม่แตะ)";

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const LINE = { style: "SOLID", color: rgb("#000000") };

function cellData(c: RoomCell | null, note?: string): sheets_v4.Schema$CellData {
  if (!c) return {};
  // ช่องที่ทีมใส่เอง: ค่า + รูปแบบเดิมทุกอย่าง (สี / ฟอนต์ / เส้นขอบ)
  if (c.raw) {
    return {
      ...(c.raw.value ? { userEnteredValue: c.raw.value as sheets_v4.Schema$ExtendedValue } : {}),
      ...(c.raw.format ? { userEnteredFormat: c.raw.format as sheets_v4.Schema$CellFormat } : {}),
    };
  }
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
  // แพลนของ Agency ที่ไลฟ์ในห้องของเรา (TDH = ห้อง 1 · ผู้ใช้ขอ 2026-11-20)
  const agency = async () => {
    const { data, error } = await db.from("agency_slots").select("agency, platform, live_date, start_time, end_time")
      .in("agency", Object.keys(ROOM_AGENCIES)).gte("live_date", first).lte("live_date", next).order("id").limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as RawAgency[];
  };
  const [mc, admin, agencies] = await Promise.all([all("mc_slots"), all("admin_slots"), agency()]);
  return pairRoomSlots(mc, admin, agencies);
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

/**
 * จำนวนแถวของตารางที่เว็บเขียนไว้ล่าสุด (developer metadata ของแท็บ — ไม่แสดงในชีต)
 *   แถวใต้ตารางเป็นของทีม (เช่น สรุปวันหยุดแอดมิน ผู้ใช้เพิ่ม 2026-11-16) เว็บไม่แตะเด็ดขาด
 *   ตารางสูงขึ้น / เตี้ยลง (มี / หมดห้อง "อื่นๆ") = แทรก / ลบแถวท้ายตาราง ส่วนของทีมเลื่อนตามไม่ถูกทับ
 */
const META_KEY = "glory-room-table-rows";
/** ตำแหน่งช่องคิวที่เว็บเขียนรอบล่าสุด (src/lib/room-sheet.ts webFootprint) — ช่องนอกนี้ที่มีของ = ทีมใส่เอง เก็บไว้ */
const CELLS_KEY = "glory-room-web-cells";

type TabInfo = {
  props: sheets_v4.Schema$SheetProperties; metaId: number | null; oldRows: number | null;
  cellsMetaId: number | null; cells: string | null;
};

/** สีพื้นที่ไม่ใช่ขาว (ทีมระบายสี) */
function colored(f: sheets_v4.Schema$CellFormat | undefined) {
  const c = f?.backgroundColorStyle?.rgbColor ?? f?.backgroundColor;
  if (!c) return false;
  return (c.red ?? 0) < 0.99 || (c.green ?? 0) < 0.99 || (c.blue ?? 0) < 0.99;
}
const bordered = (f: sheets_v4.Schema$CellFormat | undefined) =>
  !!f?.borders && Object.values(f.borders).some((b) => b && (b as sheets_v4.Schema$Border).style && (b as sheets_v4.Schema$Border).style !== "NONE");

function writeRequests(tab: TabInfo, built: RoomSheet, created: boolean): sheets_v4.Schema$Request[] {
  const sheetId = tab.props.sheetId!;
  const rows = built.rows.length;
  const grid = tab.props.gridProperties?.rowCount ?? rows;
  const old = tab.oldRows ?? rows;
  const out: sheets_v4.Schema$Request[] = [];
  if (rows > old) {
    out.push(old >= grid
      ? { appendDimension: { sheetId, dimension: "ROWS", length: rows - old } }
      : { insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: old, endIndex: rows }, inheritFromBefore: false } });
  } else if (rows < old) {
    out.push({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rows, endIndex: old } } });
  }
  const table = { sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: ROOM_COLS };
  out.push(
    // ล้างเฉพาะช่วงตาราง (ช่องรวม + ค่า + รูปแบบ + โน้ต) แล้วเขียนใหม่ · แถวใต้ตารางไม่แตะ
    { unmergeCells: { range: table } },
    { updateCells: { range: table, fields: "userEnteredValue,userEnteredFormat,note" } },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 3 } },
        fields: "gridProperties(frozenRowCount,frozenColumnCount)",
      },
    },
  );
  out.push(
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
    ...heightRuns(sheetId, built.heights),
  );
  // ความกว้างคอลัมน์ตั้งครั้งเดียวตอนสร้างแท็บ (ทีมปรับเองได้ ไม่ถูกตั้งกลับ)
  if (created) {
    out.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: ROOM_COLS }, properties: { pixelSize: 100 }, fields: "pixelSize",
      },
    });
  }
  // จำตำแหน่งช่องคิวรอบนี้ไว้ (รอบหน้าแยกได้ว่าช่องไหนเป็นของทีม)
  const cells = webFootprint(built);
  if (tab.cellsMetaId !== null && tab.cellsMetaId >= 0) {
    if (tab.cells !== cells) {
      out.push({
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: tab.cellsMetaId } }],
          developerMetadata: { metadataValue: cells }, fields: "metadataValue",
        },
      });
    }
  } else if (tab.cellsMetaId === null) {
    out.push({
      createDeveloperMetadata: {
        developerMetadata: { metadataKey: CELLS_KEY, metadataValue: cells, location: { sheetId }, visibility: "DOCUMENT" },
      },
    });
  }
  // จำความสูงตารางไว้ใช้รอบหน้า
  const value = String(rows);
  if (tab.metaId !== null) {
    if (tab.oldRows !== rows) {
      out.push({
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: tab.metaId } }],
          developerMetadata: { metadataValue: value }, fields: "metadataValue",
        },
      });
    }
  } else {
    out.push({
      createDeveloperMetadata: {
        developerMetadata: { metadataKey: META_KEY, metadataValue: value, location: { sheetId }, visibility: "DOCUMENT" },
      },
    });
  }
  return out;
}

/** error จาก Google → บอกว่าต้องแก้อะไร */
function googleError(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  if (/requested entity was not found/i.test(msg)) return "ไม่พบชีตตาม settings.room_sheet_id — ตรวจว่าคัดลอกลิงก์ครบ";
  if (/permission|forbidden/i.test(msg)) return "บัญชี Google ของระบบไม่มีสิทธิ์แก้ชีตตารางห้องไลฟ์ — แชร์สิทธิ์ผู้แก้ไขให้บัญชีระบบ";
  return `เขียนตารางห้องไลฟ์ไม่สำเร็จ: ${msg.slice(0, 200)}`;
}

type Api = ReturnType<typeof sheetsApi>;

/**
 * ตารางของเดือน: เทียบกับในแท็บ แล้วเขียนเมื่อเปลี่ยน (ยังไม่มีแท็บ = สร้าง)
 *   หลังเขียน: อัปเดตจำนวนแถวของแท็บ / ความสูงตารางใน tabs ให้ตรง (ใช้ต่อในรอบเดียวกัน)
 */
async function ensureTable(api: Api, spreadsheetId: string, tabs: TabInfo[], month: string, built: RoomSheet) {
  const rows = built.rows.length;
  let tab = tabs.find((t) => t.props.title === built.title);
  if (tab) {
    // แท็บที่เขียนก่อนมีค่าความสูงตาราง (ห้อง 1–3 เสมอ) = ตาราง 3 ห้องของเดือนนั้น
    const old = tab.oldRows ?? buildRoomSheet(month, []).rows.length;
    tab.oldRows = old;
    // เทียบเฉพาะช่วงตาราง: ข้อความทุกช่อง + ช่องที่รวมไว้ + ความสูงตาราง เหมือนเดิม = ไม่ต้องเขียน
    //   สีตัวอักษรไว้แยกชื่อแอดมินที่เว็บเขียน (WEB_ADMIN_FG) กับชื่อที่ทีมพิมพ์เอง
    const range = `'${built.title}'!A1:AC${Math.min(old, tab.props.gridProperties?.rowCount ?? 1)}`;
    const [vals, merged] = await Promise.all([
      api.spreadsheets.values.get({ spreadsheetId, range }),
      // ค่า + รูปแบบดิบทุกช่อง: แยกชื่อแอดมินที่เว็บเขียน (สีตัวอักษร) + คัดลอกช่องที่ทีมใส่เองกลับ
      api.spreadsheets.get({ spreadsheetId, ranges: [range], fields: "sheets(merges,data(rowData(values(userEnteredValue,userEnteredFormat,formattedValue))))" }),
    ]);
    const formats = merged.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    const webWritten = (r: number, c: number) => {
      const fg = formats[r]?.values?.[c]?.userEnteredFormat?.textFormat?.foregroundColor;
      return !!fg && !fg.red && !fg.green && Math.round((fg.blue ?? 0) * 255) === 1;
    };
    // ชื่อแอดมินที่ทีมพิมพ์ไว้ในคิวที่เว็บยังไม่มีชื่อ = เก็บไว้ (เทียบรวมด้วย ไม่มีอะไรเปลี่ยน = ไม่เขียน)
    keepTeamAdmins(built, (vals.data.values ?? []) as string[][], webWritten);
    // กิจกรรม / ข้อความ / สี ที่ทีมใส่เองนอกช่องคิว = เก็บไว้ (ผู้ใช้ขอ 2026-11-23)
    const existingMerges = (merged.data.sheets?.[0]?.merges ?? []).filter((m) => (m.startRowIndex ?? 0) < old).map((m) => ({
      r0: m.startRowIndex ?? 0, r1: m.endRowIndex ?? 0, c0: m.startColumnIndex ?? 0, c1: m.endColumnIndex ?? 0,
    }));
    const grid: GridCell[][] = formats.map((row) => (row.values ?? []).map((v) => ({
      text: v.formattedValue ?? "", value: v.userEnteredValue ?? undefined, format: v.userEnteredFormat ?? undefined,
      filled: !!v.userEnteredValue || colored(v.userEnteredFormat ?? undefined) || bordered(v.userEnteredFormat ?? undefined),
    })));
    // ยังไม่เคยจดตำแหน่งช่องคิว (รอบแรกหลังมีระบบนี้) = แยกไม่ได้ว่าช่องไหนเป็นคิวเก่าที่ย้ายไปแล้ว → เขียนใหม่ทั้งตารางแบบเดิม 1 รอบ แล้วจดไว้
    const prev = footprintCells(tab.cells);
    if (prev) keepTeamCells(built, grid, existingMerges, prev);
    const sameText = JSON.stringify(vals.data.values ?? []) === JSON.stringify(roomSheetText(built.rows));
    const have = existingMerges.map(mergeKey).sort();
    const sameMerges = JSON.stringify(have) === JSON.stringify(built.merges.map(mergeKey).sort());
    // ยังไม่มีค่าความสูงตาราง / ตำแหน่งช่องคิวในแท็บ = เขียนรอบนี้เพื่อจดไว้
    if (sameText && sameMerges && old === rows && tab.metaId !== null && tab.cells === webFootprint(built)) return { tab, written: false, created: false };
  }
  let created = false;
  if (!tab) {
    // วางต่อจากแท็บของทีมเดือนเดียวกัน (ไม่มี = ต่อจากแท็บแรก)
    const team = tabs.find((t) => t.props.title === teamTabTitle(month));
    const added = await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: built.title, index: (team?.props.index ?? 0) + 1,
              gridProperties: { rowCount: rows, columnCount: ROOM_COLS, frozenRowCount: 2, frozenColumnCount: 3 },
            },
          },
        }],
      },
    });
    const props = added.data.replies?.[0]?.addSheet?.properties;
    if (props?.sheetId === undefined || props.sheetId === null) throw new Error("สร้างแท็บไม่สำเร็จ");
    // แท็บที่อยู่ถัดไปเลื่อนไป 1 ลำดับ (เดือนถัดไปจะได้วางต่อจากแท็บของทีมถูกที่)
    const at = props.index ?? 0;
    for (const t of tabs) if ((t.props.index ?? 0) >= at) t.props.index = (t.props.index ?? 0) + 1;
    tab = { props, metaId: null, oldRows: rows, cellsMetaId: null, cells: null };
    tabs.push(tab);
    created = true;
  }
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: writeRequests(tab, built, created) } });
  // แทรก / ลบแถวท้ายตาราง = จำนวนแถวของแท็บเปลี่ยนเท่ากัน
  const grid = tab.props.gridProperties?.rowCount ?? rows;
  tab.props.gridProperties = { ...tab.props.gridProperties, rowCount: grid + rows - (tab.oldRows ?? rows) };
  tab.oldRows = rows;
  tab.metaId ??= -1; // จดค่าแล้ว (id จริงไม่ต้องใช้ในรอบนี้)
  tab.cellsMetaId ??= -1;
  tab.cells = webFootprint(built);
  return { tab, written: true, created };
}

/** ชื่อแอดมินเสริม (Admin เสริม) ทั้งหมด (nameKey) — ใช้รวมคอลัมน์ "Adminเสริม" ในสรุปวันหยุด */
async function loadExtraAdmins() {
  const { data, error } = await createAdminClient().from("staff").select("name").eq("role", "admin").eq("is_extra_admin", true);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((x) => nameKey(String(x.name ?? ""))).filter(Boolean));
}

const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

async function run(months: string[], createEmpty: boolean, idOverride?: string): Promise<RoomSyncResult[] | { skipped: string }> {
  const target = idOverride ? { id: idOverride } : await roomSheetId();
  if ("skipped" in target) return target;
  const spreadsheetId = target.id;
  const api = sheetsApi();
  const url = (gid: number) => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`;
  try {
    const meta = await api.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title,index,gridProperties(rowCount)),developerMetadata(metadataId,metadataKey,metadataValue))",
    });
    const tabs: TabInfo[] = (meta.data.sheets ?? []).map((s) => {
      const d = (s.developerMetadata ?? []).find((x) => x.metadataKey === META_KEY);
      const k = (s.developerMetadata ?? []).find((x) => x.metadataKey === CELLS_KEY);
      const n = Number(d?.metadataValue);
      return {
        props: s.properties!, metaId: d?.metadataId ?? null, oldRows: Number.isInteger(n) && n > 0 ? n : null,
        cellsMetaId: k?.metadataId ?? null, cells: k?.metadataValue ?? null,
      };
    });
    const out: RoomSyncResult[] = [];
    let extra: Set<string> | null = null;
    for (const month of months) {
      const slots = await loadRoomSlots(month);
      const built = buildRoomSheet(month, slots);
      const rows = built.rows.length;
      const base = { month, title: built.title, placed: built.placed, skipped: built.skipped };
      if (!tabs.some((t) => t.props.title === built.title) && !built.placed && !createEmpty) {
        out.push({ ...base, url: "", written: false, created: false, summary: 0 });
        continue;
      }
      const { tab, written, created } = await ensureTable(api, spreadsheetId, tabs, month, built);
      // สรุปวันหยุดแอดมินใต้ตาราง (มีแถวใต้ตารางเท่านั้น): กรอกจำนวนคิวเฉพาะช่องที่ต่างจากเดิม
      let summary = 0;
      const grid = tab.props.gridProperties?.rowCount ?? rows;
      if (grid > rows) {
        extra ??= await loadExtraAdmins();
        const below = await api.spreadsheets.values.get({ spreadsheetId, range: `'${built.title}'!A${rows + 1}:AC${grid}` });
        const edits = adminSummaryEdits((below.data.values ?? []) as string[][], month, adminDayCounts(month, slots), extra);
        if (edits.length) {
          await api.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "RAW",
              data: edits.map((e) => ({ range: `'${built.title}'!${colName(e.col)}${rows + 1 + e.row}`, values: [[e.value]] })),
            },
          });
        }
        summary = edits.length;
      }
      out.push({ ...base, url: url(tab.props.sheetId!), written, created, summary });
    }
    return out;
  } catch (err) {
    throw new Error(googleError(err));
  }
}

/**
 * อัปเดตตารางห้องไลฟ์ของเดือนที่ระบุ (YYYY-MM)
 *   createEmpty = สร้างแท็บแม้ยังไม่มีคิว (กดปุ่มเอง) · waitMs = รอล็อกได้นานเท่าไร (ไม่ได้ล็อก = { skipped })
 *   spreadsheetId = เขียนลงชีตอื่นแทนค่าใน settings (ไว้ทดสอบกับสำเนาชีตเท่านั้น)
 */
export async function syncRoomSheet(months: string[], { createEmpty = false, waitMs = 1_000, spreadsheetId = "" } = {}) {
  const res = await withSyncLock("room-sheet", () => run(months, createEmpty, spreadsheetId || undefined), waitMs);
  return res ?? { skipped: "กำลังอัปเดตตารางห้องไลฟ์อยู่ ลองใหม่อีกครั้ง" };
}
