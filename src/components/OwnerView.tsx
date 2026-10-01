"use client";

import { Fragment, useEffect, useState } from "react";
import type { OwnerPerson, OwnerSummary } from "@/lib/types";
import { fmtDayMonth, fmtDayShort, monthKey, monthLabel, money, num, parseKey } from "@/lib/format";
import { lateCut, tiersLabel } from "@/lib/pay";
import { MonthNav, StateBox, Stats, api, btn } from "@/components/ui";

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

// ---------- CSV (+ BOM ให้ Excel อ่านภาษาไทยได้ถูก) ----------

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, rows: unknown[][]) {
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (ใช้ทั้งตารางบนหน้าจอและไฟล์ CSV)
const groups = (data: OwnerSummary): [Type, OwnerPerson[]][] => {
  const out: [Type, OwnerPerson[]][] = [];
  if (data.scope?.mc !== false) out.push(["Mc", data.mc]);
  if (data.scope?.admin !== false) out.push(["Admin", data.admin]);
  return out;
};

function downloadSummary(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "จำนวน slot", "ชั่วโมงรวม", "จำนวนวัน", "ยกเลิก", "slot ที่สาย", "ชั่วโมงที่ได้เงิน", "Commit", "ค่าจ้าง/ชม.", "ยอดเงิน"]];
  for (const [type, people] of groups(data)) for (const r of people) {
    const rate = rateOf(data, type, r.name);
    const commit = r.commit
      ? `${tiersLabel(r.commit.baseRate, r.commit.tiers)} (${r.commit.tier ? `ถึง ${r.commit.tier.hours}+ ชม.` : "ยังไม่ถึงเทียร์แรก"})`
      : "";
    rows.push([type, r.name, r.slots, r.hours, r.days, r.cancelled, r.lateSlots, r.paidHours, commit, rate || "", rate ? Math.round(r.paidHours * rate) : ""]);
  }
  downloadCsv(`glory-summary-${data.month}.csv`, rows);
}

// ใบสรุปค่าจ้างรายคน: ทุกคิวของแต่ละคน + แถวรวมต่อคน (ไม่นับคิวที่ยกเลิก หักมาสายตามกฎ)
function downloadPayroll(data: OwnerSummary) {
  const rows: unknown[][] = [["ชื่อ", "Platform", "วันที่", "เริ่ม", "จบ", "ชั่วโมง", "สาย (นาที)", "หัก", "ค่าจ้าง/ชม.", "ยอดเงิน"]];
  for (const [type, people] of groups(data)) {
    let groupHours = 0, groupMoney = 0;
    for (const p of people) {
      const rate = rateOf(data, type, p.name);
      const items = data.details.filter((d) => d.type === type && d.name === p.name && !d.cancelled).sort((a, b) => a.startMs - b.startMs);
      if (!items.length) continue;
      let h = 0, paid = 0;
      for (const d of items) {
        const hrs = round2(d.hours);
        const cut = lateCut(d.lateMinutes);
        h += hrs;
        paid += hrs * (1 - cut);
        rows.push([
          p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end), hrs,
          d.lateMinutes || "", cut ? `${Math.round(cut * 100)}%` : "", rate || "", rate ? Math.round(hrs * (1 - cut) * rate) : "",
        ]);
      }
      const m = rate ? Math.round(paid * rate) : 0;
      rows.push([`รวม ${p.name}`, `${items.length} slot`, "", "", "", round2(h), "", "", "", rate ? m : ""], []);
      groupHours += h;
      groupMoney += m;
    }
    rows.push([`รวม ${type} ทั้งหมด`, "", "", "", "", round2(groupHours), "", "", "", groupMoney || ""], []);
  }
  downloadCsv(`glory-payroll-${data.month}.csv`, rows);
}

// ตาราง คน x วันที่: แต่ละช่อง = ชั่วโมงของวันนั้น, ท้ายแถว = รวมชั่วโมงและจำนวนวัน
function downloadDaily(data: OwnerSummary) {
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
  downloadCsv(`glory-daily-${data.month}.csv`, rows);
}

function downloadDetail(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "วันที่", "เริ่ม", "จบ", "Platform", "ชั่วโมง", "คู่ (Admin/Mc)", "สถานะ", "สาย (นาที)"]];
  for (const d of data.details) {
    rows.push([d.type, d.name, d.date, d.start, d.end, d.platform, d.hours, d.pair, d.cancelled ? d.status || "ยกเลิก" : d.status || "", d.lateMinutes || ""]);
  }
  downloadCsv(`glory-detail-${data.month}.csv`, rows);
}

// ---------- หน้าจอ ----------

export function OwnerView() {
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
          <StateBox title="โหลดสรุปไม่สำเร็จ">
            {error}
            <br />
            <button type="button" className={`${btn.ghost} mt-3`} onClick={() => { setFailed(null); setAttempt((n) => n + 1); }}>ลองอีกครั้ง</button>
          </StateBox>
        ) : <div className="my-4 h-40 animate-pulse rounded-2xl bg-line/70" />}
      </div>
    );
  }

  const r0 = data.rates;
  const noRates = !r0.defaultMc && !r0.defaultAdmin && !Object.keys(r0.mc).length && !Object.keys(r0.admin).length;
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
        <p className="my-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-info-ink">
          ยังไม่ได้ตั้งค่าจ้าง: ใส่ค่าจ้างต่อชั่วโมงเริ่มต้นในตาราง settings (default_mc_rate / default_admin_rate) หรือรายคนที่ staff.hourly_rate
        </p>
      ) : null}
      <div className="my-3 flex flex-wrap gap-2">
        <button type="button" className={btn.primary} onClick={() => downloadPayroll(data)}>ดาวน์โหลดใบสรุปค่าจ้างรายคน (CSV)</button>
        <button type="button" className={btn.ghost} onClick={() => downloadDaily(data)}>ดาวน์โหลดรายคน-รายวัน (CSV)</button>
        <button type="button" className={btn.ghost} onClick={() => downloadSummary(data)}>ดาวน์โหลดสรุป (CSV)</button>
        <button type="button" className={btn.ghost} onClick={() => downloadDetail(data)}>ดาวน์โหลดรายละเอียด (CSV)</button>
      </div>
      {groups(data).map(([type, rows]) => (
        <section key={type} className="mt-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-bold">
            {type}
            <span className="text-xs font-normal text-muted">กดที่ชื่อเพื่อดูรายวัน · ไม่นับคิวที่ยกเลิก · ยอดเงินหักมาสายแล้ว</span>
          </h2>
          <SumTable data={data} type={type} rows={rows} />
        </section>
      ))}
    </div>
  );
}

function SumTable({ data, type, rows }: { data: OwnerSummary; type: Type; rows: OwnerPerson[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) return <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">ไม่มีคิวในเดือนนี้</div>;
  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name); else next.add(name);
    setOpen(next);
  };
  const ts = rows.reduce((a, r) => a + r.slots, 0);
  const th = rows.reduce((a, r) => a + r.hours, 0);
  const tm = rows.reduce((a, r) => a + rateOf(data, type, r.name) * r.paidHours, 0);
  const tl = rows.reduce((a, r) => a + r.lateSlots, 0);
  const th_ = "px-3 py-2 font-semibold";
  const td = "border-t border-line px-3 py-2";
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-brand-soft text-left text-xs text-muted">
          <tr>
            <th className={th_}>ชื่อ</th>
            {["slot", "ชั่วโมง", "วัน", "ยกเลิก", "สาย", "ยอดเงิน"].map((h) => <th key={h} className={`${th_} text-right`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = rateOf(data, type, r.name);
            const isOpen = open.has(r.name);
            const daily = isOpen ? dailyOf(data, type, r.name) : [];
            return (
              <Fragment key={r.name}>
                <tr
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggle(r.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.name); } }}
                  className={`cursor-pointer ${isOpen ? "bg-brand-soft" : "hover:bg-bg"}`}
                >
                  <td className={td}>
                    <span className={`inline-block w-4 text-muted transition-transform ${isOpen ? "rotate-90 text-brand" : ""}`}>▸</span>
                    {r.name}
                    {r.commit ? (
                      <span
                        title={`Commit: ${tiersLabel(r.commit.baseRate, r.commit.tiers)} (ทุกชั่วโมงของเดือนคิดราคาเทียร์ที่จองถึง)`}
                        className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${r.commit.tier ? "bg-ok/15 text-ok" : "bg-bg text-muted"}`}
                      >
                        {r.commit.tier
                          ? `Commit ${num(r.commit.tier.hours)}+ ชม. ✓ ${money(r.commit.tier.rate)}/ชม.`
                          : `Commit ยังไม่ถึง ${num(r.commit.tiers[0].hours)} ชม. (${num(r.hours)})`}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{r.slots}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.hours)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.days}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.cancelled || "–"}</td>
                  <td className={`${td} text-right tabular-nums ${r.lateSlots ? "font-semibold text-err" : ""}`}>{r.lateSlots || "–"}</td>
                  <td className={`${td} text-right tabular-nums`}>{rate ? money(r.paidHours * rate) : "–"}</td>
                </tr>
                {isOpen ? (
                  <tr className="bg-brand-soft">
                    <td colSpan={7} className="px-3 pt-1 pb-3 pl-8">
                      <div className="flex flex-wrap gap-1.5">
                        {daily.length ? daily.map((x) => (
                          <span key={x.date} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs whitespace-nowrap">
                            <b className="font-semibold text-brand">{fmtDayShort.format(parseKey(x.date))}</b>
                            {` ${num(x.hours)} ชม.`}{x.slots > 1 ? ` (${x.slots} slot)` : ""}
                          </span>
                        )) : <span className="text-xs text-muted">ไม่มีคิวที่ไม่ถูกยกเลิก</span>}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="font-bold">
          <tr>
            <td className={td}>รวม {rows.length} คน</td>
            <td className={`${td} text-right tabular-nums`}>{ts}</td>
            <td className={`${td} text-right tabular-nums`}>{num(th)}</td>
            <td className={td} />
            <td className={td} />
            <td className={`${td} text-right tabular-nums`}>{tl || "–"}</td>
            <td className={`${td} text-right tabular-nums`}>{tm ? money(tm) : "–"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
