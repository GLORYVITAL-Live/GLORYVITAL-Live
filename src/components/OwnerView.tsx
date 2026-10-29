"use client";

import { Fragment, useEffect, useState } from "react";
import type { OwnerDetail, OwnerPerson, OwnerSummary, ProofInfo } from "@/lib/types";
import { fmtDayMonth, fmtDayShort, monthKey, monthLabel, money, num, parseKey, todayKey } from "@/lib/format";
import { fmtGmv } from "@/lib/gmv";
import { bonusPaidMinutes, lateCut, slotPay, sumPay, tiersLabel } from "@/lib/pay";
import { ChevronRightIcon, LockIcon, LockOpenIcon } from "lucide-react";
import { SortHead, sortRows, STICKY_CELL, STICKY_HEAD, type SortState } from "@/components/SortHead";
import type { Cell, ExportBook, ExportSheet, RowStyle } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import { DatePicker } from "@/components/date-picker";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import { TawiPanel } from "@/components/TawiPanel";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, MonthNav, Notice, Stats, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Type = "Mc" | "Admin";

/** คนนี้เป็น Mc ประจำ / Admin ประจำ (ได้เงินเดือน) */
const salariedOf = (data: OwnerSummary, type: Type, name: string) =>
  !!(type === "Mc" ? data.mc : data.admin).find((p) => p.name === name)?.salaried;

/** อัตราค่าจ้างต่อชั่วโมง: รายคน ถ้าไม่มีใช้ค่าเริ่มต้น / พนักงานประจำ (เงินเดือน) = 0 */
function rateOf(data: OwnerSummary, type: Type, name: string) {
  if (salariedOf(data, type, name)) return 0;
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
      r.paidHours, commit, rate || (r.salaried ? "เงินเดือน" : ""), rate ? sumPay(items, rate) : "",
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
      let h = 0, m = 0;
      for (const d of items) {
        const hrs = round2(d.hours);
        const cut = lateCut(d.lateMinutes);
        const bonus = bonusPaidMinutes(d.bonusMinutes);
        // ปัดเงินทีละคิวแล้วรวม (ตัวเลขเดียวกับไฟล์เบิก / หน้าจอ)
        const pay = slotPay(d.hours, d.lateMinutes, d.bonusMinutes, rate);
        h += hrs;
        m += pay;
        rows.push([
          p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end), d.campaign, hrs,
          lateText(d), cut ? `${Math.round(cut * 100)}%` : "",
          bonus ? `+${d.bonusMinutes} (คิด ${bonus})${d.bonusFromProof ? " จากหลักฐาน" : ""}` : "", rate || "", rate ? pay : "",
          d.gmv ?? (d.gmvCoveredBy ? `รวมในคิว ${d.gmvCoveredBy}` : ""),
          d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "ยังไม่มีหลักฐาน",
          d.proof?.by ?? "",
          d.proof ? d.proof.driveUrl ?? "ยังไม่ได้อัปขึ้น Drive" : "",
        ]);
      }
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

/** เงินของคิว (หักมาสาย + ไลฟ์ชดเชย) ปัดเป็นบาท — สูตรเดียวกับทุกที่ (src/lib/pay.ts slotPay) */
const slotMoney = (d: OwnerDetail, rate: number) => slotPay(d.hours, d.lateMinutes, d.bonusMinutes, rate);
/** เข้างานกลาง slot: "เข้า 10:00 (คิด 1.5 ชม.)" */
const checkInText = (d: OwnerDetail) => (d.checkIn ? `เข้า ${d.checkIn.time} (คิด ${num(d.hours)} ชม. จาก slot ${num(d.checkIn.slotHours)} ชม.)` : "");
/** หมายเหตุของคิว: หมายเหตุในชีต + เวลาเข้า + สาย / ชดเชย */
const claimRemark = (d: OwnerDetail) => [
  d.remark ?? "",
  d.checkIn ? `คิด ${num(d.hours)} ชม. ตามเวลาเข้า` : "",
  d.lateMinutes && lateCut(d.lateMinutes) ? `สาย ${d.lateMinutes} นาที หัก ${Math.round(lateCut(d.lateMinutes) * 100)}%` : "",
  bonusPaidMinutes(d.bonusMinutes) ? `ชดเชย +${d.bonusMinutes} นาที` : "",
].filter(Boolean).join(" · ");

/**
 * สรุปรายละเอียดชั่วโมงทำงาน (รายคน): หัวเรื่องแถบดำ / แถวละคิว ช่อง channel ใส่สีตามช่อง / แถวสุดท้ายของแต่ละคน = Total + GMV
 *   เฉพาะคนที่มีค่าจ้างรายชั่วโมง (Mc ประจำ / Admin ประจำ ที่ได้เงินเดือนไม่อยู่ในไฟล์เบิก)
 */
function claimSheet(data: OwnerSummary, type: Type): ExportSheet | null {
  const [y, m] = data.month.split("-").map(Number);
  const first = `${data.month}-01`, last = `${data.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const people = (type === "Mc" ? data.mc : data.admin)
    .map((p) => ({ p, rate: rateOf(data, type, p.name), items: slotsOf(data, type, p.name) }))
    .filter((x) => x.items.length && x.rate > 0)
    .sort((a, b) => a.p.name.localeCompare(b.p.name, "th"));
  const skipped = (type === "Mc" ? data.mc : data.admin).filter((p) => !rateOf(data, type, p.name) && slotsOf(data, type, p.name).length);
  const salaried = skipped.filter((p) => p.salaried), noRate = skipped.filter((p) => !p.salaried);
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
  if (skipped.length) rows.push([]);
  if (salaried.length) rows.push(["", `ไม่อยู่ในไฟล์เบิก (${type} ประจำ ได้เงินเดือน): ${salaried.map((p) => p.name).join(", ")}`]);
  if (noRate.length) rows.push(["", `ไม่อยู่ในไฟล์เบิก (ยังไม่ได้ตั้งค่าจ้างรายชั่วโมง): ${noRate.map((p) => p.name).join(", ")}`]);
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
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "วันที่", "เริ่ม", "จบ", "Platform", "Campaign", "ชั่วโมง", "GMV", "คู่ (Admin/Mc)", "สถานะ", "สาย (นาที)", "ชดเชย (นาที)", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)", "ยกเลิก", "เวลาเข้า (หมายเหตุ)"]];
  for (const d of data.details) {
    rows.push([
      d.type, d.name, d.date, d.start, d.end, d.platform, d.campaign, d.hours,
      d.gmv ?? (d.gmvCoveredBy ? `รวมในคิว ${d.gmvCoveredBy}` : ""),
      d.pair, d.cancelled ? d.status || "ยกเลิก" : d.status || "",
      lateText(d), d.bonusMinutes ? `+${d.bonusMinutes}${d.bonusFromProof ? " (จากหลักฐาน)" : ""}` : "", d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "", d.proof?.by ?? "", d.proof?.driveUrl ?? "",
      d.cancelled ? cancelText(d) : "",
      d.checkIn ? checkInText(d) : d.checkInBad ? `ใช้ไม่ได้ (${d.checkInBad}) คิดเต็ม slot` : "",
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
  /** โหลดเดือนนี้ใหม่ (หลังปิด / เปิดงวด) */
  const reloadMonth = () => setCache((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== month)));
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
      {/* เอกสารบัญชีรายเดือน (Owner ที่ติ๊กสิทธิ์ดูเอกสาร) — แต่ละแผงเลือกเดือนเองข้างใน */}
      {data.docs?.mc || data.docs?.admin ? <><TawiPanel /><ReceiptPanel /></> : null}
      {groups(data).map(([type, rows]) => (
        <section key={type} className="mt-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-bold">
            {type}
            <span className="text-xs font-normal text-muted-foreground">
              กดที่ชื่อเพื่อดูรายวัน · ไม่นับคิวที่ยกเลิก · {payHiddenOf(data, type) ? "ดูได้อย่างเดียว ไม่แสดงค่าจ้าง" : "ยอดเงินหักมาสาย + รวมไลฟ์ชดเชยแล้ว"}
            </span>
          </h2>
          <PeriodBar data={data} side={type === "Mc" ? "mc" : "admin"} onChanged={reloadMonth} />
          <PayBar data={data} type={type} rows={rows} onChanged={reloadMonth} />
          <SumTable data={data} type={type} rows={rows} onChanged={reloadMonth} />
        </section>
      ))}
    </div>
  );
}

/**
 * ปิดงวดของฝั่งนี้: สถานะ + ปุ่มปิด / เปิดงวด (เฉพาะคนที่ปิดงวดได้) + ส่วนต่างของข้อมูลจริงหลังปิด + ประวัติ
 *   ยังไม่ปิด และคนดูปิดไม่ได้ และไม่มีประวัติ = ไม่แสดง
 */
function PeriodBar({ data, side, onChanged }: { data: OwnerSummary; side: "mc" | "admin"; onChanged: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const closed = data.periods?.[side];
  const changes = data.changes?.[side] ?? [];
  const log = (data.periodLog ?? []).filter((l) => l.side === side);
  const label = side === "mc" ? "Mc" : "Admin";
  if (!closed && !data.canClose && !log.length) return null;

  // เดือนที่ยังไม่จบ (เดือนนี้ / เดือนหน้า) ปิดงวดไม่ได้: สรุปรวมคิวที่ยังไม่ถึงวันไลฟ์ด้วย (เซิร์ฟเวอร์ตรวจซ้ำ)
  const ended = data.month < monthKey();
  async function act(action: "close" | "reopen") {
    const ok = await confirm(action === "close"
      ? {
        title: `ปิดงวด ${label} ${monthLabel(data.month)}?`,
        description: "ระบบเก็บตัวเลขของฝั่งนี้ตอนนี้ไว้ หน้าสรุปและไฟล์เบิกเดือนนี้จะใช้ตัวเลขชุดนี้เสมอ ถ้ามีคนแก้ข้อมูลย้อนหลังจะขึ้นเป็นส่วนต่างให้เห็น",
        confirmText: "ปิดงวด",
      }
      : {
        title: `เปิดงวด ${label} ${monthLabel(data.month)} ใหม่?`,
        description: "ตัวเลขกลับไปคิดตามข้อมูลจริง (ตัวเลขตอนปิดยังเก็บไว้ในประวัติ) แล้วปิดใหม่ได้",
        confirmText: "เปิดงวดใหม่",
        destructive: true,
      });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/owner/periods", { month: data.month, side, action });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("mb-2 rounded-xl border px-3 py-2 text-sm", closed ? "border-success/40 bg-success/5" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-2">
        {closed ? <LockIcon className="size-4 shrink-0 text-success" /> : <LockOpenIcon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 leading-snug">
          {closed ? (
            <>
              <b>ปิดงวดแล้ว</b> · {fmtAt.format(new Date(closed.at))} โดย {closed.by}
              <span className="block text-xs text-muted-foreground">ตัวเลขในตารางและไฟล์เบิกของฝั่ง {label} เป็นตัวเลข ณ ตอนปิดงวด</span>
            </>
          ) : (
            <>
              ยังไม่ปิดงวด <span className="text-xs text-muted-foreground">— ตัวเลขคิดตามข้อมูลจริงตอนนี้</span>
              {data.canClose && !ended ? (
                <span className="block text-xs text-muted-foreground">
                  เดือนนี้ยังไม่จบ ยังปิดงวดไม่ได้ (ตัวเลขยังรวมคิวที่ยังไม่ถึงวันไลฟ์) — ปิดได้ตั้งแต่ 1 {monthLabel(monthKey(1, data.month))}
                </span>
              ) : null}
            </>
          )}
        </span>
        {data.canClose ? (
          <Button
            size="sm" variant={closed ? "outline" : "default"} disabled={busy || (!closed && !ended)}
            onClick={() => act(closed ? "reopen" : "close")}
          >
            {busy ? "กำลังบันทึก..." : closed ? "เปิดงวดใหม่" : `ปิดงวด ${label}`}
          </Button>
        ) : null}
      </div>
      {changes.length ? (
        <div className="mt-2 rounded-lg border border-warning-border bg-warning px-2.5 py-1.5 text-xs text-warning-foreground">
          <b>ข้อมูลจริงเปลี่ยนหลังปิดงวด {changes.length} คน</b> — ไว้ปรับในงวดถัดไป หรือเปิดงวดใหม่แล้วปิดอีกครั้ง
          <ul className="mt-1 space-y-0.5">
            {changes.map((c) => (
              <li key={c.name}><b>{c.name}</b>: {c.items.map((i) => `${i.label} ${i.before} → ${i.after}`).join(" · ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {log.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          ประวัติ: {log.map((l) => `ปิด ${fmtAt.format(new Date(l.closedAt))} (${l.closedBy})${l.reopenedAt ? ` → เปิดใหม่ ${fmtAt.format(new Date(l.reopenedAt))} (${l.reopenedBy})` : ""}`).join(" | ")}
        </p>
      ) : null}
    </div>
  );
}

// ---------- การโอนค่าจ้าง (src/lib/pay-months.ts) ----------

/** รายการโอนของคนนี้ในเดือนนี้ */
const paymentsOfPerson = (data: OwnerSummary, r: OwnerPerson) => (r.staffId ? data.payments?.[r.staffId] ?? [] : []);
const paidOf = (data: OwnerSummary, r: OwnerPerson) => paymentsOfPerson(data, r).reduce((a, p) => a + p.amount, 0);
/** บันทึกโอนฝั่งนี้ได้ (จัดการฝั่งนี้ได้ + รัน SQL แล้ว) */
const canPayOf = (data: OwnerSummary, type: Type) => !!data.paySides?.[type === "Mc" ? "mc" : "admin"] && !data.paySql;
const personPay = (data: OwnerSummary, type: Type, r: OwnerPerson) => sumPay(slotsOf(data, type, r.name), rateOf(data, type, r.name));

/** สถานะโอนสั้นๆ ใต้ยอดเงิน: ยังไม่บันทึกโอน = ไม่แสดง */
function PaidStatus({ total, paid, className }: { total: number; paid: number; className?: string }) {
  if (!paid) return null;
  const left = total - paid;
  return (
    <span className={cn("text-[11px] font-semibold", left > 0 ? "text-destructive" : left < 0 ? "text-warning-foreground" : "text-success", className)}>
      {left > 0 ? `ค้าง ${money(left)}` : left < 0 ? `โอนเกิน ${money(-left)}` : "โอนครบ ✓"}
    </span>
  );
}

/** แถบสรุปการโอนของฝั่งนี้ + ปุ่มบันทึกโอนครบทุกคนที่ค้าง (เดือนที่จบแล้ว) */
function PayBar({ data, type, rows, onChanged }: { data: OwnerSummary; type: Type; rows: OwnerPerson[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  if (payHiddenOf(data, type)) return null;
  if (data.paySql && data.paySides?.[type === "Mc" ? "mc" : "admin"]) {
    return <p className="mb-2 text-xs text-muted-foreground">บันทึกการโอนค่าจ้าง: {data.paySql}</p>;
  }
  if (!canPayOf(data, type)) return null;
  const payable = rows.filter((r) => !r.salaried && r.staffId && rateOf(data, type, r.name) > 0)
    .map((r) => ({ r, total: personPay(data, type, r), paid: paidOf(data, r) }))
    .filter((x) => x.total > 0);
  const ended = data.month < monthKey();
  // เดือนที่ยังไม่จบและยังไม่มีใครโอน = ยังไม่ถึงรอบจ่าย ไม่ขึ้น "ค้าง" (บันทึกรายคนได้ที่แถวที่กาง)
  if (!payable.length || (!ended && !payable.some((x) => x.paid))) return null;
  const due = payable.filter((x) => x.total - x.paid > 0);
  const done = payable.filter((x) => x.paid >= x.total).length;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
      {/* มือถือ: ข้อความเต็มบรรทัด ปุ่มลงบรรทัดใหม่เต็มกว้าง */}
      <span className="min-w-60 flex-1 leading-snug">
        โอนครบแล้ว <b>{done}/{payable.length}</b> คน
        {due.length ? <> · ค้าง <b className="text-destructive tabular-nums">{money(due.reduce((a, x) => a + x.total - x.paid, 0))} บาท</b> ({due.length} คน)</> : " ✓"}
        <span className="block text-xs text-muted-foreground">กดที่ชื่อเพื่อบันทึกโอนรายคน · บันทึกแล้วแจ้งเตือนคนนั้น และขึ้น &quot;จ่ายแล้ว / ค้างจ่าย&quot; ในตารางของฉัน</span>
      </span>
      {ended && due.length ? (
        <Button size="sm" onClick={() => setOpen(true)} className="max-sm:w-full pointer-coarse:h-10">บันทึกโอนครบทุกคนที่ค้าง ({due.length})</Button>
      ) : null}
      {open ? (
        <PayDialog
          month={data.month}
          title={`บันทึกโอนค่าจ้าง ${type} ${monthLabel(data.month)} — ${due.length} คน`}
          items={due.map((x) => ({ staffId: x.r.staffId!, name: x.r.name, amount: x.total - x.paid }))}
          onClose={(changed) => { setOpen(false); if (changed) onChanged(); }}
        />
      ) : null}
    </div>
  );
}

/** ในแถวที่กางของคนหนึ่ง: รายการโอน + บันทึกโอน / ยกเลิกรายการ */
function PaymentsPanel({ data, type, person, total, onChanged }: {
  data: OwnerSummary; type: Type; person: OwnerPerson; total: number; onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = paymentsOfPerson(data, person);
  const canPay = canPayOf(data, type);
  if (!canPay && !list.length) return null;
  const paid = list.reduce((a, p) => a + p.amount, 0);

  async function voidOne(id: number, amount: number) {
    if (!(await confirm({ title: `ยกเลิกรายการโอน ${money(amount)} บาท?`, description: "ใช้เมื่อบันทึกผิด — รายการเก็บไว้ในประวัติ (ไม่แจ้งเตือนคนนั้น)", confirmText: "ยกเลิกรายการ", destructive: true }))) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/owner/payments", { action: "void", id });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    // กว้างพอดีเนื้อหา (ตารางกว้างกว่าจอมือถือ: ปุ่มไม่ไปอยู่ขอบขวาที่ต้องเลื่อนไปดู)
    <div className="mt-2 w-fit max-w-[18rem] rounded-lg border bg-card px-3 py-2 text-xs sm:max-w-md">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-semibold tabular-nums">
          การโอน: {paid ? `โอนแล้ว ${money(paid)} / ${money(total)} บาท` : `ยังไม่บันทึกโอน (ยอด ${money(total)} บาท)`}
          {paid ? <PaidStatus total={total} paid={paid} className="ml-1.5" /> : null}
        </span>
        {canPay && total - paid > 0 ? <Button size="xs" disabled={busy} onClick={() => setOpen(true)} className="pointer-coarse:h-9 pointer-coarse:px-3">บันทึกโอน</Button> : null}
      </div>
      {list.length ? (
        <ul className="mt-1 space-y-0.5">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums">{fmtDayShort.format(parseKey(p.paidOn))} · <b>{money(p.amount)} บาท</b></span>
              <span className="text-muted-foreground">โดย {p.by}{p.note ? ` · ${p.note}` : ""}</span>
              {canPay ? (
                <Button variant="link" size="xs" disabled={busy} onClick={() => voidOne(p.id, p.amount)} className="h-auto px-0 text-destructive pointer-coarse:py-2">ยกเลิกรายการ</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <PayDialog
          month={data.month}
          title={`บันทึกโอนค่าจ้าง ${person.name} ${monthLabel(data.month)}`}
          items={[{ staffId: person.staffId!, name: person.name, amount: total - paid }]}
          onClose={(changed) => { setOpen(false); if (changed) onChanged(); }}
        />
      ) : null}
    </div>
  );
}

/** กรอกการโอน: คนเดียว = แก้จำนวนเงินได้ (โอนบางส่วน) · หลายคน = ยอดค้างของแต่ละคน */
function PayDialog({ month, title, items, onClose }: {
  month: string; title: string; items: { staffId: number; name: string; amount: number }[]; onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const single = items.length === 1;
  const [amount, setAmount] = useState(String(Math.round(items[0]?.amount ?? 0)));
  const [paidOn, setPaidOn] = useState(todayKey());
  const [note, setNote] = useState("");
  // ลงย้อนหลังเดือนเก่า (โอนไปนานแล้ว) ไม่ต้องแจ้งเตือน — ค่าเริ่มต้น: แจ้งเฉพาะเดือนที่แล้ว / เดือนนี้
  const [notify, setNotify] = useState(month >= monthKey(-1));
  const [busy, setBusy] = useState(false);
  const total = single ? Number(amount.replace(/[,\s]/g, "")) || 0 : items.reduce((a, x) => a + x.amount, 0);

  async function submit() {
    setBusy(true);
    try {
      const list = single ? [{ staffId: items[0].staffId, amount: total }] : items.map((x) => ({ staffId: x.staffId, amount: x.amount }));
      const res = await api<{ message: string }>("/api/owner/payments", { action: "add", month, paidOn, note, notify, items: list });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <AppDialog open onClose={() => onClose(false)} busy={busy} title={title} description="บันทึกแล้วขึ้นยอดจ่ายแล้ว / ค้างจ่ายในตารางของฉัน · เรทของเดือนนี้ถูกล็อกไว้">
      <DialogBody className="space-y-3 text-sm">
        {single ? (
          <div>
            <Label htmlFor="pay-amount" className="mb-1">จำนวนเงินที่โอน (บาท)</Label>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="mt-1 block text-xs text-muted-foreground">ค่าเริ่มต้น = ยอดที่ยังค้าง · โอนบางส่วนได้ (แก้ตัวเลข)</span>
          </div>
        ) : (
          <ul className="scroll-thin max-h-56 divide-y overflow-y-auto rounded-lg border">
            {items.map((x) => (
              <li key={x.staffId} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="truncate">{x.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">{money(x.amount)} บาท</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Label className="mb-1">วันที่โอน</Label>
          <DatePicker value={paidOn} onChange={setPaidOn} aria-label="วันที่โอน" className="w-full" />
        </div>
        <div>
          <Label htmlFor="pay-note" className="mb-1">หมายเหตุ (ไม่บังคับ)</Label>
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="เช่น โอนรอบแรก / หักภาษี ณ ที่จ่ายแล้ว" />
        </div>
        <Label className="items-start leading-snug font-normal">
          <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" />
          <span>
            แจ้งเตือนคนที่ได้รับ (กระดิ่ง + มือถือ)
            <span className="block text-xs text-muted-foreground">ลงย้อนหลังเดือนเก่าที่โอนไปนานแล้ว เอาติ๊กออกได้</span>
          </span>
        </Label>
        <p className="font-semibold tabular-nums">รวม {money(total)} บาท{single ? "" : ` · ${items.length} คน`}</p>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={() => onClose(false)}>ยกเลิก</Button>
        <Button size="lg" disabled={busy || !(total > 0) || !paidOn} onClick={submit}>{busy ? "กำลังบันทึก..." : "บันทึกโอน"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

const SUM_COLS: [string, string][] = [
  ["slots", "slot"], ["hours", "ชั่วโมง"], ["days", "วัน"], ["cancelled", "ยกเลิก"], ["late", "สาย"],
  ["bonus", "ชดเชย"], ["proof", "หลักฐาน"], ["gmv", "GMV"], ["pay", "ยอดเงิน"],
];

function SumTable({ data, type, rows: base, onChanged }: { data: OwnerSummary; type: Type; rows: OwnerPerson[]; onChanged: () => void }) {
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
        return rate ? sumPay(items, rate) : null;
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
  // ยอดเงิน = ปัดทีละคิวแล้วรวม (ตรงกับไฟล์เบิก / ใบสรุปรายคน)
  const payOf = (r: OwnerPerson) => sumPay(slotsOf(data, type, r.name), rateOf(data, type, r.name));
  const tm = rows.reduce((a, r) => a + payOf(r), 0);
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
                  <TableCell className={cn("px-3 max-sm:max-w-44 max-sm:whitespace-normal", STICKY_CELL)}>
                    <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                    {r.name}
                    {/* มือถือ: ยอดเงิน + ชั่วโมงอยู่ใต้ชื่อ (คอลัมน์ชื่อค้างไว้) ไม่ต้องเลื่อนขวาไปคอลัมน์สุดท้าย */}
                    <span className="mt-0.5 block text-xs font-semibold text-primary tabular-nums sm:hidden">
                      {num(r.hours)} ชม.{showPay ? ` · ${r.salaried ? "เงินเดือน" : rate ? `${money(payOf(r))} บาท` : "ไม่มีค่าจ้าง"}` : ""}
                      {showPay && !r.salaried && rate ? <PaidStatus total={payOf(r)} paid={paidOf(data, r)} className="ml-1" /> : null}
                    </span>
                    {/* ไลฟ์ Shopee (แท็บ MC Shopee) รวมอยู่ในชั่วโมง / ค่าจ้างแล้ว แสดงแยกให้เห็นว่าเป็น Shopee กี่ ชม. */}
                    {items.some((d) => /shopee/i.test(d.platform)) ? (
                      <Badge title="ชั่วโมงไลฟ์ Shopee (รวมอยู่ในชั่วโมง / ค่าจ้างของเดือนนี้แล้ว)" className="ml-1.5 bg-p1/15 text-[11px] text-p1">
                        Shopee {num(items.filter((d) => /shopee/i.test(d.platform)).reduce((a, d) => a + d.hours, 0))} ชม.
                      </Badge>
                    ) : null}
                    {r.salaried ? (
                      <Badge title={`${type} ประจำ (ได้เงินเดือน) ไม่คิดค่าจ้างรายชั่วโมง และไม่อยู่ในไฟล์เบิก`} className="ml-1.5 bg-p2/15 text-[11px] text-p2">
                        ประจำ
                      </Badge>
                    ) : null}
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
                  {showPay ? (
                    <TableCell className={cn(num_, "px-3", r.salaried && "text-xs text-muted-foreground")}>
                      {r.salaried ? "เงินเดือน" : rate ? money(payOf(r)) : "–"}
                      {!r.salaried && rate ? <PaidStatus total={payOf(r)} paid={paidOf(data, r)} className="block" /> : null}
                    </TableCell>
                  ) : null}
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
                              {d.checkIn ? (
                                <span className="font-semibold text-p2" title="เวลาเข้างานจริงจากหมายเหตุในชีต ชั่วโมงและเงินคิดจากเวลานี้ถึงจบ slot">
                                  {checkInText(d)}
                                </span>
                              ) : d.checkInBad ? (
                                <span className="font-semibold text-destructive">หมายเหตุ {d.checkInBad} — ใช้ไม่ได้ คิดเต็ม slot</span>
                              ) : null}
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
                      {showPay && rate && !r.salaried && r.staffId ? (
                        <PaymentsPanel data={data} type={type} person={r} total={payOf(r)} onChanged={onChanged} />
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
            <TableCell className={cn("px-3", STICKY_CELL)}>
              รวม {rows.length} คน
              <span className="block text-xs text-primary tabular-nums sm:hidden">{num(th)} ชม.{showPay && tm ? ` · ${money(tm)} บาท` : ""}</span>
            </TableCell>
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
