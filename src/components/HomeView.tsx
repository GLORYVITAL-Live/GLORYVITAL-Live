"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangleIcon, CalendarClockIcon, CheckCircle2Icon, ChevronRightIcon, CircleIcon, RadioIcon, RefreshCwIcon, UserXIcon } from "lucide-react";
import { windowText } from "@/lib/campaign";
import { fmtDayShort, parseKey } from "@/lib/format";
import type { HomeData, HomeSlot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LoadError, LoadingBlock, api } from "@/components/shared";
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
  const issueCount = data.issues.noEmail.length + data.issues.samePhone.length;

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
    { label: "ข้อมูลที่ควรแก้", value: String(issueCount), tone: issueCount ? "warn" : "ok", target: "home-issues", show: true },
  ];
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="pb-10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">วันนี้ {dayText(data.today)}{liveNow.length ? ` · กำลังไลฟ์ ${liveNow.length} ช่อง` : ""}</span>
        <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={refresh}>
          <RefreshCwIcon className={cn(busy && "animate-spin")} />รีเฟรช
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.filter((s) => s.show).map((s) => (
          <button
            key={s.label} type="button" onClick={() => jump(s.target)}
            className={cn(
              "cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-primary",
              s.tone === "warn" ? "border-warning-border bg-warning" : s.tone === "ok" ? "bg-card" : "bg-secondary",
            )}
          >
            <span className="block text-xs text-muted-foreground">{s.label}</span>
            <span className={cn("flex items-center gap-1 text-lg font-bold", s.tone === "warn" ? "text-warning-foreground" : s.tone === "ok" ? "text-success" : "text-primary")}>
              {s.tone === "ok" ? <CheckCircle2Icon className="size-4" /> : null}
              <span className="truncate">{s.tone === "ok" && s.value === "0" ? "ครบ" : s.value}</span>
            </span>
          </button>
        ))}
      </div>

      {scope.mc || scope.proofs ? (
        <Section id="home-live" title="ไลฟ์วันนี้" icon={<RadioIcon />} action={<GoButton onClick={() => go("proof")}>หน้าหลักฐานไลฟ์</GoButton>}>
          {data.live.length ? (
            <ul className="divide-y">
              {data.live.map((s) => (
                <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm", s.status === "done" && "text-muted-foreground")}>
                  <span className="w-24 font-semibold tabular-nums">{s.start}–{s.end}</span>
                  <span className="w-24 truncate text-xs text-muted-foreground">{s.platform}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.mc ?? <span className="font-semibold text-warning-foreground">ยังไม่มี Mc</span>}
                    <span className="text-muted-foreground"> · {s.admin ?? "ยังไม่มี Admin"}</span>
                  </span>
                  <StatusChip status={s.status} />
                  {s.status === "done" ? (
                    <span className="flex gap-1">
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
            {data.issues.noEmail.length ? (
              <div>
                <h3 className="font-semibold">มีคิวข้างหน้าแต่ยังไม่มีอีเมล <span className="font-normal text-muted-foreground">— login ไม่ได้ และคิวไม่ลงปฏิทิน</span></h3>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {data.issues.noEmail.map((p) => (
                    <li key={`${p.role}|${p.name}`} className="rounded-full border border-warning-border bg-warning px-2.5 py-0.5 text-xs text-warning-foreground">
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
    </div>
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
        <button type="button" onClick={() => setAll(true)} className="cursor-pointer text-xs font-semibold text-primary underline">ดูอีก {days.length - shown.length} วัน</button>
      ) : null}
    </div>
  );
}
