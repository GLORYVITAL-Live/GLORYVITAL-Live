"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon, CalendarClockIcon, ChartColumnIcon, CheckCircle2Icon, ChevronRightIcon, CircleIcon, DatabaseBackupIcon, FileTextIcon, RadioIcon,
  ReceiptTextIcon, RefreshCwIcon, UserXIcon,
} from "lucide-react";
import { windowText } from "@/lib/campaign";
import { fmtDayMonth, fmtDayShort, fmtMonthShort, money, monthLabel, num, parseKey } from "@/lib/format";
import { SLOT_VIEW_KEY, writeLocal } from "@/lib/hooks";
import { lateCut } from "@/lib/pay";
import { tawiMonthLabel } from "@/lib/tawi-name";
import { fmtDay } from "@/lib/window";
import type { DashboardData, HomeData, HomeSlot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarChart, ChangeText, Legend, fadedColor } from "@/components/LiveCharts";
import { AdminLateDialog, type AdminLateTarget } from "@/components/AdminLateDialog";
import { CountUp, MotionProvider, Reveal } from "@/components/motion";
import { LoadError, LoadingBlock, api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * หน้าแรกของเจ้าของ: งานที่ต้องทำในหน้าเดียว — ไลฟ์วันนี้ / slot ที่ยังไม่มีคน / หลักฐาน + GMV ค้าง / แคมเปญถัดไป / ข้อมูลที่ควรแก้
 *   go(page, ownerTab) = ไปหน้าที่เกี่ยวข้อง (เช่น หน้าเจ้าของ > จัดการ slot)
 */

export type Go = (page: "owner" | "proof", ownerTab?: "summary" | "performance" | "slots" | "staff") => void;

const LIST_LIMIT = 8;
const dayText = (d: string) => fmtDayShort.format(parseKey(d));

export function HomeView({ go }: { go: Go }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // ใส่สถานะมาสายของ Admin (slot ใน "ไลฟ์วันนี้")
  const [lateTarget, setLateTarget] = useState<AdminLateTarget | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ home: HomeData }>("/api/owner/home")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res.home); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [attempt]);

  const refresh = () => { setBusy(true); setAttempt((n) => n + 1); };
  if (!data) {
    return error ? <LoadError title="โหลดหน้าแรกไม่สำเร็จ" message={error} onRetry={refresh} /> : <LoadingBlock />;
  }

  const { scope } = data;
  const liveNow = data.live.filter((s) => s.status === "live");
  const nextCamp = data.campaigns.find((c) => c.status === "upcoming");
  const liveCamp = data.campaigns.find((c) => c.status === "live");
  const gmvOver = data.issues.gmvOver ?? [];
  const gmvOdd = data.issues.gmvOdd ?? [];
  const h = data.health;
  const healthCount = h ? Object.values(h).reduce((n, list) => n + (list?.length ?? 0), 0) : 0;
  const windows = data.windows ?? [];
  const issueCount = data.issues.noEmail.length + data.issues.samePhone.length + gmvOver.length + gmvOdd.length + healthCount;
  const receipts = data.receipts ?? null;
  const tawi = data.tawi ?? null;
  const tawiCount = tawi ? tawi.unmatched.length + tawi.noEmail.length + (tawi.missingMonth ? 1 : 0) : 0;
  const monthsText = (months: string[]) => months.map(tawiMonthLabel).join(", ");

  const stats: { label: string; value: string; tone: "ok" | "warn" | "info"; target: string; show: boolean }[] = [
    { label: "ไลฟ์วันนี้", value: `${data.live.length} slot`, tone: "info", target: "home-live", show: scope.mc || scope.proofs },
    { label: "ยังไม่มี Mc (7 วัน)", value: String(data.noMc.length), tone: data.noMc.length ? "warn" : "ok", target: "home-nomc", show: scope.mc },
    { label: "ยังไม่มี Admin (7 วัน)", value: String(data.noAdmin.length), tone: data.noAdmin.length ? "warn" : "ok", target: "home-noadmin", show: scope.admin },
    { label: "หลักฐานค้าง (7 วัน)", value: String(data.missingProof.length), tone: data.missingProof.length ? "warn" : "ok", target: "home-pending", show: scope.mc || scope.proofs },
    { label: "GMV ยังไม่กรอก (7 วัน)", value: String(data.missingGmv.length), tone: data.missingGmv.length ? "warn" : "ok", target: "home-pending", show: scope.mc },
    {
      label: liveCamp ? "แคมเปญตอนนี้" : "แคมเปญถัดไป", value: liveCamp ? liveCamp.label : nextCamp ? `${nextCamp.label} · อีก ${nextCamp.daysUntil} วัน` : "–",
      tone: "info", target: "home-campaign", show: scope.mc,
    },
    {
      label: "เอกสารรับเงินยังไม่ครบ", value: receipts?.people.length ? `${receipts.people.length} คน` : "0",
      tone: receipts?.people.length ? "warn" : "ok", target: "home-receipts", show: !!receipts,
    },
    { label: "ใบ 50 ทวิที่ต้องจัดการ", value: String(tawiCount), tone: tawiCount ? "warn" : "ok", target: "home-tawi", show: !!tawi },
    { label: "ข้อมูลที่ควรแก้", value: String(issueCount), tone: issueCount ? "warn" : "ok", target: "home-issues", show: true },
  ];
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <MotionProvider>
    <div className="pb-10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">วันนี้ {dayText(data.today)}{liveNow.length ? ` · กำลังไลฟ์ ${liveNow.length} ช่อง` : ""}</span>
        <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={refresh}>
          <RefreshCwIcon className={cn(busy && "animate-spin")} />รีเฟรช
        </Button>
      </div>

      {/* ช่วงเปิดจองใกล้หมด / หมดแล้ว: เตือนให้เปิดรอบถัดไปก่อน Mc / Admin จองไม่ได้ */}
      {windows.length ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning-border bg-warning px-3 py-2.5 text-sm text-warning-foreground">
          <CalendarClockIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 leading-snug">
            {windows.map((w) => (
              <span key={w.role} className="block">
                <b>ช่วงเปิดจอง {w.role === "mc" ? "Mc" : w.role === "shopee" ? "Mc Shopee" : "Admin เสริม"}</b>{" "}
                {w.ended ? `หมดแล้ว (วันสุดท้าย ${fmtDay(w.to)}) — จองคิวใหม่ผ่านเว็บไม่ได้`
                  : w.daysLeft === 0 ? `หมดวันนี้ (${fmtDay(w.to)})` : `จะหมดในอีก ${w.daysLeft} วัน (วันสุดท้าย ${fmtDay(w.to)})`}
              </span>
            ))}
          </span>
          <GoButton onClick={() => { writeLocal(SLOT_VIEW_KEY, "daily"); go("owner", "slots"); }}>ตั้งช่วงเปิดจอง</GoButton>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.filter((s) => s.show).map((s, i) => (
          <Reveal key={s.label} index={i}>
            <button
              type="button" onClick={() => jump(s.target)}
              // ทุกช่องพื้นขาว: สีอยู่ที่ตัวเลขเท่านั้น (ส้ม = ต้องจัดการ / เขียว = ครบ / ดำ = ข้อมูล) หน้าจะไม่เป็นกล่องสีเต็มจอ
              className="size-full cursor-pointer rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {s.tone === "warn" ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning-foreground" /> : null}
                {s.label}
              </span>
              <span className={cn("flex items-center gap-1 text-lg font-bold", s.tone === "warn" ? "text-warning-foreground" : s.tone === "ok" ? "text-success" : "text-foreground")}>
                {s.tone === "ok" ? <CheckCircle2Icon className="size-4" /> : null}
                <span className="truncate">{s.tone === "ok" && s.value === "0" ? "ครบ" : s.value}</span>
              </span>
            </button>
          </Reveal>
        ))}
      </div>

      <MonthDashboard go={go} attempt={attempt} />

      {scope.mc || scope.proofs ? (
        <Section id="home-live" title="ไลฟ์วันนี้" icon={<RadioIcon />} action={<GoButton onClick={() => go("proof")}>หน้าหลักฐานไลฟ์</GoButton>}>
          {data.live.length ? (
            <ul className="divide-y">
              {data.live.map((s) => (
                <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm", s.status === "done" && "text-muted-foreground")}>
                  <span className="w-24 font-semibold tabular-nums">{s.start}–{s.end}</span>
                  <span className="w-24 truncate text-xs text-muted-foreground max-sm:w-auto max-sm:flex-1">{s.platform}</span>
                  {/* มือถือ: บรรทัดบน เวลา / ช่อง / สถานะ · บรรทัดล่าง ชื่อ Mc · Admin + หลักฐาน / GMV (บรรทัดเดียวชื่อเหลือแค่ 2–3 ตัวอักษร) */}
                  <span className="min-w-0 flex-1 truncate max-sm:order-2">
                    {s.mc ?? <span className="font-semibold text-warning-foreground">ยังไม่มี Mc</span>}
                    <span className="text-muted-foreground"> · {s.admin ?? "ยังไม่มี Admin"}</span>
                    {s.adminSlot && s.admin ? (
                      <AdminLate
                        late={s.adminSlot.late} canEdit={!!data.canAdminLate} started={s.status !== "next"}
                        onEdit={() => setLateTarget({ slotId: s.adminSlot!.id, who: s.admin!, when: `${dayText(s.date)} ${s.start}–${s.end} ${s.platform}`, late: s.adminSlot!.late })}
                      />
                    ) : null}
                  </span>
                  <StatusChip status={s.status} />
                  <span aria-hidden className="hidden max-sm:order-1 max-sm:block max-sm:basis-full" />
                  {s.status === "done" ? (
                    <span className="flex gap-1 max-sm:order-3">
                      <Check ok={s.proof || s.noProof} label={s.noProof ? "Mc ประจำ ไม่ต้องแนบ" : "หลักฐาน"} />
                      <Check ok={s.gmv} label="GMV" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <Empty>วันนี้ไม่มี slot ไลฟ์</Empty>}
        </Section>
      ) : null}

      {scope.mc ? (
        <Section id="home-nomc" title="ต้องหา Mc · 7 วันข้างหน้า" icon={<UserXIcon />} count={data.noMc.length} action={<GoButton onClick={() => go("owner", "slots")}>จัดการ slot</GoButton>}>
          <ByDate items={data.noMc} empty="ทุก slot ใน 7 วันข้างหน้ามี Mc แล้ว" render={(s) => (
            <>{s.platform} {s.start}–{s.end}{s.admin ? <span className="text-muted-foreground"> · Admin {s.admin}</span> : null}</>
          )} />
        </Section>
      ) : null}

      {scope.admin ? (
        <Section id="home-noadmin" title="ต้องหา Admin · 7 วันข้างหน้า" icon={<UserXIcon />} count={data.noAdmin.length} action={<GoButton onClick={() => go("owner", "slots")}>จัดการ slot</GoButton>}>
          <ByDate items={data.noAdmin} empty="ทุก slot ใน 7 วันข้างหน้ามี Admin แล้ว" render={(s) => (
            <>{s.platform} {s.start}–{s.end}{s.mc ? <span className="text-muted-foreground"> · {s.mc}</span> : null}</>
          )} />
        </Section>
      ) : null}

      {scope.mc || scope.proofs ? (
        <Section id="home-pending" title="งานค้าง · 7 วันล่าสุด" icon={<AlertTriangleIcon />} count={data.missingProof.length + data.missingGmv.length} action={<GoButton onClick={() => go("proof")}>หน้าหลักฐานไลฟ์</GoButton>}>
          <h3 className="mt-1 text-sm font-semibold">หลักฐานไลฟ์ยังไม่แนบ <span className="font-normal text-muted-foreground">({data.missingProof.length})</span></h3>
          <ByDate items={data.missingProof} empty="แนบหลักฐานครบแล้ว" render={(s) => (
            <>{s.platform} {s.start}–{s.end} · {s.mc}<span className="text-muted-foreground"> · Admin {s.admin ?? "–"}</span></>
          )} />
          {scope.mc ? (
            <>
              <h3 className="mt-3 text-sm font-semibold">GMV ยังไม่กรอก <span className="font-normal text-muted-foreground">({data.missingGmv.length})</span></h3>
              <ByDate items={data.missingGmv} empty="กรอก GMV ครบแล้ว (อันดับ Mc จะแม่นขึ้น)" render={(s) => (
                <>{s.platform} {s.start}–{s.end} · {s.mc}</>
              )} />
            </>
          ) : null}
        </Section>
      ) : null}

      {tawi ? (
        <Section
          id="home-tawi" title="ใบ 50 ทวิ" icon={<FileTextIcon />} count={tawiCount}
          action={<GoButton onClick={() => go("owner", "summary")}>แผงใบ 50 ทวิ</GoButton>}
        >
          {tawiCount ? (
            <div className="space-y-3 text-sm">
              {tawi.missingMonth ? (
                <IssueGroup
                  title={`ยังไม่มีใบ 50 ทวิ ${tawiMonthLabel(tawi.missingMonth)}`}
                  note="ในโฟลเดอร์หลักของใบ 50 ทวิยังไม่มีไฟล์ของเดือนนี้ — ให้ทีมบัญชีสร้างโฟลเดอร์รายเดือน (เช่น 09Sep) ในโฟลเดอร์หลัก แล้วกดตรวจไฟล์ใน Drive"
                  items={[<>Mc / Admin ยังไม่เห็นใบของเดือนนี้</>]}
                />
              ) : null}
              {tawi.unmatched.length ? (
                <IssueGroup
                  chips title="ชื่อในใบที่ยังไม่มีเจ้าของ"
                  note="เจ้าตัวไม่เห็นใบของตัวเอง — จับคู่ในแผงใบ 50 ทวิ (ชื่อในไฟล์สะกดผิด = แก้ชื่อไฟล์ใน Drive ก่อน) · คนนอกทีม กด &quot;ไม่ใช่คนในทีม&quot;"
                  items={tawi.unmatched.map((u) => <>{u.name} · {monthsText(u.months)}</>)}
                />
              ) : null}
              {tawi.noEmail.length ? (
                <IssueGroup
                  chips title="มีใบ 50 ทวิแต่ยังไม่มีอีเมล" note="เข้าเว็บมาดาวน์โหลดไม่ได้ — ใส่อีเมลที่หน้าพนักงาน"
                  items={tawi.noEmail.map((p) => <>{p.label} · {p.months.length} ใบ (ล่าสุด {tawiMonthLabel(p.months[p.months.length - 1])})</>)}
                />
              ) : null}
            </div>
          ) : <Empty>ใบ 50 ทวิจับคู่ครบ และทุกคนมีอีเมลแล้ว</Empty>}
        </Section>
      ) : null}

      {receipts ? (
        <Section
          id="home-receipts" title="เอกสารรับเงินยังไม่ครบ" icon={<ReceiptTextIcon />} count={receipts.people.length}
          action={<GoButton onClick={() => go("owner", "summary")}>แผงเอกสารรับเงิน</GoButton>}
        >
          {receipts.people.length ? (
            <>
              <p className="text-xs text-muted-foreground">
                มีใบ 50 ทวิแล้ว (ตั้งแต่ {tawiMonthLabel(receipts.requiredFrom)}) แต่ยังไม่มีเอกสารรับเงินที่ผ่าน — ดาวน์โหลดใบ 50 ทวิเดือนนั้นไม่ได้จนกว่าจะส่ง
                (ระบบเตือนเจ้าตัวทุก 3 วัน)
              </p>
              <IssueGroup
                chips title="รายชื่อ" note="ไม่มีอีเมล = เข้าเว็บมาส่งเองไม่ได้ ใส่อีเมลที่หน้าพนักงาน หรือให้ทีมบัญชีอัปไฟล์ลง Drive"
                items={receipts.people.map((p) => (
                  <>
                    {p.label}{p.shopee ? " (Shopee)" : ""} · {monthsText(p.months)}
                    {p.rejected.length ? <b> · ไม่ผ่าน ส่งใหม่</b> : null}
                    {!p.hasEmail ? " · ไม่มีอีเมล" : null}
                  </>
                ))}
              />
            </>
          ) : <Empty>ทุกคนส่งเอกสารรับเงินครบแล้ว</Empty>}
        </Section>
      ) : null}

      {scope.mc ? (
        <Section id="home-campaign" title="แคมเปญ · 30 วันข้างหน้า" icon={<CalendarClockIcon />} action={<GoButton onClick={() => go("owner", "performance")}>ผลงาน Mc</GoButton>}>
          {data.campaigns.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.campaigns.map((c) => (
                <div key={c.key} className={cn("rounded-lg border px-3 py-2", c.status === "live" ? "border-primary bg-primary/5" : "bg-card")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="font-semibold">{c.label}</b>
                    <span className={cn("text-xs font-semibold", c.status === "live" ? "text-primary" : "text-muted-foreground")}>
                      {c.status === "live" ? "กำลังดำเนินอยู่" : c.daysUntil === 0 ? "เริ่มวันนี้" : `อีก ${c.daysUntil} วัน`}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{windowText(c.start, c.end)} · {c.slots} slot</div>
                  {c.noMc ? <div className="mt-0.5 text-xs font-semibold text-warning-foreground">ยังไม่มี Mc {c.noMc} slot</div>
                    : <div className="mt-0.5 text-xs text-success">มี Mc ครบทุก slot</div>}
                </div>
              ))}
            </div>
          ) : <Empty>ไม่มีแคมเปญใน 30 วันข้างหน้า (ตั้งชื่อ Campaign ใน slot ที่หน้า Plan Slot Live)</Empty>}
        </Section>
      ) : null}

      <Section id="home-issues" title="ข้อมูลที่ควรแก้" icon={<AlertTriangleIcon />} count={issueCount} action={<GoButton onClick={() => go("owner", "staff")}>หน้าพนักงาน</GoButton>}>
        {issueCount ? (
          <div className="space-y-3 text-sm">
            {h?.sheetStuck?.length ? (
              <IssueGroup
                title="slot ที่ยังไม่ลงชีต"
                note={h.sheetStuck.some((x) => x.filtered)
                  ? "เว็บกับชีตไม่ตรงกัน — แท็บในชีตเปิดตัวกรอง (filter) อยู่ ระบบแทรกแถวไม่ได้ ปิดตัวกรองแล้วระบบจะเขียนให้เองภายใน 15 นาที"
                  : "เว็บกับชีตไม่ตรงกัน — ระบบเขียนลงชีตไม่สำเร็จ (ลองใหม่อัตโนมัติ) ถ้ายังค้างอยู่ แจ้งผู้ดูแลระบบ"}
                items={h.sheetStuck.map((x) => (
                  <><b>{dayText(x.date)} {x.platform} {x.time}</b> · {x.role === "mc" ? "แท็บ Deal Mc" : "แท็บ Admin เสริม"}{x.filtered ? " · เปิดตัวกรองอยู่" : x.error ? ` · ${x.error}` : ""}</>
                ))}
              />
            ) : null}
            {h?.overlap.length ? (
              <IssueGroup
                title="คนละคนอยู่ slot เดียวกัน" note="ชั่วโมงและค่าจ้างนับทั้งคู่ — เช็กว่าใครไลฟ์จริง แล้วลบอีกแถวในชีต"
                items={h.overlap.map((x) => <><b>{dayText(x.date)} {x.platform} {x.time}</b>: {x.names.join(" + ")}</>)}
                action={<GoButton onClick={() => go("owner", "slots")}>ตาราง slot</GoButton>}
              />
            ) : null}
            {h?.selfOverlap?.length ? (
              <IssueGroup
                title="คนเดียวกันอยู่หลาย slot เวลาทับกัน" note="ไลฟ์พร้อมกันไม่ได้ แต่ชั่วโมงและค่าจ้างนับทุก slot — เปลี่ยนคนใน slot ที่ไม่ได้ไลฟ์จริง"
                items={h.selfOverlap.map((x) => <><b>{dayText(x.date)} {x.name}</b>: {x.slots.join(" + ")}</>)}
                action={<GoButton onClick={() => go("owner", "slots")}>ตาราง slot</GoButton>}
              />
            ) : null}
            {h?.badCheckIn?.length ? (
              <IssueGroup
                title="หมายเหตุเวลาเข้างานใช้ไม่ได้" note="ระบบยังจ่ายเต็ม slot — แก้หมายเหตุในชีตเป็นรูปแบบ &quot;เข้า 10:00&quot; และเวลาต้องอยู่ในช่วง slot"
                items={h.badCheckIn.map((x) => <><b>{dayText(x.date)} {x.platform} {x.time}</b> · {x.name} · &quot;{x.text}&quot; {x.reason}</>)}
                action={<GoButton onClick={() => go("owner", "summary")}>สรุปรายเดือน</GoButton>}
              />
            ) : null}
            {h?.notFirm.length ? (
              <IssueGroup
                title="ไลฟ์ไปแล้ว แต่สถานะยัง &quot;ไม่เฟิร์ม&quot;" note="ระบบนับชั่วโมงและค่าจ้างให้แล้ว — ไลฟ์จริงเปลี่ยนเป็น &quot;เรียบร้อย&quot; ไม่ได้ไลฟ์เปลี่ยนเป็น &quot;แคน&quot;"
                items={h.notFirm.map((x) => <><b>{dayText(x.date)} {x.platform} {x.time}</b> · {x.name}</>)}
                action={<GoButton onClick={() => go("owner", "slots")}>ตาราง slot</GoButton>}
              />
            ) : null}
            {h?.noRate.length ? (
              <IssueGroup
                chips title="มีคิวเดือนนี้แต่ไม่ได้ตั้งค่าจ้าง" note="ยอดเงินในสรุปรายเดือนเป็น 0 — ตั้งค่าจ้าง หรือติ๊ก &quot;พนักงานประจำ&quot; ถ้าได้เงินเดือน"
                items={h.noRate.map((x) => <>{x.name} · {x.slots} คิว</>)}
                action={<GoButton onClick={() => go("owner", "staff")}>หน้าพนักงาน</GoButton>}
              />
            ) : null}
            {h?.dupRows.length ? (
              <IssueGroup
                title="slot ข้างหน้ามีแถวซ้ำในชีต" note="ช่องและเวลาเดียวกันมีหลายแถว — หน้าแรกจะนับแถวว่างเป็น &quot;ยังไม่มีคน&quot; หรือนับชั่วโมงซ้ำ"
                items={h.dupRows.map((x) => <><b>{dayText(x.date)} {x.platform} {x.time}</b> · {x.role === "mc" ? "แท็บ Deal Mc" : "แท็บ Admin เสริม"} {x.rows} แถว ({x.note})</>)}
                action={<GoButton onClick={() => go("owner", "slots")}>ตาราง slot</GoButton>}
              />
            ) : null}
            {h?.noPair.length ? (
              <IssueGroup
                title="slot ข้างหน้ามีแถวแค่ฝั่งเดียว" note="แท็บ Deal Mc กับ Admin เสริมไม่ตรงกัน — เพิ่มแถวที่ขาด หรือลบแถวที่ไม่ใช้"
                items={h.noPair.map((x) => <><b>{dayText(x.date)} {x.platform} {x.time}</b> · ไม่มีแถว{x.missing === "mc" ? "ในแท็บ Deal Mc" : "ในแท็บ Admin เสริม"}</>)}
                action={<GoButton onClick={() => go("owner", "slots")}>ตาราง slot</GoButton>}
              />
            ) : null}
            {h?.calendar.length ? (
              <IssueGroup
                chips title="คิวข้างหน้ายังไม่ขึ้นปฏิทิน" note="ส่วนใหญ่ยังไม่ได้แชร์ปฏิทินให้บัญชีระบบ — ส่งวิธีแชร์ได้จากหน้าพนักงาน"
                items={h.calendar.map((x) => <>{x.name} · {x.count} คิว</>)}
                action={<GoButton onClick={() => go("owner", "staff")}>หน้าพนักงาน</GoButton>}
              />
            ) : null}
            {h?.noPhone.length ? (
              <IssueGroup
                chips title="มีคิวข้างหน้าแต่ไม่มีเบอร์โทร" note="คู่ไลฟ์ติดต่อไม่ได้ (เบอร์ขึ้นในปฏิทินของคู่ไลฟ์)"
                items={h.noPhone.map((x) => <>{x.name} · {x.upcoming} คิว</>)}
                action={<GoButton onClick={() => go("owner", "staff")}>หน้าพนักงาน</GoButton>}
              />
            ) : null}
            {gmvOver.length ? (
              <div>
                <h3 className="font-semibold">GMV ที่กรอกรวมเกินยอดไลฟ์จริง <span className="font-normal text-muted-foreground">— น่าจะมี slot ที่กรอกยอดสะสมจากแดชบอร์ดโดยไม่ได้หัก slot ก่อนหน้า (ยอด / อันดับ Mc จะสูงเกินจริง)</span></h3>
                <ul className="mt-1 space-y-1 text-xs">
                  {gmvOver.map((g) => (
                    <li key={`${g.date}|${g.platform}|${g.from}`} className="rounded-lg border bg-card px-2.5 py-1.5 before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full before:bg-warning-foreground before:align-middle before:content-['']">
                      <b>{dayText(g.date)} {g.platform} {g.from}–{g.to}</b>: กรอกรวม {baht(g.entered)} แต่ไลฟ์จริง (ไฟล์ Export) {baht(g.actual)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {gmvOdd.length ? (
              <div>
                <h3 className="font-semibold">GMV ราย slot ผิดปกติ <span className="font-normal text-muted-foreground">— ต่างจากยอดประมาณจากไฟล์ Export มาก (พิมพ์เลขเกิน / ใส่ตัวเลขอื่นที่ไม่ใช่ GMV / ยอดสะสม)</span></h3>
                <ul className="mt-1 space-y-1 text-xs">
                  {gmvOdd.map((g) => (
                    <li key={`${g.date}|${g.platform}|${g.time}`} className="rounded-lg border bg-card px-2.5 py-1.5 before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full before:bg-warning-foreground before:align-middle before:content-['']">
                      <b>{dayText(g.date)} {g.platform} {g.time} {g.mc}</b>: กรอก {baht(g.gmv)} · ประมาณจาก Export {baht(g.est)} ({g.high ? "สูงกว่า" : "ต่ำกว่า"} {g.high ? (g.gmv / g.est).toFixed(1) : (g.est / Math.max(1, g.gmv)).toFixed(1)} เท่า)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {gmvOver.length || gmvOdd.length ? <GoButton onClick={() => go("proof")}>แก้ที่หน้าหลักฐานไลฟ์ (กรอก GMV)</GoButton> : null}
            {data.issues.noEmail.length ? (
              <div>
                <h3 className="font-semibold">มีคิวข้างหน้าแต่ยังไม่มีอีเมล <span className="font-normal text-muted-foreground">— login ไม่ได้ และคิวไม่ลงปฏิทิน</span></h3>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {data.issues.noEmail.map((p) => (
                    <li key={`${p.role}|${p.name}`} className="rounded-full border bg-card px-2.5 py-0.5 text-xs before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full before:bg-warning-foreground before:align-middle before:content-['']">
                      {p.role === "admin" ? `Admin ${p.name}` : p.name} · {p.upcoming} คิว
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.issues.samePhone.length ? (
              <div>
                <h3 className="font-semibold">เบอร์เดียวกันหลายรายชื่อ <span className="font-normal text-muted-foreground">— อาจลงชื่อซ้ำ ยอดและชั่วโมงจะแยกกัน</span></h3>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {data.issues.samePhone.map((g) => <li key={`${g.role}|${g.phone}`}>{g.names.join(" · ")} <span className="text-muted-foreground">({g.phone})</span></li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : <Empty>ไม่มีข้อมูลที่ต้องแก้</Empty>}
        {data.issues.noEmailTotal > data.issues.noEmail.length ? (
          <p className="mt-2 text-xs text-muted-foreground">ทั้งหมดมี {data.issues.noEmailTotal} รายชื่อที่ไม่มีอีเมล (ที่ไม่มีคิวข้างหน้าไม่ได้แสดง)</p>
        ) : null}
      </Section>

      {data.canBackup ? <BackupSection /> : null}

      <AdminLateDialog
        target={lateTarget} onClose={() => setLateTarget(null)}
        onSaved={(late) => {
          const id = lateTarget?.slotId;
          setData((d) => d && { ...d, live: d.live.map((x) => (x.adminSlot?.id === id ? { ...x, adminSlot: { ...x.adminSlot!, late } } : x)) });
        }}
      />
    </div>
    </MotionProvider>
  );
}

// ---------- ภาพรวมเดือนนี้ (แดชบอร์ด) ----------

const CUR = "var(--viz-cur)", PREV = "var(--viz-prev)";
const shortMonthOf = (key: string) => fmtMonthShort.format(parseKey(`${key}-01`));
const baht = (n: number) => `฿${money(n)}`;
/** "1–2 พ.ย." / "1 พ.ย." */
const rangeText = (upTo: string) => {
  const day = Number(upTo.slice(8)), month = shortMonthOf(upTo.slice(0, 7));
  return day === 1 ? `1 ${month}` : `1–${day} ${month}`;
};
/** วันเดียวกันของเดือนก่อน (เดือนก่อนสั้นกว่า = วันสุดท้าย) */
function sameDayPrev(date: string, prevMonth: string) {
  const [y, m] = prevMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${prevMonth}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`;
}

/**
 * ภาพรวมเดือนนี้ (โหลดแยกจากงานค้าง ไม่ให้หน้าแรกช้า): ตัวเลขหลักเทียบเดือนก่อนช่วงวันเดียวกัน · ชั่วโมงรายวัน · TikTok / Shopee · Mc ที่ไลฟ์มากที่สุด
 *   attempt = กดรีเฟรชหน้าแรก (โหลดใหม่ ตัวเลขเดิมค้างไว้จนข้อมูลใหม่มา) · ไม่มีสิทธิ์ฝั่ง Mc = ไม่แสดง
 */
function MonthDashboard({ go, attempt }: { go: Go; attempt: number }) {
  const [state, setState] = useState<{ data: DashboardData | null } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ dashboard: DashboardData | null }>("/api/owner/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setState({ data: res.dashboard }); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [attempt, retry]);

  if (state && !state.data) return null;
  const d = state?.data;
  return (
    <Section
      id="home-month" title={d ? `ภาพรวมเดือน${monthLabel(d.month)}` : "ภาพรวมเดือนนี้"} icon={<ChartColumnIcon />}
      action={<GoButton onClick={() => go("owner", "summary")}>สรุปรายเดือน</GoButton>}
    >
      {d ? <DashboardBody d={d} go={go} /> : error ? (
        <p className="py-2 text-sm text-destructive">
          โหลดภาพรวมไม่สำเร็จ: {error}{" "}
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="cursor-pointer font-semibold text-primary underline">ลองใหม่</button>
        </p>
      ) : <DashboardSkeleton />}
    </Section>
  );
}

/** ระหว่างโหลด: โครงเดียวกับตอนมีข้อมูล (ไม่กระโดดตอนข้อมูลมา) */
function DashboardSkeleton() {
  return (
    <div aria-busy className="mt-1">
      <div className="h-4 w-56 rounded bg-muted" />
      <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-card px-3 py-2.5">
            <div className="h-3 w-16 rounded bg-muted" /><div className="mt-2 h-6 w-20 rounded bg-muted" /><div className="mt-1.5 h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-4 h-[226px] rounded-lg bg-muted/60" />
    </div>
  );
}

function DashboardBody({ d, go }: { d: DashboardData; go: Go }) {
  const vs = `เทียบ ${rangeText(d.prevUpTo)}`;
  // GMV: เดือนก่อนนับถึงเวลาเดียวกับไลฟ์ล่าสุดในไฟล์ (หน้าสถิติไลฟ์นับทั้งวัน ตัวเลข % จึงต่างกันได้ — บอกเวลาไว้)
  const gmvVs = d.gmv?.upTo ? `เทียบ ${rangeText(sameDayPrev(d.gmv.upTo, d.prevMonth))} ถึง ${d.gmv.time} น.` : "";
  const kpis: { label: string; value: number | null; format: (n: number) => string; unit?: string; delta: ReactNode; note?: string }[] = [
    { label: "ชั่วโมงไลฟ์", value: d.hours.cur, format: (n) => num(Math.round(n * 100) / 100), unit: "ชม.", delta: <ChangeText cur={d.hours.cur} prev={d.hours.prev} suffix={vs} /> },
    { label: "คิวที่ไลฟ์", value: d.slots.cur, format: (n) => Math.round(n).toLocaleString("th-TH"), unit: "คิว", delta: <ChangeText cur={d.slots.cur} prev={d.slots.prev} suffix={vs} /> },
    ...(d.gmv ? [{
      label: "GMV (ไฟล์ Export)", value: d.gmv.cur, format: baht,
      note: d.gmv.upTo ? (d.gmv.upTo < d.upTo ? `ข้อมูลถึง ${fmtDayMonth.format(parseKey(d.gmv.upTo))}` : undefined) : "ยังไม่มีไฟล์ของเดือนนี้",
      delta: d.gmv.cur === null ? null : <ChangeText cur={d.gmv.cur} prev={d.gmv.prev} suffix={gmvVs} />,
    }] : []),
    ...(d.pay ? [{
      label: d.pay.sides.length === 2 ? "ค่าจ้างสะสม Mc + Admin" : d.pay.sides[0] === "admin" ? "ค่าจ้างสะสม Admin" : "ค่าจ้างสะสม Mc",
      value: d.pay.cur, format: baht, delta: <ChangeText cur={d.pay.cur} prev={d.pay.prev} suffix={vs} neutral />,
    }] : []),
  ];
  const todayIndex = d.daily.findIndex((x) => x.date === d.upTo);
  const planned = d.daily.some((x) => x.planned && x.hours > 0);
  const curName = shortMonthOf(d.month), prevName = shortMonthOf(d.prevMonth);

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {rangeText(d.upTo)} ถึงตอนนี้ {vs} ถึงเวลาเดียวกัน · นับคิวที่ถึงเวลาเริ่มไลฟ์แล้ว{d.mcCount ? ` · Mc ${d.mcCount} คน` : ""}
      </p>

      {/* ตัวเลขหลัก: กล่องเดียวแบ่งช่องด้วยเส้นบาง (มือถือ 2 คอลัมน์ · 3 ช่อง = ช่องสุดท้ายเต็มแถว) */}
      <Reveal>
        <dl className={cn("mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border", kpis.length === 4 ? "sm:grid-cols-4" : kpis.length === 3 ? "sm:grid-cols-3" : "")}>
          {kpis.map((k, i) => (
            <div key={k.label} className={cn("min-w-0 bg-card px-3 py-2.5", kpis.length === 3 && i === 2 && "col-span-2 sm:col-span-1")}>
              <dt className="truncate text-xs text-muted-foreground">{k.label}</dt>
              <dd className="text-xl font-semibold">
                {k.value === null ? <span className="text-muted-foreground">—</span> : <CountUp value={k.value} format={k.format} />}
                {k.unit && k.value !== null ? <span className="ml-1 text-xs font-normal text-muted-foreground">{k.unit}</span> : null}
              </dd>
              <dd className="mt-0.5 text-xs leading-snug">
                {k.delta}
                {k.note ? <span className="block text-muted-foreground">{k.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>

      <Reveal index={1} className="mt-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">ชั่วโมงไลฟ์รายวัน</h3>
          <Legend series={[
            { name: `${curName} ไลฟ์แล้ว`, color: CUR },
            ...(planned ? [{ name: "จองไว้", color: fadedColor(CUR) }] : []),
            { name: `${prevName} วันที่เดียวกัน`, color: PREV },
          ]} />
        </div>
        <BarChart
          label={`ชั่วโมงไลฟ์รายวัน ${curName} เทียบ ${prevName}`}
          categories={d.daily.map((x) => String(Number(x.date.slice(8))))}
          tooltipTitles={d.daily.map((x) => `${dayText(x.date)}${x.planned ? " · จองไว้" : ""}`)}
          series={[
            { name: curName, color: CUR, values: d.daily.map((x) => x.hours), faded: d.daily.map((x) => x.planned) },
            { name: prevName, color: PREV, values: d.daily.map((x) => x.prev) },
          ]}
          format={(v) => (v === null ? "—" : `${num(v)} ชม.`)} formatAxis={(v) => String(v)}
          highlight={todayIndex >= 0 ? todayIndex : undefined} height={200}
        />
      </Reveal>

      <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Reveal index={2}><PlatformSplit platforms={d.platforms} /></Reveal>
        <Reveal index={3}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Mc ที่ไลฟ์มากที่สุด</h3>
            <GoButton onClick={() => go("owner", "performance")}>ผลงาน Mc</GoButton>
          </div>
          {d.topMc.length ? (
            <ol className="divide-y">
              {d.topMc.map((m, i) => (
                <li key={m.name} className="flex items-start gap-2.5 py-2">
                  <span className="w-3 pt-px text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.slots} คิว{m.gmv !== null ? ` · GMV ที่กรอก ${baht(m.gmv)}` : ""}
                      {m.proofNeed ? <> · <span className={cn(m.proofDone < m.proofNeed && "font-semibold text-warning-foreground")}>หลักฐาน {m.proofDone}/{m.proofNeed}</span></> : null}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{num(m.hours)}<span className="ml-1 text-xs font-normal text-muted-foreground">ชม.</span></span>
                </li>
              ))}
            </ol>
          ) : <p className="py-2 text-sm text-muted-foreground">ยังไม่มีคิวที่ไลฟ์แล้วในเดือนนี้</p>}
        </Reveal>
      </div>
    </div>
  );
}

/** TikTok กับ Shopee: แถบสัดส่วนต่อเรื่อง (คิว / ชั่วโมง / Mc / ค่าจ้าง / GMV) ยาวตามสัดส่วนจริง */
function PlatformSplit({ platforms }: { platforms: DashboardData["platforms"] }) {
  const [tt, sp] = [platforms.find((p) => p.key === "tiktok")!, platforms.find((p) => p.key === "shopee")!];
  type Row = [string, number, number, (n: number) => string];
  const count = (n: number) => n.toLocaleString("th-TH");
  const rows: Row[] = [
    ["คิว", tt.slots, sp.slots, count],
    ["ชั่วโมง", tt.hours, sp.hours, (n) => `${num(n)} ชม.`],
    ["Mc ที่ไลฟ์", tt.mc, sp.mc, (n) => `${count(n)} คน`],
    ...(tt.pay !== null && sp.pay !== null ? [["ค่าจ้าง", tt.pay, sp.pay, baht] as Row] : []),
    ...(tt.gmv !== null && sp.gmv !== null ? [["GMV (ไฟล์ Export)", tt.gmv, sp.gmv, baht] as Row] : []),
  ];
  const SHOPEE = "var(--muted-foreground)";
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">TikTok กับ Shopee</h3>
        <Legend series={[{ name: "TikTok", color: CUR }, { name: "Shopee", color: SHOPEE }]} />
      </div>
      <div className="mt-1 space-y-3">
        {rows.map(([label, a, b, fmt]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">
                <b className="font-semibold">{fmt(a)}</b>
                <span className="text-muted-foreground"> · </span>
                <b className="font-semibold">{fmt(b)}</b>
              </span>
            </div>
            <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label} TikTok ${fmt(a)} Shopee ${fmt(b)}`}>
              {a > 0 ? <div className="bar-fill h-full" style={{ flex: `${a} 1 0`, background: CUR }} /> : null}
              {b > 0 ? <div className="bar-fill h-full" style={{ flex: `${b} 1 0`, background: SHOPEE }} /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type BackupFile = { name: string; at: string; sizeKB: number; url: string | null };
const fmtBackupAt = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });

/** สำรองข้อมูลลง Google Drive: ไฟล์ล่าสุด + ปุ่มสำรองตอนนี้ (อัตโนมัติทุกวันจันทร์เช้า) */
function BackupSection() {
  const toast = useToast();
  const [state, setState] = useState<{ folderUrl: string; files: BackupFile[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ folderUrl: string; files: BackupFile[] }>("/api/owner/backup")
      .then((res) => {
        if (!alive) return;
        if (res.ok) setState({ folderUrl: res.folderUrl, files: res.files });
        else setError(res.message ?? "โหลดไม่สำเร็จ");
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  async function runNow() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/owner/backup", {});
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      setTick((n) => n + 1);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const last = state?.files[0];
  return (
    <Section id="home-backup" title="สำรองข้อมูล" icon={<DatabaseBackupIcon />} action={state ? <GoButton onClick={() => window.open(state.folderUrl, "_blank", "noopener")}>เปิดโฟลเดอร์ใน Drive</GoButton> : undefined}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 leading-snug">
          {error ? <span className="text-destructive">{error}</span>
            : !state ? <span className="text-muted-foreground">กำลังโหลด...</span>
              : last ? <>ล่าสุด <b>{fmtBackupAt.format(new Date(last.at))}</b> <span className="text-muted-foreground">({last.sizeKB.toLocaleString("th-TH")} KB)</span></>
                : <span className="text-warning-foreground">ยังไม่เคยสำรอง</span>}
          <span className="block text-xs text-muted-foreground">สำรองอัตโนมัติทุกวันจันทร์เช้า ลง Google Drive ของบัญชีระบบ เก็บไว้ 12 ไฟล์ล่าสุด (ทุกตาราง ไม่รวมไฟล์รูป)</span>
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={runNow}>
          <RefreshCwIcon className={cn(busy && "animate-spin")} />{busy ? "กำลังสำรอง..." : "สำรองตอนนี้"}
        </Button>
      </div>
    </Section>
  );
}

function Section({ id, title, icon, count, action, children }: { id: string; title: string; icon: ReactNode; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-5 scroll-mt-4 rounded-xl border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-bold [&_svg]:size-4 [&_svg]:text-primary">
          {icon}{title}
          {count ? <span className="rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** กลุ่มเรื่องที่ควรแก้ 1 แบบ: หัวข้อ + คำอธิบาย + รายการ (แสดงไม่เกิน LIST_LIMIT กดดูเพิ่ม) · chips = แสดงเป็นป้ายเรียงกัน */
function IssueGroup({ title, note, items, action, chips = false }: {
  title: string; note: string; items: ReactNode[]; action?: ReactNode; chips?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  // รายการที่ต้องแก้: พื้นขาว ขอบเส้นบาง มีจุดส้มนำหน้า (ไม่ถมส้มทั้งกล่อง หลายรายการแล้วหน้าจะดูรก)
  const item = "border bg-card text-foreground before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full before:bg-warning-foreground before:align-middle before:content-['']";
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="font-semibold">{title} <span className="font-normal text-muted-foreground">({items.length}) — {note}</span></h3>
        {action}
      </div>
      <ul className={cn("mt-1 text-xs", chips ? "flex flex-wrap gap-1.5" : "space-y-1")}>
        {shown.map((x, i) => <li key={i} className={cn(item, chips ? "rounded-full px-2.5 py-0.5" : "rounded-lg px-2.5 py-1.5")}>{x}</li>)}
      </ul>
      {items.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="mt-1 cursor-pointer text-xs font-semibold text-primary underline pointer-coarse:py-2">ดูอีก {items.length - shown.length} รายการ</button>
      ) : null}
    </div>
  );
}

function GoButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs text-primary" onClick={onClick}>
      {children}<ChevronRightIcon />
    </Button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 py-1 text-sm text-success"><CheckCircle2Icon className="size-4" />{children}</p>;
}

/**
 * สถานะมาสายของ Admin ใน "ไลฟ์วันนี้": สายแล้ว = ป้ายส้ม (กดแก้ได้) · ยังไม่ได้ใส่ + คิวเริ่มแล้ว = ปุ่มเล็ก "มาสาย?"
 *   ใส่ได้เฉพาะ Owner ที่จัดการฝั่ง Admin (canEdit) · คนอื่นเห็นป้ายอย่างเดียว
 */
function AdminLate({ late, canEdit, started, onEdit }: { late: number | null; canEdit: boolean; started: boolean; onEdit: () => void }) {
  if (late) {
    const text = <>Admin สาย {late} นาที{lateCut(late) > 0 ? ` −${Math.round(lateCut(late) * 100)}%` : ""}</>;
    return canEdit
      ? <button type="button" onClick={onEdit} className="ml-1.5 cursor-pointer rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground hover:underline">{text}</button>
      : <span className="ml-1.5 rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground">{text}</span>;
  }
  return canEdit && started ? (
    <button type="button" onClick={onEdit} className="ml-1.5 cursor-pointer rounded-full border px-2 text-xs text-muted-foreground hover:border-primary hover:text-primary pointer-coarse:py-1">
      Admin มาสาย?
    </button>
  ) : null;
}

function StatusChip({ status }: { status: "done" | "live" | "next" }) {
  return status === "live" ? (
    <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
      <CircleIcon className="size-2 animate-pulse fill-current" />กำลังไลฟ์
    </span>
  ) : <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{status === "done" ? "จบแล้ว" : "ถัดไป"}</span>;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span title={`${label}: ${ok ? "เรียบร้อย" : "ยังไม่มี"}`} className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold", ok ? "bg-success/15 text-success" : "bg-warning text-warning-foreground")}>
      {ok ? "✓" : "✗"} {label === "GMV" ? "GMV" : "หลักฐาน"}
    </span>
  );
}

/** รายการจัดกลุ่มตามวัน (แสดงไม่เกิน LIST_LIMIT วัน ที่เหลือกดดูเพิ่ม) */
function ByDate({ items, empty, render }: { items: HomeSlot[]; empty: string; render: (s: HomeSlot) => ReactNode }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <Empty>{empty}</Empty>;
  const days = [...new Set(items.map((s) => s.date))].sort();
  const shown = all ? days : days.slice(0, LIST_LIMIT);
  return (
    <div className="space-y-1.5 text-sm">
      {shown.map((d) => {
        const list = items.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start) || a.platform.localeCompare(b.platform));
        return (
          <div key={d} className="flex gap-3">
            <span className="w-24 shrink-0 font-semibold">{dayText(d)} <span className="font-normal text-muted-foreground">({list.length})</span></span>
            <ul className="min-w-0 flex-1 space-y-0.5">{list.map((s) => <li key={s.id} className="truncate">{render(s)}</li>)}</ul>
          </div>
        );
      })}
      {days.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="cursor-pointer text-xs font-semibold text-primary underline pointer-coarse:py-2">ดูอีก {days.length - shown.length} วัน</button>
      ) : null}
    </div>
  );
}
