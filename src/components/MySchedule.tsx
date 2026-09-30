"use client";

import { useEffect, useState } from "react";
import type { MyItem, MyResponse } from "@/lib/types";
import { fmtDayLong, fmtDayShort, fmtHours, monthKey, monthLabel, money, parseKey, platformOf, relLabel } from "@/lib/format";
import { lateCut, paidHours } from "@/lib/pay";
import { Icon, IconBtn, MonthNav, Sheet, SheetHead, Stats, Tag, api, btn, useToast } from "@/components/ui";

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
  const rate = profile?.rate ?? 0;
  const paidOf = (list: MyItem[]) => list.reduce((a, i) => a + paidHours(i.hours, i.lateMinutes), 0);
  const total = Math.round(paidOf(active) * rate);
  const earned = Math.round(paidOf(active.filter((i) => i.endMs <= now)) * rate);
  const lateCutMoney = Math.round(hours * rate) - total;

  return (
    <>
      <Sheet open={open && !cancelItem} onClose={onClose} labelledBy="myTitle">
        <div className="flex items-start justify-between gap-3">
          <SheetHead id="myTitle" title="ตารางของฉัน" />
          <IconBtn label="ปิด" onClick={onClose}><Icon.close /></IconBtn>
        </div>
        <div className="mb-1 flex items-center gap-3 rounded-xl border border-line px-3 py-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-base font-bold text-brand-ink" aria-hidden>
            {(who.replace(/^Mc\s*/, "").match(/[ก-ฮA-Za-z0-9]/) ?? ["?"])[0]}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-semibold">{profile?.name ?? who}</span>
            <span className="block truncate text-xs text-muted">
              {profile ? [profile.email, profile.phone].filter(Boolean).join(" · ") : " "}
            </span>
          </span>
          <span className="shrink-0 text-right text-xs leading-tight text-muted">
            ค่าจ้าง
            <span className="block text-sm font-semibold text-ink">{profile ? (rate ? `${money(rate)} บาท/ชม.` : "ยังไม่ได้ตั้ง") : "–"}</span>
          </span>
        </div>
        <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />
        <Stats items={items
          ? [[String(active.length), "slot"], [Number.isInteger(hours) ? String(hours) : hours.toFixed(1), "ชั่วโมง"], [String(days), "วันที่มีคิว"]]
          : [["–", "slot"], ["–", "ชั่วโมง"], ["–", "วันที่มีคิว"]]} />
        {items && profile ? (
          rate ? (
            <div className="mb-3 rounded-xl bg-brand-soft px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted">ยอดรวมทั้งเดือน</span>
                <span className="text-xl font-bold text-brand tabular-nums">{money(total)} บาท</span>
              </div>
              <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted tabular-nums">
                <span>ไลฟ์แล้ว {money(earned)} บาท</span>
                <span>รอไลฟ์ {money(total - earned)} บาท</span>
              </div>
              {lateCutMoney > 0 ? (
                <div className="mt-1 text-xs font-semibold text-err tabular-nums">หักมาสายแล้ว {money(lateCutMoney)} บาท (ดูกฎการทำงาน)</div>
              ) : null}
            </div>
          ) : (
            <p className="mb-3 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn-ink">ยังไม่ได้ตั้งค่าจ้างต่อชั่วโมง ติดต่อทีมงานเพื่อดูยอดเงิน</p>
          )
        ) : null}
        <div className="mb-2">
          <button type="button" onClick={onOpenRules} className="text-sm font-semibold text-brand hover:underline">📋 กฎการทำงาน</button>
        </div>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {error && !items ? (
            <div className="py-6 text-center text-sm text-muted">
              <strong className="block text-ink">โหลดข้อมูลไม่สำเร็จ</strong>
              {error}
              <br />
              <button type="button" className={`${btn.ghost} mt-3`} onClick={reload}>ลองใหม่</button>
            </div>
          ) : !items ? (
            <div className="py-6 text-center text-sm text-muted">กำลังโหลด...</div>
          ) : !items.length ? (
            <div className="py-6 text-center text-sm text-muted">
              <strong className="block text-ink">เดือนนี้ยังไม่มีคิว</strong>
              {role === "admin" ? "เลือก slot ที่รอ Admin แล้วกดรับคิวได้เลย" : "เลือก slot ที่ว่างแล้วกดจองได้เลย"}
            </div>
          ) : (
            [...byDate.entries()].map(([k, list]) => (
              <section key={k} className="mb-3">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
                  {fmtDayLong.format(parseKey(k))}
                  {relLabel(k) ? <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] text-brand-ink">{relLabel(k)}</span> : null}
                </h3>
                {list.map((i) => {
                  const canCancel = !!data?.canCancel && !i.cancelled && i.startMs - now >= (data?.cancelMinHours ?? 6) * 3600_000;
                  return (
                    <div
                      key={i.id}
                      className={`mb-1.5 rounded-xl border border-line px-3 py-2 ${i.cancelled ? "opacity-60" : ""} ${i.endMs < now ? "bg-bg" : "bg-surface"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-semibold tabular-nums ${i.cancelled ? "line-through" : ""}`}>{i.start} – {i.end}</span>
                        <Tag name={platformOf(i)} index={0} />
                        <span className="ml-auto text-right text-sm text-muted">
                          {i.cancelled
                            ? <span className="rounded-full bg-err/15 px-2 py-0.5 text-xs font-semibold text-err">{i.status || "ยกเลิก"}</span>
                            : <>
                                {lateCut(i.lateMinutes) > 0 ? (
                                  <span className="mr-1.5 rounded-full bg-err/15 px-2 py-0.5 text-xs font-semibold text-err">
                                    สาย {i.lateMinutes} นาที −{Math.round(lateCut(i.lateMinutes) * 100)}%
                                  </span>
                                ) : null}
                                {fmtHours(i.hours)}
                                {rate ? <span className="ml-1.5 font-semibold text-ink tabular-nums">{money(paidHours(i.hours, i.lateMinutes) * rate)} บาท</span> : null}
                              </>}
                        </span>
                      </div>
                      {!i.cancelled ? (
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                          <span>
                            {i.pairName
                              ? <>{role === "admin" ? `ไลฟ์กับ ${i.pairName}` : `Admin: ${i.pairName}`}
                                {i.pairPhone ? <> · <a className="text-brand underline" href={`tel:${i.pairPhone.replace(/[^0-9+]/g, "")}`}>{i.pairPhone}</a></> : null}</>
                              : role === "admin" ? "Mc: ยังไม่มี Mc จอง" : "Admin: ยังไม่มี Admin"}
                          </span>
                          {canCancel ? (
                            <button type="button" onClick={() => setCancelItem(i)} className="shrink-0 rounded-full border border-err/40 px-2.5 py-0.5 font-semibold text-err hover:bg-err/10">
                              ยกเลิกคิว
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </Sheet>

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
    <Sheet open={!!item} onClose={() => onClose(state === "done")} busy={state === "busy"} labelledBy="cxTitle">
      <SheetHead id="cxTitle" title={state === "done" ? "ยกเลิกคิวแล้ว" : "ยกเลิกคิวนี้?"} note={note} />
      {item ? (
        <div className="flex items-center justify-between border-y border-line py-2.5">
          <div>
            <div className="font-semibold tabular-nums">{item.start} – {item.end}</div>
            <div className="text-xs text-muted">{fmtDayShort.format(parseKey(item.date))} | {platformOf(item)}</div>
          </div>
          <div className="text-sm text-muted">{fmtHours(item.hours)}</div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {state === "done" ? (
          <>
            {chatUrl ? <a className={btn.ghost} href={chatUrl} target="_blank" rel="noopener">ทักแชทแอดมิน</a> : null}
            <button type="button" className={btn.primary} onClick={() => onClose(true)}>ปิด</button>
          </>
        ) : (
          <>
            <button type="button" className={btn.ghost} disabled={state === "busy"} onClick={() => onClose(false)}>ไม่ยกเลิก</button>
            <button type="button" className={btn.danger} disabled={state === "busy"} onClick={submit}>
              {state === "busy" ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
