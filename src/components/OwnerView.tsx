"use client";

import { Fragment, useEffect, useState } from "react";
import type { OwnerDetail, OwnerPerson, OwnerSummary, ProofInfo } from "@/lib/types";
import { fmtDayMonth, fmtDayShort, monthKey, monthLabel, money, num, parseKey } from "@/lib/format";
import { fmtGmv } from "@/lib/gmv";
import { bonusPaidMinutes, lateCut, tiersLabel } from "@/lib/pay";
import { ChevronRightIcon } from "lucide-react";
import { SortHead, sortRows, STICKY_CELL, STICKY_HEAD, type SortState } from "@/components/SortHead";
import type { Cell, ExportBook, ExportSheet, RowStyle } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import { LoadError, LoadingBlock, MonthNav, Notice, Stats, api } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Type = "Mc" | "Admin";

/** อัตราค่าจ้างต่อชั่วโมง: รายคน ถ้าไม่มีใช้ค่าเริ่มต้น */
function rateOf(data: OwnerSummary, type: Type, name: string) {
  const own = type === "Mc" ? data.rates.mc : data.rates.admin;
  return own[name] || (type === "Mc" ? data.rates.defaultMc : data.rates.defaultAdmin) || 0;
}

/** ชั่วโมงรายวันของคนหนึ่ง (ไม่นับคิวที่ยกเลิก) */
function dailyOf(data: OwnerSummary, type: Type, name: string) {
  const byDate = new Map<string, { date: string; slots: number; hours: number }>();
  for (const d of data.details) {
    if (d.type !== type || d.name !== name || d.cancelled) continue;
    const x = byDate.get(d.date) ?? { date: d.date, slots: 0, hours: 0 };
    x.slots++;
    x.hours += d.hours;
    byDate.set(d.date, x);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const shortTime = (t: string) => String(t || "").replace(/^0(\d):/, "$1:");
const round2 = (n: number) => Math.round(n * 100) / 100;

// หลักฐานไลฟ์: เวลาเริ่ม–จบจริง (เวลาไทย) + ลิงก์เปิดรูป
const hms = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const proofTime = (p: ProofInfo) => `${hms.format(new Date(p.startedAt))}–${hms.format(new Date(p.endedAt))}`;
const proofUrl = (p: ProofInfo) => `/api/proofs/image?id=${p.id}`;

/** นาทีสายสำหรับไฟล์ที่ส่งออก เช่น "12" / "10 (จากหลักฐาน)" */
const lateText = (d: OwnerDetail) => (d.lateMinutes ? `${d.lateMinutes}${d.lateFromProof ? " (จากหลักฐาน)" : ""}` : "");

/** ลิงก์โฟลเดอร์ Drive ที่รวมหลักฐานทั้งเดือนของ Mc (จากคิวไหนก็ได้ที่อัปขึ้น Drive แล้ว) */
const monthFolderOf = (items: OwnerDetail[]) => items.find((d) => d.proof?.driveFolderUrl)?.proof?.driveFolderUrl ?? null;
const monthFolderText = (items: OwnerDetail[]) =>
  monthFolderOf(items)
    ?? (items.length && items.every((d) => d.noProof) ? "ไม่ต้องแนบ (Mc ประจำ)"
      : items.some((d) => d.proof?.driveUrl) ? "อยู่ใน Drive แล้ว (ดูลิงก์รายคิว)"
        : items.some((d) => d.proof) ? "ยังไม่ได้อัปขึ้น Drive" : "ยังไม่มีหลักฐาน");

/** คิวที่ไม่ถูกยกเลิกของคนหนึ่ง เรียงตามเวลา */
const slotsOf = (data: OwnerSummary, type: Type, name: string) =>
  data.details.filter((d) => d.type === type && d.name === name && !d.cancelled).sort((a, b) => a.startMs - b.startMs);
/** คิวที่ยกเลิกของคนหนึ่ง ("แคน" ในชีต + กดยกเลิกผ่านเว็บ) */
const cancelsOf = (data: OwnerSummary, type: Type, name: string) =>
  data.details.filter((d) => d.type === type && d.name === name && d.cancelled).sort((a, b) => a.startMs - b.startMs);
const fmtAt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
/** ยกเลิกล่วงหน้านานแค่ไหน เช่น "19 วัน" / "5 ชม." */
const leadText = (msBefore: number) =>
  msBefore >= 86400_000 ? `${Math.floor(msBefore / 86400_000)} วัน` : `${Math.max(0, Math.round(msBefore / 3600_000))} ชม.`;
const cancelText = (d: OwnerDetail) => (d.cancelledAt
  ? `ยกเลิกผ่านเว็บ ${fmtAt.format(new Date(d.cancelledAt))} (ก่อนไลฟ์ ${leadText(d.startMs - Date.parse(d.cancelledAt))})`
  : `${d.status || "แคน"} (ในชีต)`);
/** ยอด GMV รวมของคิว (เฉพาะ slot ที่กรอกแล้ว) count = จำนวน slot ที่กรอก หรือรวมอยู่ในยอดของ slot ถัดไป (ไลฟ์ต่อเนื่องคนเดียว) */
const gmvOf = (items: OwnerDetail[]) => {
  const filled = items.filter((d) => d.gmv !== null);
  return { total: filled.reduce((a, d) => a + d.gmv!, 0), count: filled.length + items.filter((d) => d.gmv === null && d.gmvCoveredBy).length };
};

// ---------- ส่งออก (Microsoft Excel / Google Sheet ผ่าน ExportMenu) ----------

/** ตารางเดียว -> ไฟล์ (แผ่นงานเดียว แถวแรกเป็นหัวตาราง) */
const book = (title: string, sheet: string, rows: unknown[][]): ExportBook =>
  ({ title, sheets: [{ name: sheet, rows: rows as Cell[][] }] });

// เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (ใช้ทั้งตารางบนหน้าจอและไฟล์ที่ส่งออก)
const groups = (data: OwnerSummary): [Type, OwnerPerson[]][] => {
  const out: [Type, OwnerPerson[]][] = [];
  if (data.scope?.mc !== false) out.push(["Mc", data.mc]);
  if (data.scope?.admin !== false) out.push(["Admin", data.admin]);
  return out;
};
// ฝั่งที่ดูได้อย่างเดียว: เซิร์ฟเวอร์ไม่ส่งค่าจ้าง / Commit มา -> ซ่อนคอลัมน์เงิน
const payHiddenOf = (data: OwnerSummary, type: Type) => !!data.payHidden?.[type === "Mc" ? "mc" : "admin"];
const payHiddenAll = (data: OwnerSummary) => groups(data).every(([t]) => payHiddenOf(data, t));
const dropCols = (rows: unknown[][], cols: number[]) => rows.map((r) => r.filter((_, i) => !cols.includes(i)));

/** GMV/ชม. ของคิวที่มียอด (กรอกเอง หรือรวมอยู่ในยอดของคิวถัดไป) */
const gmvPerHour = (items: OwnerDetail[]) => {
  const g = gmvOf(items);
  const hours = items.filter((d) => d.gmv !== null || d.gmvCoveredBy).reduce((a, d) => a + d.hours, 0);
  return g.count && hours ? round2(g.total / hours) : "";
};

function summaryBook(data: OwnerSummary) {
  const rows: unknown[][] = [[
    "ประเภท", "ชื่อ", "จำนวน slot", "ชั่วโมงรวม", "จำนวนวัน", "ยกเลิก", "slot ที่สาย", "ไลฟ์ชดเชย (นาที)",
    "หลักฐาน (แนบแล้ว/ต้องแนบ)", "GMV", "GMV/ชม.", "ชม. ช่วง Campaign",
    "ชั่วโมงที่ได้เงิน", "Commit", "ค่าจ้าง/ชม.", "ยอดเงิน",
  ]];
  for (const [type, people] of groups(data)) for (const r of people) {
    const rate = rateOf(data, type, r.name);
    const commit = r.commit
      ? `${tiersLabel(r.commit.baseRate, r.commit.tiers)} (${r.commit.tier ? `ถึง ${r.commit.tier.hours}+ ชม.` : "ยังไม่ถึงเทียร์แรก"})`
      : "";
    const items = slotsOf(data, type, r.name);
    const need = items.filter((d) => !d.noProof); // ไม่นับคิวของ Mc ประจำ (ไม่ต้องแนบ)
    const gmv = gmvOf(items);
    rows.push([
      type, r.name, r.slots, r.hours, r.days, r.cancelled, r.lateSlots, r.bonusMinutes || "",
      need.length ? `${need.filter((d) => d.proof).length}/${need.length}` : "ไม่ต้องแนบ",
      gmv.count ? round2(gmv.total) : "", gmvPerHour(items),
      round2(items.filter((d) => d.campaign).reduce((a, d) => a + d.hours, 0)) || "",
      r.paidHours, commit, rate || "", rate ? Math.round(r.paidHours * rate) : "",
    ]);
  }
  return book(`GLORY สรุป ${data.month}`, "สรุป", payHiddenAll(data) ? dropCols(rows, [13, 14, 15]) : rows);
}

// ใบสรุปค่าจ้างรายคน: ทุกคิวของแต่ละคน + แถวรวมต่อคน (ไม่นับคิวที่ยกเลิก หักมาสายตามกฎ + ไลฟ์ชดเชย)
function payrollBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ชื่อ", "Platform", "วันที่", "เริ่ม", "จบ", "Campaign", "ชั่วโมง", "สาย (นาที)", "หัก", "ชดเชย (นาที)", "ค่าจ้าง/ชม.", "ยอดเงิน", "GMV", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)"]];
  for (const [type, people] of groups(data)) {
    let groupHours = 0, groupMoney = 0, groupGmv = 0, groupGmvCount = 0;
    for (const p of people) {
      const rate = rateOf(data, type, p.name);
      const items = slotsOf(data, type, p.name);
      if (!items.length) continue;
      const gmv = gmvOf(items);
      let h = 0, paid = 0;
      for (const d of items) {
        const hrs = round2(d.hours);
        const cut = lateCut(d.lateMinutes);
        const bonus = bonusPaidMinutes(d.bonusMinutes);
        const slotPaid = hrs * (1 - cut) + bonus / 60;
        h += hrs;
        paid += slotPaid;
        rows.push([
          p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end), d.campaign, hrs,
          lateText(d), cut ? `${Math.round(cut * 100)}%` : "",
          bonus ? `+${d.bonusMinutes} (คิด ${bonus})${d.bonusFromProof ? " จากหลักฐาน" : ""}` : "", rate || "", rate ? Math.round(slotPaid * rate) : "",
          d.gmv ?? (d.gmvCoveredBy ? `รวมในคิว ${d.gmvCoveredBy}` : ""),
          d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "ยังไม่มีหลักฐาน",
          d.proof?.by ?? "",
          d.proof ? d.proof.driveUrl ?? "ยังไม่ได้อัปขึ้น Drive" : "",
        ]);
      }
      const m = rate ? Math.round(paid * rate) : 0;
      rows.push([
        `รวม ${p.name}`, `${items.length} slot`, "", "", "", "", round2(h), "", "", "", "", rate ? m : "",
        gmv.count ? round2(gmv.total) : "", "", "",
        // คอลัมน์ O: โฟลเดอร์รวมหลักฐานทั้งเดือนของ Mc คนนี้ใน Google Drive
        type === "Mc" ? monthFolderText(items) : "",
      ], []);
      groupHours += h;
      groupMoney += m;
      groupGmv += gmv.total;
      groupGmvCount += gmv.count;
    }
    rows.push([
      `รวม ${type} ทั้งหมด`, "", "", "", "", "", round2(groupHours), "", "", "", "", groupMoney || "", groupGmvCount ? round2(groupGmv) : "",
    ], []);
  }
  return payHiddenAll(data)
    ? book(`GLORY ใบสรุปรายคน ${data.month}`, "สรุปรายคน", dropCols(rows, [10, 11]))
    : book(`GLORY ใบสรุปค่าจ้างรายคน ${data.month}`, "ค่าจ้างรายคน", rows);
}

// ---------- ไฟล์เบิก: รายคน (Mc / Admin) + ตารางคุม Advance Payment (หน้าตาเดียวกับเอกสารที่ทีมใช้) ----------

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-01" -> "1/9/2026" */
const dmy = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}/${d.slice(0, 4)}`;
/** วันที่จัดทำ เช่น "10 Oct 2026" (เวลาไทย) */
const madeOn = () => {
  const t = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  return `${Number(t.slice(8))} ${MONTHS_EN[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}`;
};
const BORDER: RowStyle = { bg: "FFFFFF", border: true };
/** สีช่อง channel ตามชีตที่ทีมใช้ */
const CHANNEL_STYLE: Record<string, RowStyle> = {
  "GLORY VITAL": { bg: "F4CCCC", border: true, align: "center" },
  "GLORY MALL": { bg: "F4CCCC", border: true, align: "center" },
  "Cherry Glory": { bg: "FFFF00", border: true, align: "center" },
  "Skin Expert": { bg: "93C47D", color: "FFFFFF", border: true, align: "center" },
  Shopee: { bg: "F6B26B", border: true, align: "center" },
};
const channelStyle = (p: string) => CHANNEL_STYLE[p.trim()] ?? { bg: "EFEFEF", border: true, align: "center" as const };

/** เงินของคิว (หักมาสาย + ไลฟ์ชดเชย) ปัดเป็นบาท */
const slotMoney = (d: OwnerDetail, rate: number) =>
  Math.round((round2(d.hours) * (1 - lateCut(d.lateMinutes)) + bonusPaidMinutes(d.bonusMinutes) / 60) * rate);
/** หมายเหตุของคิว: หมายเหตุในชีต + สาย / ชดเชย */
const claimRemark = (d: OwnerDetail) => [
  d.remark ?? "",
  d.lateMinutes && lateCut(d.lateMinutes) ? `สาย ${d.lateMinutes} นาที หัก ${Math.round(lateCut(d.lateMinutes) * 100)}%` : "",
  bonusPaidMinutes(d.bonusMinutes) ? `ชดเชย +${d.bonusMinutes} นาที` : "",
].filter(Boolean).join(" · ");

/**
 * สรุปรายละเอียดชั่วโมงทำงาน (รายคน): หัวเรื่องแถบดำ / แถวละคิว ช่อง channel ใส่สีตามช่อง / แถวสุดท้ายของแต่ละคน = Total + GMV
 *   เฉพาะคนที่มีค่าจ้างรายชั่วโมง (Mc ประจำที่ได้เงินเดือนไม่อยู่ในไฟล์เบิก)
 */
function claimSheet(data: OwnerSummary, type: Type): ExportSheet | null {
  const [y, m] = data.month.split("-").map(Number);
  const first = `${data.month}-01`, last = `${data.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const people = (type === "Mc" ? data.mc : data.admin)
    .map((p) => ({ p, rate: rateOf(data, type, p.name), items: slotsOf(data, type, p.name) }))
    .filter((x) => x.items.length && x.rate > 0)
    .sort((a, b) => a.p.name.localeCompare(b.p.name, "th"));
  const skipped = (type === "Mc" ? data.mc : data.admin).filter((p) => !rateOf(data, type, p.name) && slotsOf(data, type, p.name).length);
  if (!people.length) return null;
  const channels = new Set(people.flatMap((x) => x.items.map((d) => d.platform)));
  const where = channels.has("Shopee") && channels.size > 1 ? "Tiktok / Shopee" : channels.has("Shopee") ? "Shopee" : "Tiktok";

  const rows: Cell[][] = [
    ["", `สรุปรายละเอียดชั่วโมงทำงาน ${type === "Mc" ? "MC" : "ADMIN"} LIVESTREAMING ${where} รอบ ${dmy(first)} - ${dmy(last)}`],
    [madeOn(), "ชื่อ", "Name", "channel", "วันที่ live", "เวลาที่ live", "เวลาที่ ลง live", "รวมเป็น ชั่วโมง", "ราคาต่อชั่วโมง", "รวมเป็นเงิน", "Total", "จำนวน GMV ที่ได้", "remark"],
  ];
  const rowStyles: Record<number, RowStyle> = {
    0: { bg: "000000", color: "FFFFFF", bold: true },
    1: { bg: "F3F3F3", bold: true, border: true },
  };
  const cellStyles: Record<string, RowStyle> = {};
  let grand = 0, grandGmv = 0, grandHours = 0;
  for (const { p, rate, items } of people) {
    let total = 0;
    const gmv = gmvOf(items);
    items.forEach((d, i) => {
      const money_ = slotMoney(d, rate);
      total += money_;
      const lastRow = i === items.length - 1;
      cellStyles[`${rows.length}:3`] = channelStyle(d.platform);
      rows.push([
        "", i === 0 ? p.name : "", p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end),
        round2(d.hours), { v: rate, f: "int" }, { v: money_, f: "int" },
        lastRow ? { v: total, f: "money" } : null, lastRow && gmv.count ? { v: round2(gmv.total), f: "money" } : null, claimRemark(d),
      ]);
    });
    grand += total;
    grandGmv += gmv.count ? gmv.total : 0;
    grandHours += items.reduce((a, d) => a + d.hours, 0);
    rows.push([]);
  }
  rowStyles[rows.length] = { bg: "F3F3F3", bold: true, border: true };
  rows.push(["", `รวม ${type} ทั้งหมด`, `${people.length} คน`, "", "", "", "", round2(grandHours), "", "", { v: grand, f: "money" }, grandGmv ? { v: round2(grandGmv), f: "money" } : null, ""]);
  if (skipped.length) rows.push([], ["", `ไม่อยู่ในไฟล์เบิก (ไม่มีค่าจ้างรายชั่วโมง เช่น Mc ประจำ): ${skipped.map((p) => p.name).join(", ")}`]);
  return {
    name: `รายคน ${type}`, rows, header: 1, rowStyles, cellStyles,
    colWidths: [12, 14, 14, 14, 10, 10, 12, 10, 12, 12, 13, 16, 26],
  };
}

/** ตารางคุม Advance Payment ประจำเดือน: วันละแถว จ่าย = ค่าตัว Mc + Admin ของวันนั้น / WHT 3% / ก่อน VAT = จ่าย - WHT */
function advanceSheet(data: OwnerSummary, requester: string): ExportSheet | null {
  const byDate = new Map<string, { mc: number; admin: number }>();
  for (const [type, people] of groups(data)) for (const p of people) {
    const rate = rateOf(data, type, p.name);
    if (!rate) continue;
    for (const d of slotsOf(data, type, p.name)) {
      const x = byDate.get(d.date) ?? { mc: 0, admin: 0 };
      x[type === "Mc" ? "mc" : "admin"] += slotMoney(d, rate);
      byDate.set(d.date, x);
    }
  }
  const days = [...byDate].filter(([, x]) => x.mc + x.admin > 0).sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) return null;
  const WHT = 0.03;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows: Cell[][] = [
    ["", "GLORY VITAL", "", "", "ตารางคุม Advance Payment"],
    ["", "", "", "", `ประจำเดือน ${monthLabel(data.month)}`],
    ["", "", "", "", "", "", "ชื่อผู้เบิกเงินทดรองจ่าย", requester],
    ["NO", "Date", "Department", "Sup. /Name", "Description", "จ่าย", "ก่อน VAT", "WHT 3%", "Balance"],
  ];
  const rowStyles: Record<number, RowStyle> = { 3: { bg: "D9D9D9", bold: true, border: true, align: "center" } };
  const cellStyles: Record<string, RowStyle> = {
    "0:1": { bg: "FFFFFF", color: "C2185B", bold: true },
    "0:4": { bg: "FFFFFF", bold: true, align: "center" },
    "1:4": { bg: "FFFFFF", bold: true, align: "center" },
    "2:6": { bg: "FFFFFF", bold: true, align: "right" },
    "2:7": { bg: "FFFFFF", bold: true },
  };
  let total = 0;
  days.forEach(([date, x], i) => {
    const pay = x.mc + x.admin;
    total += pay;
    const r = rows.length;
    for (const c of [0, 1, 2]) cellStyles[`${r}:${c}`] = { ...BORDER, align: "center" };
    rowStyles[r] = BORDER;
    rows.push([
      i + 1, dmy(date), "Live", "", `ค่าตัว ${[x.mc ? "Mc Live" : "", x.admin ? "Admin Live" : ""].filter(Boolean).join(",")}`,
      { v: pay, f: "money" }, { v: r2(pay * (1 - WHT)), f: "money" }, { v: r2(pay * WHT), f: "money" }, "-",
    ]);
  });
  rowStyles[rows.length] = { bg: "F3F3F3", bold: true, border: true };
  rows.push(["", "", "", "", "รวม", { v: total, f: "money" }, { v: r2(total * (1 - WHT)), f: "money" }, { v: r2(total * WHT), f: "money" }, "-"]);
  rows.push([]);
  cellStyles[`${rows.length}:4`] = { bg: "FFFFFF", bold: true, align: "center" };
  rows.push(["", "", "", "", `รวม ค่าใช้จ่าย  ${money(total)}  บาท`]);
  rows.push([], [], ["", "........................................", "", "", "........................................", "", "........................................"]);
  rows.push(["", "(ผู้จัดทำ)", "", "", "(ผู้ตรวจสอบ)", "", "(ผู้อนุมัติ)"]);
  return { name: "Advance Payment", rows, header: -1, rowStyles, cellStyles, colWidths: [6, 12, 12, 14, 32, 14, 14, 14, 12] };
}

/** ไฟล์เบิก: รายคน Mc / รายคน Admin / ตารางคุม Advance Payment (เฉพาะฝั่งที่มีสิทธิ์) */
function claimBook(data: OwnerSummary, requester: string): ExportBook {
  const sheets = [
    ...groups(data).map(([type]) => claimSheet(data, type)),
    advanceSheet(data, requester),
  ].filter((s): s is ExportSheet => !!s);
  if (!sheets.length) throw new Error("เดือนนี้ไม่มีคิวที่มีค่าจ้างให้เบิก");
  return { title: `GLORY ไฟล์เบิก ${monthLabel(data.month)}`, sheets };
}

// ตาราง คน x วันที่: แต่ละช่อง = ชั่วโมงของวันนั้น, ท้ายแถว = รวมชั่วโมงและจำนวนวัน
function dailyBook(data: OwnerSummary) {
  const [y, m] = data.month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const header: unknown[] = ["ประเภท", "ชื่อ"];
  for (let d = 1; d <= daysInMonth; d++) header.push(`${d}/${m}`);
  header.push("รวมชั่วโมง", "จำนวนวัน", "จำนวน slot");
  const rows = [header];
  for (const [type, people] of groups(data)) for (const p of people) {
    const perDay: Record<number, number> = {};
    for (const x of dailyOf(data, type, p.name)) perDay[Number(x.date.slice(8, 10))] = x.hours;
    const line: unknown[] = [type, p.name];
    for (let d = 1; d <= daysInMonth; d++) line.push(perDay[d] ? round2(perDay[d]) : "");
    line.push(p.hours, p.days, p.slots);
    rows.push(line);
  }
  return book(`GLORY รายคน-รายวัน ${data.month}`, "รายคน-รายวัน", rows);
}

function detailBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "วันที่", "เริ่ม", "จบ", "Platform", "Campaign", "ชั่วโมง", "GMV", "คู่ (Admin/Mc)", "สถานะ", "สาย (นาที)", "ชดเชย (นาที)", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)", "ยกเลิก"]];
  for (const d of data.details) {
    rows.push([
      d.type, d.name, d.date, d.start, d.end, d.platform, d.campaign, d.hours,
      d.gmv ?? (d.gmvCoveredBy ? `รวมในคิว ${d.gmvCoveredBy}` : ""),
      d.pair, d.cancelled ? d.status || "ยกเลิก" : d.status || "",
      lateText(d), d.bonusMinutes ? `+${d.bonusMinutes}${d.bonusFromProof ? " (จากหลักฐาน)" : ""}` : "", d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "", d.proof?.by ?? "", d.proof?.driveUrl ?? "",
      d.cancelled ? cancelText(d) : "",
    ]);
  }
  return book(`GLORY รายละเอียด ${data.month}`, "รายละเอียด", rows);
}

// ---------- หน้าจอ ----------

/** requester = ชื่อผู้เบิกเงินทดรองจ่ายในไฟล์เบิก (Owner ที่กดส่งออก) */
export function OwnerView({ requester = "" }: { requester?: string }) {
  const [month, setMonth] = useState(() => monthKey());
  const [cache, setCache] = useState<Record<string, OwnerSummary>>({});
  const [failed, setFailed] = useState<{ month: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const data = cache[month];
  const error = failed?.month === month ? failed.message : "";
  const loaded = !!data;

  useEffect(() => {
    if (loaded) return;
    api<OwnerSummary>(`/api/owner?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [month]: res }));
        setFailed(null);
      })
      .catch((err) => setFailed({ month, message: (err as Error).message }));
  }, [month, loaded, attempt]);

  const nav = <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />;
  if (!data) {
    return (
      <div className="pb-10">
        {nav}
        {error ? (
          <LoadError title="โหลดสรุปไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} />
        ) : <LoadingBlock />}
      </div>
    );
  }

  const r0 = data.rates;
  const hideAll = payHiddenAll(data);
  const noRates = !hideAll && !r0.defaultMc && !r0.defaultAdmin && !Object.keys(r0.mc).length && !Object.keys(r0.admin).length;
  const sum = (rows: OwnerPerson[], k: "hours" | "slots") => rows.reduce((a, r) => a + r[k], 0);
  const onlyAdmin = data.scope?.mc === false;
  const onlyMc = data.scope?.admin === false;

  return (
    <div className="pb-10">
      {nav}
      <Stats items={onlyAdmin
        ? [[num(sum(data.admin, "hours")), "ชม. Admin"], [String(sum(data.admin, "slots")), "slot Admin"], [String(data.admin.length), "คน"]]
        : onlyMc
          ? [[num(sum(data.mc, "hours")), "ชม. Mc"], [String(sum(data.mc, "slots")), "slot Mc"], [String(data.mc.length), "คน"]]
          : [[num(sum(data.mc, "hours")), "ชม. Mc"], [num(sum(data.admin, "hours")), "ชม. Admin"], [String(sum(data.mc, "slots")), "slot Mc"]]} />
      {noRates ? (
        <Notice>
          ยังไม่ได้ตั้งค่าจ้าง: ใส่ค่าจ้างต่อชั่วโมงเริ่มต้นในตาราง settings (default_mc_rate / default_admin_rate) หรือรายคนที่ staff.hourly_rate
        </Notice>
      ) : null}
      <div className="my-3 flex flex-wrap gap-2">
        {!hideAll ? <ExportMenu variant="default" label="ไฟล์เบิก" build={() => claimBook(data, requester)} /> : null}
        <ExportMenu label={hideAll ? "ใบสรุปรายคน" : "ใบสรุปค่าจ้าง (ละเอียด)"} build={() => payrollBook(data)} />
        <ExportMenu label="รายคน-รายวัน" build={() => dailyBook(data)} />
        <ExportMenu label="สรุป" build={() => summaryBook(data)} />
        <ExportMenu label="รายละเอียด" build={() => detailBook(data)} />
      </div>
      {groups(data).map(([type, rows]) => (
        <section key={type} className="mt-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-bold">
            {type}
            <span className="text-xs font-normal text-muted-foreground">
              กดที่ชื่อเพื่อดูรายวัน · ไม่นับคิวที่ยกเลิก · {payHiddenOf(data, type) ? "ดูได้อย่างเดียว ไม่แสดงค่าจ้าง" : "ยอดเงินหักมาสาย + รวมไลฟ์ชดเชยแล้ว"}
            </span>
          </h2>
          <SumTable data={data} type={type} rows={rows} />
        </section>
      ))}
    </div>
  );
}

const SUM_COLS: [string, string][] = [
  ["slots", "slot"], ["hours", "ชั่วโมง"], ["days", "วัน"], ["cancelled", "ยกเลิก"], ["late", "สาย"],
  ["bonus", "ชดเชย"], ["proof", "หลักฐาน"], ["gmv", "GMV"], ["pay", "ยอดเงิน"],
];

function SumTable({ data, type, rows: base }: { data: OwnerSummary; type: Type; rows: OwnerPerson[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>(null);
  if (!base.length) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">ไม่มีคิวในเดือนนี้</div>;
  const showPay = !payHiddenOf(data, type);
  const cols = showPay ? SUM_COLS : SUM_COLS.filter(([k]) => k !== "pay");
  const valueOf = (r: OwnerPerson, k: string): number | string | null => {
    const items = slotsOf(data, type, r.name);
    switch (k) {
      case "name": return r.name;
      case "slots": return r.slots;
      case "hours": return r.hours;
      case "days": return r.days;
      case "cancelled": return r.cancelled;
      case "late": return r.lateSlots;
      case "bonus": return r.bonusMinutes;
      case "proof": {
        const need = items.filter((d) => !d.noProof);
        return need.length ? need.filter((d) => d.proof).length / need.length : null;
      }
      case "gmv": {
        const g = gmvOf(items);
        return g.count ? g.total : null;
      }
      case "pay": {
        const rate = rateOf(data, type, r.name);
        return rate ? rate * r.paidHours : null;
      }
      default: return null;
    }
  };
  const rows = sortRows(base, sort, valueOf);
  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name); else next.add(name);
    setOpen(next);
  };
  const ts = rows.reduce((a, r) => a + r.slots, 0);
  const th = rows.reduce((a, r) => a + r.hours, 0);
  const tm = rows.reduce((a, r) => a + rateOf(data, type, r.name) * r.paidHours, 0);
  const tl = rows.reduce((a, r) => a + r.lateSlots, 0);
  const tb = rows.reduce((a, r) => a + r.bonusMinutes, 0);
  const num_ = "text-right tabular-nums";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-[680px]">
        <TableHeader className="bg-secondary">
          <TableRow className="hover:bg-transparent">
            <SortHead k="name" label="ชื่อ" text sort={sort} setSort={setSort} className={STICKY_HEAD} />
            {cols.map(([k, h]) => <SortHead key={k} k={k} label={h} sort={sort} setSort={setSort} />)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const rate = rateOf(data, type, r.name);
            const isOpen = open.has(r.name);
            const daily = isOpen ? dailyOf(data, type, r.name) : [];
            const items = slotsOf(data, type, r.name);
            const cancels = isOpen ? cancelsOf(data, type, r.name) : [];
            const need = items.filter((d) => !d.noProof); // ไม่นับคิวของ Mc ประจำ (ไม่ต้องแนบ)
            const proved = need.filter((d) => d.proof).length;
            const gmv = gmvOf(items);
            return (
              <Fragment key={r.name}>
                <TableRow
                  tabIndex={0}
                  aria-expanded={isOpen}
                  data-state={isOpen ? "selected" : undefined}
                  onClick={() => toggle(r.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.name); } }}
                  className="cursor-pointer data-[state=selected]:bg-secondary"
                >
                  <TableCell className={cn("px-3", STICKY_CELL)}>
                    <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                    {r.name}
                    {r.commit ? (
                      <Badge
                        title={`Commit: ${tiersLabel(r.commit.baseRate, r.commit.tiers)} (ทุกชั่วโมงของเดือนคิดราคาเทียร์ที่จองถึง)`}
                        variant={r.commit.tier ? "default" : "outline"}
                        className={cn("ml-1.5 text-[11px]", r.commit.tier ? "bg-success/15 text-success" : "text-muted-foreground")}
                      >
                        {r.commit.tier
                          ? `Commit ${num(r.commit.tier.hours)}+ ชม. ✓ ${money(r.commit.tier.rate)}/ชม.`
                          : `Commit ยังไม่ถึง ${num(r.commit.tiers[0].hours)} ชม. (${num(r.hours)})`}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className={num_}>{r.slots}</TableCell>
                  <TableCell className={num_}>{num(r.hours)}</TableCell>
                  <TableCell className={num_}>{r.days}</TableCell>
                  <TableCell
                    title={r.cancelled ? "คิวที่ยกเลิก (แคนในชีต + กดยกเลิกผ่านเว็บ) กดที่ชื่อเพื่อดูว่าคิวไหน" : undefined}
                    className={cn(num_, r.cancelled && "font-semibold text-destructive")}
                  >
                    {r.cancelled || "–"}
                  </TableCell>
                  <TableCell className={cn(num_, r.lateSlots && "font-semibold text-destructive")}>{r.lateSlots || "–"}</TableCell>
                  <TableCell className={cn(num_, r.bonusMinutes && "font-semibold text-success")}>
                    {r.bonusMinutes ? `+${r.bonusMinutes} น.` : "–"}
                  </TableCell>
                  {need.length ? (
                    <TableCell
                      title="slot ที่มีหลักฐานไลฟ์ / slot ที่ต้องแนบ"
                      className={cn(num_, proved === need.length ? "text-success" : "font-semibold text-destructive")}
                    >
                      {proved}/{need.length}
                    </TableCell>
                  ) : (
                    <TableCell title="Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน" className={cn(num_, "text-xs text-muted-foreground")}>
                      {items.length ? "ไม่ต้องแนบ" : "–"}
                    </TableCell>
                  )}
                  <TableCell
                    title={gmv.count ? `กรอก GMV แล้ว ${gmv.count}/${items.length} slot` : "ยังไม่ได้กรอก GMV"}
                    className={num_}
                  >
                    {gmv.count ? fmtGmv(gmv.total) : "–"}
                  </TableCell>
                  {showPay ? <TableCell className={cn(num_, "px-3")}>{rate ? money(r.paidHours * rate) : "–"}</TableCell> : null}
                </TableRow>
                {isOpen ? (
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableCell colSpan={cols.length + 1} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
                      <div className="flex flex-wrap gap-1.5">
                        {daily.length ? daily.map((x) => (
                          <Badge key={x.date} variant="outline" className="h-auto bg-card px-2.5 py-1 font-normal">
                            <b className="font-semibold text-primary">{fmtDayShort.format(parseKey(x.date))}</b>
                            {` ${num(x.hours)} ชม.`}{x.slots > 1 ? ` (${x.slots} slot)` : ""}
                          </Badge>
                        )) : <span className="text-xs text-muted-foreground">ไม่มีคิวที่ไม่ถูกยกเลิก</span>}
                      </div>
                      {type === "Mc" && monthFolderOf(items) ? (
                        <a
                          href={monthFolderOf(items)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-primary underline"
                        >
                          เปิดโฟลเดอร์หลักฐานทั้งเดือนใน Google Drive
                        </a>
                      ) : null}
                      {items.length ? (
                        <ul className="mt-2 space-y-1 text-xs">
                          {items.map((d) => (
                            <li key={`${d.startMs}|${d.platform}`} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-semibold tabular-nums">
                                {fmtDayShort.format(parseKey(d.date))} {shortTime(d.start)}–{shortTime(d.end)}
                              </span>
                              <span className="text-muted-foreground">{d.platform}</span>
                              {lateCut(d.lateMinutes) > 0 ? (
                                <span className="font-semibold text-destructive">
                                  สาย {d.lateMinutes} น. −{Math.round(lateCut(d.lateMinutes) * 100)}%{d.lateFromProof ? " (จากหลักฐาน)" : ""}
                                </span>
                              ) : null}
                              {bonusPaidMinutes(d.bonusMinutes) > 0 ? (
                                <span className="font-semibold text-success">
                                  ชดเชย +{d.bonusMinutes} น.{d.bonusFromProof ? " (จากหลักฐาน)" : ""}
                                </span>
                              ) : null}
                              {d.proof ? (
                                <a href={proofUrl(d.proof)} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
                                  หลักฐาน: ไลฟ์จริง {proofTime(d.proof)}
                                </a>
                              ) : d.noProof ? <span className="text-muted-foreground">Mc ประจำ ไม่ต้องแนบหลักฐาน</span>
                                : <span className="font-semibold text-destructive">ยังไม่มีหลักฐาน</span>}
                              {d.gmv !== null ? <span className="font-semibold tabular-nums">GMV {fmtGmv(d.gmv)}</span>
                                : d.gmvCoveredBy ? <span className="text-success">GMV รวมในคิว {d.gmvCoveredBy}</span>
                                  : <span className="text-muted-foreground">ยังไม่ได้กรอก GMV</span>}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {cancels.length ? (
                        <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
                          {cancels.map((d) => (
                            <li key={`x${d.startMs}|${d.platform}`} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-semibold text-muted-foreground tabular-nums line-through">
                                {fmtDayShort.format(parseKey(d.date))} {shortTime(d.start)}–{shortTime(d.end)}
                              </span>
                              <span className="text-muted-foreground">{d.platform}</span>
                              <span className="font-semibold text-destructive">{cancelText(d)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter className="bg-transparent font-bold">
          <TableRow className="hover:bg-transparent">
            <TableCell className={cn("px-3", STICKY_CELL)}>รวม {rows.length} คน</TableCell>
            <TableCell className={num_}>{ts}</TableCell>
            <TableCell className={num_}>{num(th)}</TableCell>
            <TableCell />
            <TableCell className={num_}>{rows.reduce((a, r) => a + r.cancelled, 0) || "–"}</TableCell>
            <TableCell className={num_}>{tl || "–"}</TableCell>
            <TableCell className={num_}>{tb ? `+${tb} น.` : "–"}</TableCell>
            <TableCell className={num_}>
              {(() => {
                const need = rows.flatMap((r) => slotsOf(data, type, r.name)).filter((d) => !d.noProof);
                return need.length ? `${need.filter((d) => d.proof).length}/${need.length}` : "–";
              })()}
            </TableCell>
            <TableCell className={num_}>
              {(() => {
                const g = gmvOf(rows.flatMap((r) => slotsOf(data, type, r.name)));
                return g.count ? fmtGmv(g.total) : "–";
              })()}
            </TableCell>
            {showPay ? <TableCell className={cn(num_, "px-3")}>{tm ? money(tm) : "–"}</TableCell> : null}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
