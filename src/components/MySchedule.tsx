"use client";

import { useEffect, useState } from "react";
import type { MyItem, MyResponse } from "@/lib/types";
import { fmtDayLong, fmtDayShort, fmtHours, monthKey, monthLabel, money, parseKey, platformOf, relLabel } from "@/lib/format";
import { bonusPaidMinutes, lateCut, monthRate, paidHours, slotPaidHours, tiersLabel } from "@/lib/pay";
import { ClipboardListIcon } from "lucide-react";
import {
  AppDialog, DayBadge, DialogActions, DialogBody, MonthNav, PlatformBadge, Stats, api, useToast,
} from "@/components/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** "ตารางของฉัน" (กดที่โปรไฟล์มุมขวาบน) + ยกเลิกคิว */
export function MySchedule({ open, onClose, role, who, onOpenRules }: {
  open: boolean;
  onClose: () => void;
  role: "mc" | "admin";
  who: string;
  onOpenRules: () => void;
}) {
  const toast = useToast();
  const [month, setMonth] = useState(() => monthKey());
  const [data, setData] = useState<MyResponse | null>(null);
  const [failed, setFailed] = useState<{ month: string; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cancelItem, setCancelItem] = useState<MyItem | null>(null);

  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<MyResponse>(`/api/my?role=${role}&month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setFailed(null); }
      })
      .catch((err) => { if (alive) setFailed({ month, message: (err as Error).message }); })
      .finally(() => { if (alive) setNow(Date.now()); });
    return () => { alive = false; };
  }, [open, month, role, tick]);

  const items = data?.month === month ? data.items : null;
  const error = failed?.month === month ? failed.message : "";
  const active = items?.filter((i) => !i.cancelled) ?? [];
  const hours = active.reduce((a, i) => a + i.hours, 0);
  const days = new Set(active.map((i) => i.date)).size;
  const byDate = new Map<string, MyItem[]>();
  for (const i of items ?? []) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);

  // ค่าจ้าง = ชั่วโมงที่ได้เงิน (หักมาสายแล้ว) x ค่าจ้างต่อชั่วโมง (สูตรเดียวกับหน้าสรุปของเจ้าของ) ไม่นับคิวที่ยกเลิก
  const profile = data?.profile;
  // Commit แบบเทียร์: จองในเดือนนี้ถึงเทียร์ไหน -> ทุกชั่วโมงของเดือนคิดราคาเทียร์นั้น
  const commit = monthRate(profile?.rate ?? 0, profile?.commitTiers, hours);
  const rate = commit.rate;
  const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));
  // ชั่วโมงที่ได้เงิน = หลังหักมาสาย + ไลฟ์ชดเชย (ปัดขึ้นทีละ 15 นาที)
  const paidOf = (list: MyItem[]) => list.reduce((a, i) => a + slotPaidHours(i.hours, i.lateMinutes, i.bonusMinutes), 0);
  const total = Math.round(paidOf(active) * rate);
  const earned = Math.round(paidOf(active.filter((i) => i.endMs <= now)) * rate);
  const lateCutMoney = Math.round(active.reduce((a, i) => a + i.hours - paidHours(i.hours, i.lateMinutes), 0) * rate);
  const bonusMin = active.reduce((a, i) => a + bonusPaidMinutes(i.bonusMinutes), 0);
  const bonusMoney = Math.round((bonusMin / 60) * rate);

  return (
    <>
      <AppDialog open={open && !cancelItem} onClose={onClose} title="ตารางของฉัน">
        <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
          <Avatar size="lg" aria-hidden>
            <AvatarFallback className="bg-primary text-base font-bold text-primary-foreground">
              {(who.replace(/^Mc\s*/, "").match(/[ก-ฮA-Za-z0-9]/) ?? ["?"])[0]}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-semibold">{profile?.name ?? who}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {profile ? [profile.email, profile.phone].filter(Boolean).join(" · ") : " "}
            </span>
          </span>
          <span className="shrink-0 text-right text-xs leading-tight text-muted-foreground">
            ค่าจ้าง
            <span className="block text-sm font-semibold text-foreground">{profile ? (rate ? `${money(rate)} บาท/ชม.` : "ยังไม่ได้ตั้ง") : "–"}</span>
            {commit.hasCommit ? (
              <span className={cn("block text-[11px]", commit.tier && "text-success")}>
                {commit.tier ? `Commit ${commit.tier.hours}+ ชม. ✓` : "มี Commit"}
              </span>
            ) : null}
          </span>
        </div>
        <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />
        <Stats items={items
          ? [[String(active.length), "slot"], [Number.isInteger(hours) ? String(hours) : hours.toFixed(1), "ชั่วโมง"], [String(days), "วันที่มีคิว"]]
          : [["–", "slot"], ["–", "ชั่วโมง"], ["–", "วันที่มีคิว"]]} />
        {items && profile ? (
          rate ? (
            <div className="rounded-xl bg-secondary px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">ยอดรวมทั้งเดือน</span>
                <span className="text-xl font-bold text-primary tabular-nums">{money(total)} บาท</span>
              </div>
              <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>ไลฟ์แล้ว {money(earned)} บาท</span>
                <span>รอไลฟ์ {money(total - earned)} บาท</span>
              </div>
              {lateCutMoney > 0 ? (
                <div className="mt-1 text-xs font-semibold text-destructive tabular-nums">หักมาสายแล้ว {money(lateCutMoney)} บาท (ดูกฎการทำงาน)</div>
              ) : null}
              {bonusMoney > 0 ? (
                <div className="mt-1 text-xs font-semibold text-success tabular-nums">รวมไลฟ์ชดเชย {bonusMin} นาที +{money(bonusMoney)} บาท</div>
              ) : null}
              {commit.hasCommit ? (
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {commit.tier
                    ? `จองเดือนนี้ ${hoursText(hours)} ชม. ถึงเทียร์ ${commit.tier.hours}+ ชม. ทุกชั่วโมงคิด ${money(commit.tier.rate)} บาท/ชม.`
                    : `จองเดือนนี้ ${hoursText(hours)} ชม. ยังไม่ถึงเทียร์แรก คิดราคาปกติ ${money(profile.rate)} บาท/ชม.`}
                  {commit.next ? ` · อีก ${hoursText(commit.next.hours - hours)} ชม. ถึงเทียร์ ${commit.next.hours}+ (${money(commit.next.rate)} บาท/ชม.)` : ""}
                  <span className="mt-0.5 block text-[11px]">Commit: {tiersLabel(profile.rate, commit.tiers)}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-xl border border-warning-border bg-warning px-3 py-2 text-xs text-warning-foreground">ยังไม่ได้ตั้งค่าจ้างต่อชั่วโมง ติดต่อทีมงานเพื่อดูยอดเงิน</p>
          )
        ) : null}
        <div>
          <Button variant="link" onClick={onOpenRules} className="h-auto px-0 font-semibold">
            <ClipboardListIcon />กฎการทำงาน
          </Button>
        </div>

        <DialogBody>
          {error && !items ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <strong className="block text-foreground">โหลดข้อมูลไม่สำเร็จ</strong>
              {error}
              <br />
              <Button variant="outline" className="mt-3" onClick={reload}>ลองใหม่</Button>
            </div>
          ) : !items ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Spinner />กำลังโหลด...</div>
          ) : !items.length ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <strong className="block text-foreground">เดือนนี้ยังไม่มีคิว</strong>
              {role === "admin" ? "เลือก slot ที่รอ Admin แล้วกดรับคิวได้เลย" : "เลือก slot ที่ว่างแล้วกดจองได้เลย"}
            </div>
          ) : (
            [...byDate.entries()].map(([k, list]) => (
              <section key={k} className="mb-3">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
                  {fmtDayLong.format(parseKey(k))}
                  <DayBadge label={relLabel(k)} />
                </h3>
                {list.map((i) => {
                  const canCancel = !!data?.canCancel && !i.cancelled && i.startMs - now >= (data?.cancelMinHours ?? 6) * 3600_000;
                  return (
                    <div
                      key={i.id}
                      className={cn("mb-1.5 rounded-xl border px-3 py-2", i.cancelled && "opacity-60", i.endMs < now ? "bg-muted" : "bg-card")}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-semibold tabular-nums", i.cancelled && "line-through")}>{i.start} – {i.end}</span>
                        <PlatformBadge name={platformOf(i)} index={0} />
                        <span className="ml-auto text-right text-sm text-muted-foreground">
                          {i.cancelled
                            ? <Badge variant="destructive" className="font-semibold">{i.status || "ยกเลิก"}</Badge>
                            : <>
                                {lateCut(i.lateMinutes) > 0 ? (
                                  <Badge variant="destructive" className="mr-1.5 font-semibold">
                                    สาย {i.lateMinutes} นาที −{Math.round(lateCut(i.lateMinutes) * 100)}%{i.lateFromProof ? " (จากหลักฐานไลฟ์)" : ""}
                                  </Badge>
                                ) : null}
                                {fmtHours(i.hours)}
                                {bonusPaidMinutes(i.bonusMinutes) > 0 ? (
                                  <Badge className="mx-1.5 bg-success/15 font-semibold text-success">
                                    ชดเชย +{i.bonusMinutes} นาที{i.bonusFromProof ? " (จากหลักฐานไลฟ์)" : ""}
                                  </Badge>
                                ) : null}
                                {rate ? <span className="ml-1.5 font-semibold text-foreground tabular-nums">{money(slotPaidHours(i.hours, i.lateMinutes, i.bonusMinutes) * rate)} บาท</span> : null}
                              </>}
                        </span>
                      </div>
                      {!i.cancelled ? (
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {i.pairName
                              ? <>{role === "admin" ? `ไลฟ์กับ ${i.pairName}` : `Admin: ${i.pairName}`}
                                {i.pairPhone ? <> · <a className="text-primary underline" href={`tel:${i.pairPhone.replace(/[^0-9+]/g, "")}`}>{i.pairPhone}</a></> : null}</>
                              : role === "admin" ? "Mc: ยังไม่มี Mc จอง" : "Admin: ยังไม่มี Admin"}
                          </span>
                          {canCancel ? (
                            <Button variant="destructive" size="xs" className="rounded-full font-semibold" onClick={() => setCancelItem(i)}>
                              ยกเลิกคิว
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </DialogBody>
      </AppDialog>

      <CancelDialog
        key={cancelItem?.id ?? 0}
        item={cancelItem}
        role={role}
        cancelMinHours={data?.cancelMinHours ?? 6}
        adminChatUrl={data?.adminChatUrl ?? ""}
        onClose={(changed) => {
          setCancelItem(null);
          if (changed) { reload(); toast("ยกเลิกคิวแล้ว"); }
        }}
      />
    </>
  );
}

function CancelDialog({ item, role, cancelMinHours, adminChatUrl, onClose }: {
  item: MyItem | null;
  role: "mc" | "admin";
  cancelMinHours: number;
  adminChatUrl: string;
  onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  // เปลี่ยน item = mount ใหม่ (ใช้ key) state จึงเริ่มจากค่าตั้งต้นทุกครั้ง
  const [state, setState] = useState<"confirm" | "busy" | "done">("confirm");
  const [note, setNote] = useState(() => {
    const who = role === "admin" ? "Admin เสริมคนอื่นรับ" : "Mc คนอื่นจอง";
    return `ยกเลิกผ่านเว็บได้ก่อนเวลาไลฟ์อย่างน้อย ${cancelMinHours} ชั่วโมง ระบบจะลบ event ในปฏิทินและเปิด slot นี้ให้${who}ทันที หลังยกเลิกกรุณาทักแชทแจ้งแอดมินด้วย`;
  });
  const [chatUrl, setChatUrl] = useState(adminChatUrl);

  async function submit() {
    if (!item) return;
    setState("busy");
    try {
      // ไม่ลองซ้ำอัตโนมัติ: ถ้าคำขอแรกสำเร็จแล้ว ครั้งที่สองจะขึ้นว่าไม่ใช่คิวของคุณ
      const res = await api<{ adminChatUrl: string }>("/api/cancel", { role, id: item.id });
      if (!res.ok) { setState("confirm"); setNote(res.message ?? ""); toast(res.message ?? "ยกเลิกไม่สำเร็จ", "error"); return; }
      if (res.adminChatUrl) setChatUrl(res.adminChatUrl);
      setNote("⚠️ อย่าลืมทักแชทแจ้งแอดมินว่ายกเลิกคิวนี้ เพื่อให้ทีมหาคนแทนได้ทัน");
    } catch {
      setNote('ไม่ได้รับคำตอบจากระบบ ปิดหน้าต่างนี้แล้วเปิด "ตารางของฉัน" ใหม่ ถ้าคิวหายไปแปลว่ายกเลิกสำเร็จแล้ว');
    }
    setState("done");
  }

  return (
    <AppDialog
      open={!!item}
      onClose={() => onClose(state === "done")}
      busy={state === "busy"}
      title={state === "done" ? "ยกเลิกคิวแล้ว" : "ยกเลิกคิวนี้?"}
      description={note}
    >
      {item ? (
        <div className="flex items-center justify-between border-y py-2.5">
          <div>
            <div className="font-semibold tabular-nums">{item.start} – {item.end}</div>
            <div className="text-xs text-muted-foreground">{fmtDayShort.format(parseKey(item.date))} | {platformOf(item)}</div>
          </div>
          <div className="text-sm text-muted-foreground">{fmtHours(item.hours)}</div>
        </div>
      ) : null}
      <DialogActions>
        {state === "done" ? (
          <>
            {chatUrl ? (
              <Button variant="outline" size="lg" asChild>
                <a href={chatUrl} target="_blank" rel="noopener">ทักแชทแอดมิน</a>
              </Button>
            ) : null}
            <Button size="lg" onClick={() => onClose(true)}>ปิด</Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="lg" disabled={state === "busy"} onClick={() => onClose(false)}>ไม่ยกเลิก</Button>
            <Button variant="danger" size="lg" disabled={state === "busy"} onClick={submit}>
              {state === "busy" ? <><Spinner />กำลังยกเลิก...</> : "ยืนยันยกเลิก"}
            </Button>
          </>
        )}
      </DialogActions>
    </AppDialog>
  );
}
