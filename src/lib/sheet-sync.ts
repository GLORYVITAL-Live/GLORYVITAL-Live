import "server-only";
import type { sheets_v4 } from "googleapis";
import { deleteCalendarEvent } from "@/lib/calendar";
import { bkkToday } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import {
  COLS, SHEET_ID, TABLE_OF, TAB_OF, TABS, colLetter, dateSerial, hoursOf, normalizeMcName, parseRow, readTab, sheetIdOf,
  sheetsApi, str, timeSerial, type Cell, type Row, type SheetSlot, type TabKey,
} from "@/lib/sheet";

/**
 * ซิงค์สองทางกับ Google Sheet
 *
 * เว็บ -> ชีต (processSheetJobs): งานใน sheet_jobs (DB trigger จดให้ทุกครั้งที่ slot เปลี่ยน)
 *   หาแถวจากรหัสในคอลัมน์ V แล้วเขียนเฉพาะช่องที่ต่าง ถ้ายังไม่มีแถว = slot ใหม่
 *   แทรกแถวในกลุ่มวันเดียวกัน เรียงตามเวลาเริ่ม (คัดลอกรูปแบบ/checkbox/สูตรจากแถวข้างบน)
 *
 * ชีต -> เว็บ (applySheetEdits): อ่านแถวที่ถูกแก้ แล้วอัปเดต DB เฉพาะฟิลด์ในคอลัมน์ที่ถูกแก้
 *   แถวที่ยังไม่มีรหัสและกรอกวัน/เวลาครบ = slot ใหม่ สร้างใน DB แล้วเขียนรหัสลงคอลัมน์ V
 *
 * แถวคู่: พิมพ์แถวใหม่/แก้เวลาในแท็บหนึ่ง = สร้าง/ย้ายแถวคู่ในอีกแท็บ (ดูหัวข้อ "slot คู่" ด้านล่าง)
 *
 * ลบแถวในชีต (removeSlotsDeletedInSheet): slot ตั้งแต่วันนี้ที่รหัสไม่อยู่ในชีตแล้ว = ถูกลบในชีต
 *   ลบออกจาก DB (+ ลบ event ในปฏิทิน) เว็บจะไม่แสดงให้จองอีก และไม่เขียนแถวกลับลงชีต
 *
 * ทุกงานที่แก้ชีตทำภายใต้ล็อกเดียวกัน (sync_locks) เพราะการแทรก/ลบแถวทำให้เลขแถวเลื่อน
 * ถ้าแก้ slot เดียวกันพร้อมกันทั้งสองที่ ค่าที่แก้ทีหลังชนะ
 */

type Table = "mc_slots" | "admin_slots";
type DbSlot = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string;
  campaign?: string; confirmed: boolean | null; status: string; remark: string;
  personId: number | null; personName: string;
};

const LOCK = "sheet";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hm = (t: string) => t.slice(0, 5);
const minutes = (v: Cell) => (typeof v === "number" ? Math.round((v - Math.floor(v)) * 1440) % 1440 : null);

// ---------- ล็อก ----------

async function withSheetLock<T>(fn: () => Promise<T>, waitMs = 25_000): Promise<T | null> {
  const db = createAdminClient();
  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await db.rpc("try_sync_lock", { p_name: LOCK, p_seconds: 90, p_holder: holder });
    if (error) throw error;
    if (data) break;
    if (Date.now() > deadline) return null;
    await sleep(700);
  }
  try {
    return await fn();
  } finally {
    await db.rpc("release_sync_lock", { p_name: LOCK, p_holder: holder });
  }
}

// ---------- อ่าน slot จาก DB ----------

async function loadSlots(table: Table, ids?: number[]): Promise<Map<number, DbSlot>> {
  const db = createAdminClient();
  const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
  const cols = `id, platform, live_date, start_time, end_time, ${table === "mc_slots" ? "campaign, " : ""}confirmed, status, remark, ${personCol}, person:staff!${personCol}(name)`;
  type Raw = Omit<DbSlot, "personId" | "personName"> & Record<string, unknown> & { person: { name: string } | null };
  const out = new Map<number, DbSlot>();
  const add = (rows: Raw[]) => {
    for (const r of rows) {
      out.set(r.id, {
        id: r.id, platform: r.platform, live_date: r.live_date, start_time: hm(r.start_time), end_time: hm(r.end_time),
        campaign: r.campaign as string | undefined, confirmed: r.confirmed, status: r.status, remark: r.remark,
        personId: (r[personCol] as number | null) ?? null, personName: r.person?.name ?? "",
      });
    }
  };
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from(table).select(cols).in("id", ids.slice(i, i + 200));
      if (error) throw error;
      add((data ?? []) as unknown as Raw[]);
    }
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
      if (error) throw error;
      add((data ?? []) as unknown as Raw[]);
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

// ---------- รหัสซ้ำในชีต ----------

type SlotKey = Pick<DbSlot, "platform" | "live_date" | "start_time" | "end_time">;
const sameSlot = (a: SlotKey, b: SlotKey) =>
  a.platform === b.platform && a.live_date === b.live_date && a.start_time === b.start_time && a.end_time === b.end_time;
const keyOf = (p: SlotKey) => `${p.platform}|${p.live_date}|${hm(p.start_time)}|${hm(p.end_time)}`;

/**
 * รหัสที่อยู่หลายแถว (เช่น คัดลอกทั้งแถวรวมคอลัมน์ V) -> เลขแถว (เริ่ม 1) ที่เป็นเจ้าของรหัสจริง
 *   = แถวแรกที่แพลตฟอร์ม/วัน/เวลาตรงกับ DB ถ้าไม่มีแถวไหนตรง = แถวแรก
 * แถวอื่นที่มีรหัสเดียวกันถือเป็นแถวคัดลอก ห้ามเอาไปแก้ slot เดิม
 */
export function duplicateOwners(tab: TabKey, rows: Row[], slots: Map<number, DbSlot>) {
  const rowsOf = new Map<number, { r: number; p: SheetSlot }[]>();
  rows.forEach((vals, i) => {
    const p = parseRow(tab, vals);
    if (p?.id) rowsOf.set(p.id, [...(rowsOf.get(p.id) ?? []), { r: i + 1, p }]);
  });
  const owner = new Map<number, number>();
  for (const [id, list] of rowsOf) {
    if (list.length < 2) continue;
    const s = slots.get(id);
    owner.set(id, ((s && list.find((x) => sameSlot(x.p, s))) || list[0]).r);
  }
  return owner;
}

// ---------- เว็บ -> ชีต ----------

/** ค่าที่ควรอยู่ในแต่ละช่องของแถว (คอลัมน์ -> ค่า) */
function desiredCells(tab: TabKey, s: DbSlot): Map<number, Cell> {
  const c = COLS[tab];
  const m = new Map<number, Cell>([
    [c.platform, s.platform],
    [c.date, dateSerial(s.live_date)],
    [c.start, timeSerial(s.start_time)],
    [c.end, timeSerial(s.end_time)],
    [c.person, s.personName ? (tab === "mc" ? `Mc ${s.personName}` : s.personName) : ""],
    [c.confirm, s.confirmed === null ? "" : s.confirmed],
    [c.status, s.status],
    [c.remark, s.remark],
  ]);
  if (tab === "mc") m.set(COLS.mc.campaign, s.campaign ?? "");
  return m;
}

function sameCell(tab: TabKey, col: number, have: Cell, want: Cell) {
  const c = COLS[tab];
  if (col === c.start || col === c.end) return minutes(have) === minutes(want);
  if (col === c.date) return typeof have === "number" && Math.floor(have) === want;
  if (col === c.confirm) {
    const norm = (v: Cell) => (v === true || v === "TRUE" ? true : v === false || v === "FALSE" ? false : "");
    return norm(have) === norm(want);
  }
  if (col === c.person && tab === "mc") return normalizeMcName(have) === normalizeMcName(want);
  return str(have) === str(want);
}

type Item = { vals: Row; isNew?: boolean };

/**
 * ตำแหน่งแทรกแถวใหม่ ให้อยู่ในกลุ่ม วันเดียวกัน -> แพลตฟอร์มเดียวกัน -> เรียงตามเวลาเริ่ม (แบบที่ทีมจัดในชีต)
 *   1) ต่อจากแถวสุดท้ายของวัน+แพลตฟอร์มเดียวกันที่เวลาเริ่ม <= slot ใหม่
 *   2) ไม่มี (slot ใหม่เริ่มเร็วสุดของแพลตฟอร์มนั้น) = ก่อนแถวแรกของวัน+แพลตฟอร์มเดียวกัน
 *   3) วันนั้นยังไม่มีแพลตฟอร์มนี้ = ต่อท้ายกลุ่มวันนั้น
 *   4) ยังไม่มีวันนั้น = ต่อจากวันก่อนหน้าที่ใกล้ที่สุด
 */
export function insertIndex(tab: TabKey, items: Item[], s: Pick<DbSlot, "platform" | "live_date" | "start_time">) {
  const c = COLS[tab];
  const day = dateSerial(s.live_date);
  const start = Math.round(timeSerial(s.start_time) * 1440);
  let lastLE = -1, firstSame = -1, lastOfDay = -1, prevIdx = -1, prevDay = -Infinity;
  items.forEach((it, i) => {
    const dv = it.vals[c.date];
    if (typeof dv !== "number" || dv < 1) return;
    const d = Math.floor(dv);
    if (d === day) {
      lastOfDay = i;
      if (str(it.vals[c.platform]) !== s.platform) return;
      if (firstSame < 0) firstSame = i;
      const sv = minutes(it.vals[c.start]);
      if (sv !== null && sv <= start) lastLE = i;
    } else if (d < day && d >= prevDay) {
      prevDay = d;
      prevIdx = i;
    }
  });
  if (lastLE >= 0) return lastLE + 1;
  if (firstSame >= 0) return firstSame;
  if (lastOfDay >= 0) return lastOfDay + 1;
  if (prevIdx >= 0) return prevIdx + 1;
  return items.length;
}

async function writeSlotsToSheet(tab: TabKey, ids: number[]) {
  const table = TABLE_OF[tab];
  const c = COLS[tab];
  const slots = await loadSlots(table, ids);
  if (!slots.size) return { updated: 0, inserted: 0, removed: 0 };

  const items: Item[] = (await readTab(tab)).map((vals) => ({ vals }));
  const present = sheetContents(tab, items.map((it) => it.vals));
  const byId = new Map<number, Item>();
  const byKey = new Map<string, Item[]>(); // แถวที่ยังไม่มีรหัส (เผื่อจับคู่ด้วยวัน/เวลา)
  const owner = duplicateOwners(tab, items.map((it) => it.vals), slots);
  items.forEach((it, i) => {
    const p = parseRow(tab, it.vals);
    if (p?.id) {
      if (!owner.has(p.id) || owner.get(p.id) === i + 1) byId.set(p.id, it); // ไม่เขียนทับแถวคัดลอก
    } else if (p) byKey.set(keyOf(p), [...(byKey.get(keyOf(p)) ?? []), it]);
  });

  const cellWrites: { item: Item; col: number; value: Cell }[] = [];
  const inserts: number[] = []; // index ตอนแทรก (ตามลำดับ)
  const newItems: { item: Item; slot: DbSlot }[] = [];
  // slot ที่เคยอยู่ในชีตแล้วแต่ตอนนี้หาแถวไม่เจอ = ถูกลบแถวในชีต ห้ามแทรกกลับ
  const wasInSheet = await everInSheet(table, [...slots.keys()].filter((id) => !byId.has(id)));
  const gone: number[] = [];

  for (const s of slots.values()) {
    let it = byId.get(s.id);
    if (!it) {
      it = byKey.get(keyOf(s))?.shift();
      if (it) cellWrites.push({ item: it, col: c.id, value: s.id });
    }
    if (!it && present.ids.has(s.id)) continue; // รหัสอยู่ในแถวที่อ่านไม่ได้ (เช่น เวลาเริ่ม = เวลาจบ) ไม่แทรกซ้ำ
    if (!it && wasInSheet.has(s.id)) {
      gone.push(s.id);
      continue;
    }
    if (!it) {
      const vals: Row = [];
      for (const [col, v] of desiredCells(tab, s)) vals[col] = v;
      vals[c.hourG] = hoursOf(s.start_time, s.end_time);
      vals[c.id] = s.id;
      const item = { vals, isNew: true };
      const idx = insertIndex(tab, items, s);
      items.splice(idx, 0, item);
      inserts.push(idx);
      newItems.push({ item, slot: s });
      byId.set(s.id, item);
      continue;
    }
    let timeChanged = false;
    for (const [col, want] of desiredCells(tab, s)) {
      if (!sameCell(tab, col, it.vals[col], want)) {
        cellWrites.push({ item: it, col, value: want });
        if (col === c.start || col === c.end) timeChanged = true;
      }
    }
    if (timeChanged) cellWrites.push({ item: it, col: c.hourG, value: hoursOf(s.start_time, s.end_time) });
  }

  const api = sheetsApi();
  const rowOf = new Map<Item, number>();
  const reindex = () => items.forEach((it, i) => rowOf.set(it, i + 1));

  // 1) แทรกแถว + คัดลอก checkbox จากแถวข้างเคียง
  if (inserts.length) {
    const sheetId = await sheetIdOf(tab);
    reindex();
    const requests: sheets_v4.Schema$Request[] = inserts.map((idx) => ({
      insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 }, inheritFromBefore: idx > 0 },
    }));
    for (const { item } of newItems) {
      const r = rowOf.get(item)! - 1;
      let src = r - 1;
      while (src >= 0 && items[src].isNew) src--;
      if (src < 0) { src = r + 1; while (src < items.length && items[src].isNew) src++; }
      if (src < 0 || src >= items.length) continue;
      requests.push({
        copyPaste: {
          source: { sheetId, startRowIndex: src, endRowIndex: src + 1, startColumnIndex: 0, endColumnIndex: 12 },
          destination: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 12 },
          pasteType: "PASTE_DATA_VALIDATION",
        },
      });
    }
    await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
  }
  reindex();

  // 2) เขียนค่า
  const title = TABS[tab];
  const data: sheets_v4.Schema$ValueRange[] = [];
  const lastCol = tab === "mc" ? COLS.mc.remark : COLS.admin.status; // แท็บ Admin: คอลัมน์ L เป็นของทีม ไม่แตะ
  for (const { item } of newItems) {
    const r = rowOf.get(item)!;
    const row: Cell[] = [];
    for (let col = 1; col <= lastCol; col++) row.push(item.vals[col] ?? "");
    row[c.hourF - 1] = `=SUM(E${r}-D${r})`;
    data.push({ range: `'${title}'!B${r}:${colLetter(lastCol)}${r}`, values: [row] });
    data.push({ range: `'${title}'!${colLetter(c.id)}${r}`, values: [[item.vals[c.id]]] });
  }
  for (const w of cellWrites) {
    const r = rowOf.get(w.item)!;
    data.push({ range: `'${title}'!${colLetter(w.col)}${r}`, values: [[w.value ?? ""]] });
  }
  if (data.length) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
  const removed = gone.length ? await deleteGoneSlots(table, gone) : 0;
  return { updated: cellWrites.length, inserted: newItems.length, removed };
}

/** เขียนการเปลี่ยนแปลงจากเว็บลงชีต (งานค้างใน sheet_jobs) */
export async function processSheetJobs() {
  const db = createAdminClient();
  const result = await withSheetLock(async () => {
    let done = 0, failed = 0;
    for (let round = 0; round < 5; round++) {
      const { data: jobs, error } = await db.from("sheet_jobs").select("id, slot_table, slot_id, attempts")
        .is("done_at", null).lt("attempts", 5).order("created_at").limit(300);
      if (error) throw error;
      if (!jobs?.length) break;
      for (const tab of ["mc", "admin"] as const) {
        const mine = jobs.filter((j) => j.slot_table === TABLE_OF[tab]);
        if (!mine.length) continue;
        const jobIds = mine.map((j) => j.id);
        try {
          await writeSlotsToSheet(tab, [...new Set(mine.map((j) => j.slot_id))]);
          await db.from("sheet_jobs").update({ done_at: new Date().toISOString(), last_error: null }).in("id", jobIds);
          done += mine.length;
        } catch (err) {
          failed += mine.length;
          const msg = String((err as Error)?.message ?? err).slice(0, 500);
          console.warn(`เขียนชีตไม่สำเร็จ (${tab}):`, msg);
          for (const j of mine) await db.from("sheet_jobs").update({ attempts: j.attempts + 1, last_error: msg }).eq("id", j.id);
        }
      }
    }
    return { done, failed };
  });
  return result ?? { done: 0, failed: 0, skipped: "มีงานซิงค์ชีตอื่นกำลังทำอยู่" };
}

/**
 * ลบแถวในชีตของ slot ที่ถูกลบในเว็บ (ส่งค่าของ slot ก่อนลบมาด้วย)
 * ถ้ารหัสอยู่หลายแถว ลบเฉพาะแถวที่แพลตฟอร์ม/วัน/เวลาตรงกับ slot ไม่ลบแถวคัดลอกทิ้งไปด้วย
 */
export async function deleteSheetRows(table: Table, deleted: (SlotKey & { id: number })[]) {
  await withSheetLock(() => deleteRowsLocked(table, deleted));
}

/** ตัวทำงานของ deleteSheetRows (เรียกเมื่อถือล็อกชีตอยู่แล้วเท่านั้น) */
async function deleteRowsLocked(table: Table, deleted: (SlotKey & { id: number })[]) {
  const tab = table === "mc_slots" ? "mc" : "admin";
  const want = new Map(deleted.map((s) => [s.id, { ...s, start_time: hm(s.start_time), end_time: hm(s.end_time) }]));
  const rows = await readTab(tab);
  const found = new Map<number, { i: number; p: SheetSlot }[]>();
  rows.forEach((r, i) => {
    const p = parseRow(tab, r);
    if (p?.id && want.has(p.id)) found.set(p.id, [...(found.get(p.id) ?? []), { i, p }]);
  });
  const idx: number[] = [];
  for (const [id, list] of found) {
    const hits = list.length === 1 ? list : list.filter((x) => sameSlot(x.p, want.get(id)!));
    if (!hits.length) console.warn(`รหัส ${id} อยู่ ${list.length} แถวในชีตแต่ไม่มีแถวไหนตรงกับ slot ที่ลบ จึงไม่ลบแถว`);
    idx.push(...hits.slice(0, 1).map((x) => x.i));
  }
  idx.sort((a, b) => b - a);
  if (!idx.length) return;
  const sheetId = await sheetIdOf(tab);
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: idx.map((i) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 } } })),
    },
  });
}

// ---------- slot คู่ (Mc <-> Admin ของไลฟ์เดียวกัน) ----------
// พิมพ์แถวใหม่ในแท็บหนึ่ง = สร้างแถวคู่ในอีกแท็บให้ / แก้แพลตฟอร์ม-วัน-เวลา = แถวคู่เปลี่ยนตาม
// ลบแถว (= ยกเลิกไลฟ์) = ลบแถวคู่ในอีกแท็บที่ยังไม่มีคนจอง/รับ

const EXTRA_ADMIN = "Admin เสริม";
const otherTable = (t: Table): Table => (t === "mc_slots" ? "admin_slots" : "mc_slots");
const personColOf = (t: Table) => (t === "mc_slots" ? "mc_id" : "admin_id");

/** slot ในอีกตารางที่แพลตฟอร์ม/วัน/เวลาตรงกัน */
async function findPartners(table: Table, k: SlotKey) {
  const other = otherTable(table);
  const col = personColOf(other);
  const { data, error } = await createAdminClient().from(other).select(`id, ${col}`)
    .eq("platform", k.platform).eq("live_date", k.live_date)
    .eq("start_time", hm(k.start_time)).eq("end_time", hm(k.end_time));
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, number | null>[])
    .map((x) => ({ id: x.id as number, personId: x[col] ?? null }));
}

/** slot ใหม่จากชีต (ตั้งแต่วันนี้): ถ้าอีกแท็บยังไม่มี slot คู่ สร้างให้ (แท็บ Admin ใส่หมายเหตุ "Admin เสริม") */
async function mirrorNewSlot(table: Table, k: SlotKey) {
  if (k.live_date < bkkToday() || (await findPartners(table, k)).length) return 0;
  const other = otherTable(table);
  const { error } = await createAdminClient().from(other).insert({
    platform: k.platform, live_date: k.live_date, start_time: hm(k.start_time), end_time: hm(k.end_time),
    ...(other === "admin_slots" ? { remark: EXTRA_ADMIN } : {}),
  });
  if (error) throw error;
  return 1;
}

/** แก้แพลตฟอร์ม/วัน/เวลาในชีต: ย้าย slot คู่ในอีกแท็บตาม (เฉพาะเมื่อมีคู่ตัวเดียว ไม่งั้นไม่แน่ใจว่าตัวไหน) */
async function mirrorKeyChange(table: Table, old: SlotKey, row: Record<string, unknown>) {
  const change: Record<string, unknown> = {};
  for (const k of ["platform", "live_date", "start_time", "end_time"] as const) {
    if (k in row && row[k] !== old[k]) change[k] = row[k];
  }
  if (!Object.keys(change).length) return;
  const partners = await findPartners(table, old);
  if (partners.length !== 1) return;
  const other = otherTable(table);
  const db = createAdminClient();
  const { error } = await db.from(other).update(change).eq("id", partners[0].id);
  if (error) throw error;
  if (partners[0].personId) await db.from("calendar_jobs").insert({ slot_table: other, slot_id: partners[0].id });
}

/**
 * ลบแถว = ยกเลิกไลฟ์นั้น: ลบ slot คู่ในอีกแท็บที่ยังไม่มีคนจอง/รับ (DB + แถวในชีต)
 * คู่ที่มีคนแล้วไม่แตะ (ให้ทีมจัดการเอง ระบบอัปเดตหมายเหตุในปฏิทินให้)
 */
async function removeFreePartners(table: Table, gone: (SlotKey & { starts_at: string; ends_at: string })[]) {
  const db = createAdminClient();
  const other = otherTable(table);
  type Partner = SlotKey & { id: number };
  const partners: Partner[] = [];
  for (const s of gone) {
    const { data, error } = await db.from(other).select("id, platform, live_date, start_time, end_time")
      .eq("platform", s.platform).eq("starts_at", s.starts_at).eq("ends_at", s.ends_at)
      .is(personColOf(other), null).gte("live_date", bkkToday());
    if (error) throw error;
    partners.push(...((data ?? []) as Partner[]));
  }
  if (!partners.length) return 0;
  const { error } = await db.from(other).delete().in("id", partners.map((p) => p.id));
  if (error) throw error;
  await deleteRowsLocked(other, partners);
  await db.from("booking_logs").insert(partners.map((p) => ({
    role: "Sheet", name: TABS[TAB_OF[table]], action: `ลบ slot คู่ (ลบแถวในแท็บ ${TABS[TAB_OF[table]]})`,
    slot_table: other, slot_id: p.id, platform: p.platform, live_date: p.live_date,
    time_range: `${hm(p.start_time)}-${hm(p.end_time)}`, result: "สำเร็จ",
  })));
  return partners.length;
}

// ---------- ลบแถวในชีต -> ลบในเว็บ ----------

/** แถวที่ไม่มีแพลตฟอร์ม/วัน/เวลาเลย (ถูกล้างข้อมูล หรือแถวว่าง) */
const isBlankRow = (tab: TabKey, r: Row) => {
  const c = COLS[tab];
  return [c.platform, c.date, c.start, c.end].every((i) => str(r[i]) === "");
};

/** รหัสที่ยังอยู่ในชีต + วัน/เวลาของแถวที่ยังไม่มีรหัส (แถวที่ล้างข้อมูลทั้งแถวแล้วไม่นับ แม้คอลัมน์ V ยังค้าง) */
function sheetContents(tab: TabKey, rows: Row[]) {
  const c = COLS[tab];
  const ids = new Set<number>(), keys = new Set<string>();
  for (const r of rows) {
    if (isBlankRow(tab, r)) continue;
    const id = Number(str(r[c.id]));
    if (Number.isInteger(id) && id > 0) ids.add(id);
    const p = parseRow(tab, r);
    if (p && !p.id) keys.add(keyOf(p));
  }
  return { ids, keys };
}

/** slot ที่เคยอยู่ในชีตแน่ๆ: นำเข้าจากชีต (sheet_row) หรือเคยเขียนลงชีตสำเร็จแล้ว */
async function everInSheet(table: Table, ids: number[]) {
  const db = createAdminClient();
  const out = new Set<number>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [imported, written] = await Promise.all([
      db.from(table).select("id").in("id", part).not("sheet_row", "is", null),
      db.from("sheet_jobs").select("slot_id").eq("slot_table", table).in("slot_id", part).not("done_at", "is", null),
    ]);
    if (imported.error) throw imported.error;
    if (written.error) throw written.error;
    for (const x of imported.data ?? []) out.add(x.id);
    for (const x of written.data ?? []) out.add(x.slot_id);
  }
  return out;
}

/**
 * ลบ slot ที่ถูกลบแถวในชีตออกจาก DB (เฉพาะตั้งแต่วันนี้ ของเก่าเก็บไว้ให้สรุปรายเดือน)
 * ลบ event ในปฏิทินก่อน แล้วให้ slot คู่ของอีกฝั่งอัปเดตหมายเหตุใน event
 */
async function deleteGoneSlots(table: Table, ids: number[]) {
  const db = createAdminClient();
  const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
  type Gone = SlotKey & {
    id: number; starts_at: string; ends_at: string; calendar_email: string | null; calendar_event_id: string | null;
  } & Record<string, unknown>;
  const rows: Gone[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from(table)
      .select(`id, platform, live_date, start_time, end_time, starts_at, ends_at, ${personCol}, calendar_email, calendar_event_id`)
      .in("id", ids.slice(i, i + 200)).gte("live_date", bkkToday());
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Gone[]));
  }
  if (!rows.length) return 0;

  const calendarFailed = new Set<number>();
  for (const s of rows) {
    if (!s.calendar_email || !s.calendar_event_id) continue;
    try {
      await deleteCalendarEvent(s.calendar_email, s.calendar_event_id);
    } catch (err) {
      calendarFailed.add(s.id);
      console.warn(`ลบ event ของ slot ${s.id} ไม่สำเร็จ:`, err);
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).delete().in("id", rows.slice(i, i + 200).map((s) => s.id));
    if (error) throw error;
  }
  await removeFreePartners(table, rows);

  // slot คู่ของอีกฝั่ง: หมายเหตุใน event มีชื่อคนของ slot ที่ถูกลบ
  const other: Table = table === "mc_slots" ? "admin_slots" : "mc_slots";
  const otherCol = other === "mc_slots" ? "mc_id" : "admin_id";
  const partnerJobs: { slot_table: Table; slot_id: number }[] = [];
  for (const s of rows.filter((x) => x[personCol])) {
    const { data } = await db.from(other).select("id")
      .eq("platform", s.platform).eq("starts_at", s.starts_at).eq("ends_at", s.ends_at).not(otherCol, "is", null);
    for (const p of data ?? []) partnerJobs.push({ slot_table: other, slot_id: p.id });
  }
  if (partnerJobs.length) await db.from("calendar_jobs").insert(partnerJobs);

  await db.from("booking_logs").insert(rows.map((s) => ({
    role: "Sheet", name: TABS[table === "mc_slots" ? "mc" : "admin"], action: "ลบ slot (ลบแถวในชีต)",
    slot_table: table, slot_id: s.id, platform: s.platform, live_date: s.live_date,
    time_range: `${hm(s.start_time)}-${hm(s.end_time)}`,
    result: calendarFailed.has(s.id) ? "ลบแล้ว แต่ลบ event ในปฏิทินไม่สำเร็จ" : "สำเร็จ",
  })));
  console.log(`ลบ slot ที่ถูกลบแถวในชีต (${table}): ${rows.map((s) => s.id).join(", ")}`);
  return rows.length;
}

/**
 * หา slot ตั้งแต่วันนี้ที่เคยอยู่ในชีตแต่ตอนนี้ไม่มีแถวแล้ว แล้วลบออกจาก DB (เรียกภายใต้ล็อกชีต)
 * ข้าม slot ที่เว็บเพิ่งสร้าง/แก้แต่ยังไม่ได้เขียนลงชีต
 */
async function removeMissing(tab: TabKey, rows: Row[]) {
  const db = createAdminClient();
  const table = TABLE_OF[tab];
  type Future = SlotKey & { id: number };
  const future: Future[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("id, platform, live_date, start_time, end_time")
      .gte("live_date", bkkToday()).order("id").range(from, from + 999);
    if (error) throw error;
    future.push(...((data ?? []) as Future[]));
    if (!data || data.length < 1000) break;
  }

  const present = sheetContents(tab, rows);
  const missing = future.filter((s) => !present.ids.has(s.id) && !present.keys.has(keyOf(s))).map((s) => s.id);
  if (!missing.length) return 0;

  const known = await everInSheet(table, missing);
  const pending = new Set<number>();
  for (let i = 0; i < missing.length; i += 200) {
    const { data: jobs, error } = await db.from("sheet_jobs").select("slot_id")
      .eq("slot_table", table).is("done_at", null).in("slot_id", missing.slice(i, i + 200));
    if (error) throw error;
    for (const j of jobs ?? []) pending.add(j.slot_id);
  }
  const gone = missing.filter((id) => known.has(id) && !pending.has(id));
  if (!gone.length) return 0;

  // กันพลาด: ถ้าหายไปเกินครึ่ง อาจอ่านชีตผิด/คอลัมน์ V ถูกล้าง ไม่ลบให้อัตโนมัติ
  if (gone.length > 20 && gone.length > future.length / 2) {
    throw new Error(
      `slot ในแท็บ "${TABS[tab]}" หายจากชีต ${gone.length} จาก ${future.length} slot ` +
      "ระบบจึงไม่ลบให้อัตโนมัติ (ตรวจว่าคอลัมน์ V ไม่ถูกลบ) ถ้าตั้งใจลบจริง ให้ลบใน \"จัดการ slot\" ของเว็บ",
    );
  }
  return deleteGoneSlots(table, gone);
}

/** เรียกเมื่อมีการลบแถวในแท็บ (Apps Script onChange) / ซิงค์ทั้งหมด / cron */
export async function removeSlotsDeletedInSheet(tab: TabKey) {
  const result = await withSheetLock(async () => removeMissing(tab, await readTab(tab)));
  if (result === null) throw new Error("ระบบกำลังซิงค์ชีตอยู่ กรุณาลองใหม่อีกครั้ง");
  return { removed: result };
}

// ---------- ชีต -> เว็บ ----------

type Field = "platform" | "date" | "start" | "end" | "campaign" | "person" | "confirm" | "status" | "remark";
const FIELDS: Field[] = ["platform", "date", "start", "end", "campaign", "person", "confirm", "status", "remark"];

/**
 * อัปเดต DB ตามแถวในชีต
 *   rowNumbers: เลขแถว (เริ่ม 1) ที่ถูกแก้ ไม่ระบุ = ทุกแถว (ซิงค์ทั้งหมด)
 *   cols: ช่วงคอลัมน์ที่ถูกแก้ (เริ่ม 1) ใช้อัปเดตเฉพาะฟิลด์นั้น ไม่ทับค่าที่เว็บเพิ่งเปลี่ยนในช่องอื่น
 */
export async function applySheetEdits(tab: TabKey, rowNumbers?: number[], cols?: [number, number]) {
  const result = await withSheetLock(async () => {
    const db = createAdminClient();
    const table = TABLE_OF[tab];
    const c = COLS[tab];
    const all = await readTab(tab);
    const targets = (rowNumbers ?? all.map((_, i) => i + 1))
      .map((r) => ({ r, p: parseRow(tab, all[r - 1] ?? []) }))
      .filter((x): x is { r: number; p: SheetSlot } => !!x.p);

    // ฟิลด์ที่อยู่ในช่วงคอลัมน์ที่ถูกแก้
    const colOf: Record<Field, number> = {
      platform: c.platform, date: c.date, start: c.start, end: c.end,
      campaign: tab === "mc" ? COLS.mc.campaign : -1, person: c.person, confirm: c.confirm, status: c.status, remark: c.remark,
    };
    const fields = FIELDS.filter((f) => colOf[f] >= 0 && (!cols || (colOf[f] + 1 >= cols[0] && colOf[f] + 1 <= cols[1])));

    const ids = targets.map((x) => x.p.id).filter((x): x is number => !!x);
    const slots = rowNumbers ? await loadSlots(table, ids) : await loadSlots(table);

    // ซิงค์ทั้งหมด: ข้าม slot ที่เว็บเพิ่งเปลี่ยนแต่ยังไม่ได้เขียนลงชีต (ไม่งั้นค่าในเว็บจะถูกทับ)
    const pending = new Set<number>();
    if (!rowNumbers) {
      const { data } = await db.from("sheet_jobs").select("slot_id").eq("slot_table", table).is("done_at", null);
      for (const j of data ?? []) pending.add(j.slot_id);
    }

    // รายชื่อคน (ชื่อ -> id) สร้างให้ถ้ายังไม่มี (เหมือนตอนนำเข้า)
    const role = tab === "mc" ? "mc" : "admin";
    const { data: staffRows, error: staffErr } = await db.from("staff").select("id, name").eq("role", role);
    if (staffErr) throw staffErr;
    const staffId = new Map((staffRows ?? []).map((s) => [s.name, s.id as number]));
    const missing = [...new Set(targets.map((x) => x.p.person).filter((n) => n && !staffId.has(n)))];
    if (missing.length) {
      const { data, error } = await db.from("staff").insert(missing.map((name) => ({ role, name }))).select("id, name");
      if (error) throw error;
      for (const s of data ?? []) staffId.set(s.name, s.id);
    }

    const personCol = tab === "mc" ? "mc_id" : "admin_id";
    const toRow = (p: SheetSlot, only: Field[]) => {
      const row: Record<string, unknown> = {};
      if (only.includes("platform")) row.platform = p.platform;
      if (only.includes("date")) row.live_date = p.live_date;
      if (only.includes("start")) row.start_time = p.start_time;
      if (only.includes("end")) row.end_time = p.end_time;
      if (only.includes("campaign") && tab === "mc") row.campaign = p.campaign;
      if (only.includes("person")) row[personCol] = p.person ? staffId.get(p.person) ?? null : null;
      if (only.includes("confirm")) row.confirmed = p.confirmed;
      if (only.includes("status")) row.status = p.status;
      if (only.includes("remark")) row.remark = p.remark;
      return row;
    };
    const differs = (s: DbSlot, row: Record<string, unknown>) => Object.entries(row).some(([k, v]) => {
      const cur: unknown = {
        platform: s.platform, live_date: s.live_date, start_time: s.start_time, end_time: s.end_time,
        campaign: s.campaign ?? "", [personCol]: s.personId, confirmed: s.confirmed, status: s.status, remark: s.remark,
      }[k];
      return (cur ?? null) !== (v ?? null);
    });

    let updated = 0, created = 0, paired = 0;
    const calendar: { slot_table: Table; slot_id: number }[] = [];
    const idWrites: sheets_v4.Schema$ValueRange[] = [];
    // แถวคัดลอกที่ติดรหัสของแถวอื่นมา = slot ใหม่ (สร้างใหม่แล้วเขียนรหัสใหม่ทับ) ไม่ใช่การแก้ slot เดิม
    const owner = duplicateOwners(tab, all, slots);
    const present = sheetContents(tab, all);

    for (const { r, p } of targets) {
      if (p.id && owner.has(p.id) && owner.get(p.id) !== r) {
        console.warn(`แถว ${r} ในแท็บ ${TABS[tab]} มีรหัส ${p.id} ซ้ำกับแถว ${owner.get(p.id)} จึงสร้างเป็น slot ใหม่`);
        p.id = null;
      }
      // แก้แถวที่รหัสไม่มีในระบบแล้ว (เช่น ลบแถวแล้วกดย้อนกลับ) = สร้าง slot ใหม่ให้แถวนี้
      if (p.id && rowNumbers && !slots.has(p.id)) {
        console.warn(`แถว ${r} ในแท็บ ${TABS[tab]} มีรหัส ${p.id} ที่ไม่มีในระบบแล้ว จึงสร้างเป็น slot ใหม่`);
        p.id = null;
      }
      if (p.id) {
        const s = slots.get(p.id);
        if (!s || pending.has(p.id)) continue; // ลบในเว็บแล้ว / เว็บเพิ่งแก้
        const row = toRow(p, fields);
        if (!Object.keys(row).length || !differs(s, row)) continue;
        const { error } = await db.from(table).update(row).eq("id", p.id);
        if (error) throw error;
        calendar.push({ slot_table: table, slot_id: p.id });
        updated++;
        if (rowNumbers) await mirrorKeyChange(table, s, row);
      } else {
        // มี slot นี้อยู่แล้วแต่ยังไม่มีแถวในชีต (เช่น ระบบเพิ่งสร้างเป็นแถวคู่ให้ แต่ยังเขียนลงชีตไม่ทัน)
        // = ผูกแถวนี้กับ slot เดิม ไม่สร้างซ้ำ
        const { data: same, error: sameErr } = await db.from(table).select("id")
          .eq("platform", p.platform).eq("live_date", p.live_date).eq("start_time", p.start_time).eq("end_time", p.end_time);
        if (sameErr) throw sameErr;
        const unplaced = (same ?? []).find((x) => !present.ids.has(x.id));
        let id: number;
        if (unplaced) {
          id = unplaced.id;
          const { error } = await db.from(table).update(toRow(p, FIELDS)).eq("id", id);
          if (error) throw error;
          updated++;
        } else {
          const { data, error } = await db.from(table).insert(toRow(p, FIELDS)).select("id").single();
          if (error) throw error;
          id = data.id;
          created++;
          if (rowNumbers) paired += await mirrorNewSlot(table, p);
        }
        present.ids.add(id);
        idWrites.push({ range: `'${TABS[tab]}'!${colLetter(c.id)}${r}`, values: [[id]] });
        // slot เดิมอาจมีคนอยู่แล้ว (มี event ในปฏิทิน) -> sync ปฏิทินเสมอ
        if (p.person || unplaced) calendar.push({ slot_table: table, slot_id: id });
      }
    }

    if (idWrites.length) {
      await sheetsApi().spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: "RAW", data: idWrites },
      });
    }
    if (calendar.length) await db.from("calendar_jobs").insert(calendar);

    // ซิงค์ทั้งหมด หรือมีแถวถูกล้างข้อมูลทั้งแถว (เลือกแถวแล้วกด Delete ซึ่งรหัสในคอลัมน์ V อาจหายไปด้วย)
    // = ตรวจหา slot ที่ไม่มีแถวในชีตแล้วลบออก
    const cleared = rowNumbers?.some((r) => isBlankRow(tab, all[r - 1] ?? [])) ?? true;
    const removed = cleared ? await removeMissing(tab, all) : 0;
    return { updated, created, removed, paired };
  });
  if (!result) throw new Error("ระบบกำลังซิงค์ชีตอยู่ กรุณาลองใหม่อีกครั้ง");
  return result;
}
