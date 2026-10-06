"use client";

import { Fragment, useEffect, useState } from "react";
import type { OwnerDetail, OwnerPerson, OwnerSummary, ProofInfo } from "@/lib/types";
import { fmtDayMonth, fmtDayShort, monthKey, monthLabel, money, num, parseKey } from "@/lib/format";
import { bonusPaidMinutes, lateCut, tiersLabel } from "@/lib/pay";
import { ChevronRightIcon } from "lucide-react";
import type { Cell, ExportBook } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import { LoadError, LoadingBlock, MonthNav, Notice, Stats, api } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function summaryBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "จำนวน slot", "ชั่วโมงรวม", "จำนวนวัน", "ยกเลิก", "slot ที่สาย", "ไลฟ์ชดเชย (นาที)", "ชั่วโมงที่ได้เงิน", "Commit", "ค่าจ้าง/ชม.", "ยอดเงิน"]];
  for (const [type, people] of groups(data)) for (const r of people) {
    const rate = rateOf(data, type, r.name);
    const commit = r.commit
      ? `${tiersLabel(r.commit.baseRate, r.commit.tiers)} (${r.commit.tier ? `ถึง ${r.commit.tier.hours}+ ชม.` : "ยังไม่ถึงเทียร์แรก"})`
      : "";
    rows.push([type, r.name, r.slots, r.hours, r.days, r.cancelled, r.lateSlots, r.bonusMinutes || "", r.paidHours, commit, rate || "", rate ? Math.round(r.paidHours * rate) : ""]);
  }
  return book(`GLORY สรุป ${data.month}`, "สรุป", rows);
}

// ใบสรุปค่าจ้างรายคน: ทุกคิวของแต่ละคน + แถวรวมต่อคน (ไม่นับคิวที่ยกเลิก หักมาสายตามกฎ + ไลฟ์ชดเชย)
function payrollBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ชื่อ", "Platform", "วันที่", "เริ่ม", "จบ", "ชั่วโมง", "สาย (นาที)", "หัก", "ชดเชย (นาที)", "ค่าจ้าง/ชม.", "ยอดเงิน", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)"]];
  for (const [type, people] of groups(data)) {
    let groupHours = 0, groupMoney = 0;
    for (const p of people) {
      const rate = rateOf(data, type, p.name);
      const items = slotsOf(data, type, p.name);
      if (!items.length) continue;
      let h = 0, paid = 0;
      for (const d of items) {
        const hrs = round2(d.hours);
        const cut = lateCut(d.lateMinutes);
        const bonus = bonusPaidMinutes(d.bonusMinutes);
        const slotPaid = hrs * (1 - cut) + bonus / 60;
        h += hrs;
        paid += slotPaid;
        rows.push([
          p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end), hrs,
          lateText(d), cut ? `${Math.round(cut * 100)}%` : "",
          bonus ? `+${d.bonusMinutes} (คิด ${bonus})${d.bonusFromProof ? " จากหลักฐาน" : ""}` : "", rate || "", rate ? Math.round(slotPaid * rate) : "",
          d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "ยังไม่มีหลักฐาน",
          d.proof?.by ?? "",
          d.proof ? d.proof.driveUrl ?? "ยังไม่ได้อัปขึ้น Drive" : "",
        ]);
      }
      const m = rate ? Math.round(paid * rate) : 0;
      rows.push([
        `รวม ${p.name}`, `${items.length} slot`, "", "", "", round2(h), "", "", "", "", rate ? m : "", "", "",
        // คอลัมน์ N: โฟลเดอร์รวมหลักฐานทั้งเดือนของ Mc คนนี้ใน Google Drive
        type === "Mc" ? monthFolderText(items) : "",
      ], []);
      groupHours += h;
      groupMoney += m;
    }
    rows.push([`รวม ${type} ทั้งหมด`, "", "", "", "", round2(groupHours), "", "", "", "", groupMoney || ""], []);
  }
  return book(`GLORY ใบสรุปค่าจ้างรายคน ${data.month}`, "ค่าจ้างรายคน", rows);
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
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "วันที่", "เริ่ม", "จบ", "Platform", "ชั่วโมง", "คู่ (Admin/Mc)", "สถานะ", "สาย (นาที)", "ชดเชย (นาที)", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)"]];
  for (const d of data.details) {
    rows.push([
      d.type, d.name, d.date, d.start, d.end, d.platform, d.hours, d.pair, d.cancelled ? d.status || "ยกเลิก" : d.status || "",
      lateText(d), d.bonusMinutes ? `+${d.bonusMinutes}${d.bonusFromProof ? " (จากหลักฐาน)" : ""}` : "", d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "", d.proof?.by ?? "", d.proof?.driveUrl ?? "",
    ]);
  }
  return book(`GLORY รายละเอียด ${data.month}`, "รายละเอียด", rows);
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
          <LoadError title="โหลดสรุปไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} />
        ) : <LoadingBlock />}
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
        <Notice>
          ยังไม่ได้ตั้งค่าจ้าง: ใส่ค่าจ้างต่อชั่วโมงเริ่มต้นในตาราง settings (default_mc_rate / default_admin_rate) หรือรายคนที่ staff.hourly_rate
        </Notice>
      ) : null}
      <div className="my-3 flex flex-wrap gap-2">
        <ExportMenu variant="default" label="ใบสรุปค่าจ้างรายคน" build={() => payrollBook(data)} />
        <ExportMenu label="รายคน-รายวัน" build={() => dailyBook(data)} />
        <ExportMenu label="สรุป" build={() => summaryBook(data)} />
        <ExportMenu label="รายละเอียด" build={() => detailBook(data)} />
      </div>
      {groups(data).map(([type, rows]) => (
        <section key={type} className="mt-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-bold">
            {type}
            <span className="text-xs font-normal text-muted-foreground">กดที่ชื่อเพื่อดูรายวัน · ไม่นับคิวที่ยกเลิก · ยอดเงินหักมาสาย + รวมไลฟ์ชดเชยแล้ว</span>
          </h2>
          <SumTable data={data} type={type} rows={rows} />
        </section>
      ))}
    </div>
  );
}

function SumTable({ data, type, rows }: { data: OwnerSummary; type: Type; rows: OwnerPerson[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">ไม่มีคิวในเดือนนี้</div>;
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
      <Table className="min-w-[600px]">
        <TableHeader className="bg-secondary">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-xs font-semibold text-muted-foreground">ชื่อ</TableHead>
            {["slot", "ชั่วโมง", "วัน", "ยกเลิก", "สาย", "ชดเชย", "หลักฐาน", "ยอดเงิน"].map((h) => (
              <TableHead key={h} className="px-3 text-right text-xs font-semibold text-muted-foreground">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const rate = rateOf(data, type, r.name);
            const isOpen = open.has(r.name);
            const daily = isOpen ? dailyOf(data, type, r.name) : [];
            const items = slotsOf(data, type, r.name);
            const need = items.filter((d) => !d.noProof); // ไม่นับคิวของ Mc ประจำ (ไม่ต้องแนบ)
            const proved = need.filter((d) => d.proof).length;
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
                  <TableCell className="px-3">
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
                  <TableCell className={num_}>{r.cancelled || "–"}</TableCell>
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
                  <TableCell className={cn(num_, "px-3")}>{rate ? money(r.paidHours * rate) : "–"}</TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableCell colSpan={9} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
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
            <TableCell className="px-3">รวม {rows.length} คน</TableCell>
            <TableCell className={num_}>{ts}</TableCell>
            <TableCell className={num_}>{num(th)}</TableCell>
            <TableCell />
            <TableCell />
            <TableCell className={num_}>{tl || "–"}</TableCell>
            <TableCell className={num_}>{tb ? `+${tb} น.` : "–"}</TableCell>
            <TableCell className={num_}>
              {(() => {
                const need = rows.flatMap((r) => slotsOf(data, type, r.name)).filter((d) => !d.noProof);
                return need.length ? `${need.filter((d) => d.proof).length}/${need.length}` : "–";
              })()}
            </TableCell>
            <TableCell className={cn(num_, "px-3")}>{tm ? money(tm) : "–"}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
