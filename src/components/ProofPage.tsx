"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDayLong, fmtDayMonth, parseKey, relLabel, todayKey } from "@/lib/format";
import { Icon, IconBtn, Sheet, SheetHead, StateBox, Tag, api, btn, useToast } from "@/components/ui";
import type { ProofSlot } from "@/lib/types";

type DayData = { date: string; all: boolean; slots: ProofSlot[] };
type MonthDay = { date: string; total: number; done: number };

const addDays = (k: string, n: number) => new Date(parseKey(k).getTime() + n * 86400_000).toISOString().slice(0, 10);
const hms = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const proofTime = (p: { startedAt: string; endedAt: string }) => `${hms.format(new Date(p.startedAt))}–${hms.format(new Date(p.endedAt))}`;
/** เวลา (ms) -> ค่าในช่อง datetime-local แบบเวลาไทย "YYYY-MM-DDTHH:mm:ss" */
const toInput = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 19);
const fromInput = (v: string) => Date.parse(`${v.length === 16 ? `${v}:00` : v}+07:00`);

/**
 * หน้าหลักฐานไลฟ์ (ใช้ทำเบิก): แนบรูปแดชบอร์ด TikTok LIVE + เวลาเริ่ม/จบจริง เข้า slot ของ Mc
 *   Admin เห็นเฉพาะ slot ที่ตัวเองเป็น Admin / Owner ฝั่ง Mc เห็นทุก slot
 *   ไลฟ์ครั้งเดียวคลุมหลาย slot -> ติ๊กหลาย slot (แพลตฟอร์มเดียวกัน) แล้วแนบรูปเดียว
 */
export function ProofPage() {
  const toast = useToast();
  const [date, setDate] = useState(() => todayKey());
  const [data, setData] = useState<DayData | null>(null);
  const [failed, setFailed] = useState<{ date: string; message: string } | null>(null);
  const [month, setMonth] = useState<{ key: string; days: MonthDay[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = () => setTick((n) => n + 1);
  const monthOf = date.slice(0, 7);

  useEffect(() => {
    let alive = true;
    api<DayData>(`/api/proofs?date=${date}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setFailed(null); }
      })
      .catch((err) => { if (alive) setFailed({ date, message: (err as Error).message }); });
    return () => { alive = false; };
  }, [date, tick]);

  useEffect(() => {
    let alive = true;
    api<{ days: MonthDay[] }>(`/api/proofs?month=${monthOf}`)
      .then((res) => { if (alive && res.ok) setMonth({ key: monthOf, days: res.days }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [monthOf, tick]);

  const day = data?.date === date ? data : null;
  const error = failed?.date === date ? failed.message : "";
  const missingDays = month?.key === monthOf ? month.days.filter((d) => d.done < d.total) : [];
  const shown = day ? day.slots.filter((s) => !onlyMissing || !s.proof) : [];
  const picked = day ? day.slots.filter((s) => selected.includes(s.mcSlotId)) : [];
  const done = day ? day.slots.filter((s) => s.proof).length : 0;

  const platforms = useMemo(() => [...new Set((day?.slots ?? []).map((s) => s.platform))], [day]);
  const groups = platforms
    .map((p) => ({ platform: p, slots: shown.filter((s) => s.platform === p) }))
    .filter((g) => g.slots.length);

  function goTo(next: string) {
    setDate(next);
    setSelected([]);
  }

  function toggle(s: ProofSlot) {
    if (selected.includes(s.mcSlotId)) return setSelected(selected.filter((x) => x !== s.mcSlotId));
    // ไลฟ์ 1 ครั้ง = 1 แพลตฟอร์ม เลือกคนละแพลตฟอร์ม = เริ่มเลือกใหม่
    if (picked.length && picked[0].platform !== s.platform) {
      toast(`เลือกได้ทีละแพลตฟอร์ม เริ่มเลือกใหม่ที่ ${s.platform}`);
      return setSelected([s.mcSlotId]);
    }
    setSelected([...selected, s.mcSlotId]);
  }

  async function remove(s: ProofSlot) {
    if (!s.proof || !confirm(`ลบหลักฐานไลฟ์ ${proofTime(s.proof)} ?\n(ถ้ารูปนี้ผูกกับหลาย slot จะหายจากทุก slot)`)) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/proofs", { id: s.proof.id }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-28">
      <p className="my-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-info-ink">
        แนบรูปแดชบอร์ด TikTok LIVE (หน้าที่มีวันที่และเวลาเริ่ม–จบไลฟ์) เป็นหลักฐานทำเบิก · ไลฟ์ครั้งเดียวคลุมหลาย slot ให้ติ๊กทุก slot แล้วแนบรูปเดียว
        {day && !day.all ? " · เห็นเฉพาะ slot ที่คุณเป็น Admin" : ""}
      </p>

      <div className="my-2 flex flex-wrap items-center gap-2">
        <IconBtn label="วันก่อนหน้า" onClick={() => goTo(addDays(date, -1))}><Icon.left /></IconBtn>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && goTo(e.target.value)}
          aria-label="เลือกวันที่"
          className="h-9 rounded-full border border-line bg-surface px-3 text-sm"
        />
        <IconBtn label="วันถัดไป" onClick={() => goTo(addDays(date, 1))}><Icon.right /></IconBtn>
        <button type="button" className={`${btn.ghost} !py-1.5`} onClick={() => goTo(todayKey())}>วันนี้</button>
      </div>

      {month?.key === monthOf ? (
        <div className="my-2 flex flex-wrap items-center gap-1.5 text-xs">
          {missingDays.length ? (
            <>
              <span className="font-semibold text-err">ยังขาดหลักฐานเดือนนี้:</span>
              {missingDays.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => goTo(d.date)}
                  className={`rounded-full border px-2 py-0.5 font-semibold ${d.date === date ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface hover:border-accent"}`}
                >
                  {fmtDayMonth.format(parseKey(d.date))} · ขาด {d.total - d.done}
                </button>
              ))}
            </>
          ) : month.days.length ? <span className="font-semibold text-ok">เดือนนี้แนบหลักฐานครบทุก slot แล้ว ✓</span> : null}
        </div>
      ) : null}

      <h2 className="mt-3 flex flex-wrap items-center gap-2 font-bold">
        {fmtDayLong.format(parseKey(date))}
        {relLabel(date) ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-brand-ink">{relLabel(date)}</span> : null}
        {day?.slots.length ? (
          <span className={`ml-auto text-xs font-medium ${done === day.slots.length ? "text-ok" : "text-muted"}`}>
            มีหลักฐาน {done}/{day.slots.length} slot
          </span>
        ) : null}
      </h2>
      {day?.slots.length ? (
        <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="size-4 accent-brand" />
          เฉพาะที่ยังไม่มีหลักฐาน
        </label>
      ) : null}

      {error && !day ? (
        <StateBox title="โหลดข้อมูลไม่สำเร็จ">
          {error}
          <br />
          <button type="button" className={`${btn.ghost} mt-3`} onClick={reload}>ลองอีกครั้ง</button>
        </StateBox>
      ) : !day ? (
        <div className="my-4 h-40 animate-pulse rounded-2xl bg-line/70" />
      ) : !day.slots.length ? (
        <StateBox title="วันนี้ไม่มี slot ให้แนบหลักฐาน">
          {day.all ? "ไม่มี slot ที่มี Mc ไลฟ์ในวันนี้" : "วันนี้คุณไม่ได้เป็น Admin ใน slot ไหน"}
        </StateBox>
      ) : !groups.length ? (
        <StateBox title="แนบหลักฐานครบทุก slot แล้ว ✓" />
      ) : (
        <div className="mt-2 space-y-4">
          {groups.map((g) => (
            <section key={g.platform}>
              <div className="mb-1.5"><Tag name={g.platform} index={platforms.indexOf(g.platform)} /></div>
              <div className="space-y-1.5">
                {g.slots.map((s) => {
                  const on = selected.includes(s.mcSlotId);
                  return (
                    <div
                      key={s.mcSlotId}
                      className={`flex items-start gap-3 rounded-xl border bg-surface p-3 ${on ? "border-brand ring-1 ring-brand" : "border-line"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(s)}
                        aria-label={`เลือก ${s.platform} ${s.start}–${s.end}`}
                        className="mt-1 size-5 shrink-0 accent-brand"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <button type="button" onClick={() => toggle(s)} className="text-left">
                          <span className="font-bold tabular-nums">{s.start}–{s.end}</span>
                          <span className="ml-2">{s.mcName || "—"}</span>
                          {day.all && s.adminName ? <span className="ml-2 text-muted">Admin {s.adminName}</span> : null}
                        </button>
                        {s.proof ? (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <a
                              href={`/api/proofs/image?id=${s.proof.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-ok underline"
                            >
                              ✓ ไลฟ์จริง {proofTime(s.proof)} (ดูรูป)
                            </a>
                            <span className="text-muted">แนบโดย {s.proof.by}</span>
                            {s.proof.canDelete ? (
                              <button type="button" disabled={busy} onClick={() => remove(s)} className="font-semibold text-err hover:underline">
                                ลบ
                              </button>
                            ) : null}
                          </div>
                        ) : <div className="mt-1 text-xs font-semibold text-err">ยังไม่มีหลักฐาน</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {picked.length ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-[760px] items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <strong>เลือก {picked.length} slot</strong>
              <span className="block truncate text-xs text-muted">
                {picked[0].platform} · {picked.map((s) => `${s.start}–${s.end}`).join(", ")}
              </span>
            </div>
            <button type="button" className={btn.ghost} onClick={() => setSelected([])}>ล้าง</button>
            <button type="button" className={btn.primary} onClick={() => setUploadOpen(true)}>แนบหลักฐาน</button>
          </div>
        </div>
      ) : null}

      {uploadOpen && picked.length ? (
        <UploadDialog
          slots={[...picked].sort((a, b) => a.startMs - b.startMs)}
          onClose={(saved) => {
            setUploadOpen(false);
            if (saved) { setSelected([]); reload(); }
          }}
        />
      ) : null}
    </div>
  );
}

/** ย่อรูปให้กว้างไม่เกิน 1600px เป็น JPG (ตัวหนังสือในแดชบอร์ดยังอ่านได้ ไฟล์เล็กลงมาก) */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG"));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("ย่อรูปไม่สำเร็จ");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function UploadDialog({ slots, onClose }: { slots: ProofSlot[]; onClose: (saved: boolean) => void }) {
  const toast = useToast();
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [start, setStart] = useState(() => toInput(slots[0].startMs));
  const [end, setEnd] = useState(() => toInput(slots[slots.length - 1].endMs));
  const [busy, setBusy] = useState(false);
  const replacing = slots.filter((s) => s.proof).length;

  async function takeFile(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("กรุณาเลือกไฟล์รูป", "error");
    try {
      const blob = await shrink(file);
      setImage((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  // วางรูปจากคลิปบอร์ดได้ (แคปหน้าจอแล้วกด Ctrl + V)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith("image/"));
      if (item) { e.preventDefault(); takeFile(item.getAsFile()); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const startMs = fromInput(start), endMs = fromInput(end);
  const span = endMs - startMs;
  const invalid = !start || !end || Number.isNaN(span) ? "ใส่เวลาเริ่มและจบให้ครบ"
    : span <= 0 ? "เวลาจบต้องหลังเวลาเริ่ม" : span > 24 * 3600_000 ? "ช่วงเวลายาวเกิน 24 ชั่วโมง ตรวจวันที่อีกครั้ง" : "";
  const spanText = invalid ? "" : (() => {
    const s = Math.round(span / 1000);
    return `${Math.floor(s / 3600)} ชม. ${Math.floor((s % 3600) / 60)} นาที ${s % 60} วินาที`;
  })();

  async function save() {
    if (!image || invalid) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", image.blob, "proof.jpg");
      fd.append("slotIds", JSON.stringify(slots.map((s) => s.mcSlotId)));
      fd.append("startedAt", start);
      fd.append("endedAt", end);
      const res = await fetch("/api/proofs", { method: "POST", body: fd });
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!json?.ok) throw new Error(json?.message ?? `อัปโหลดไม่สำเร็จ (HTTP ${res.status})`);
      toast(json.message ?? "แนบหลักฐานแล้ว");
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const field = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";
  return (
    <Sheet open onClose={() => onClose(false)} busy={busy} labelledBy="proof-title">
      <SheetHead
        id="proof-title"
        title="แนบหลักฐานไลฟ์"
        note={`${slots[0].platform} · ${slots.map((s) => `${s.start}–${s.end} ${s.mcName}`).join(" / ")}`}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div>
          <label className="mb-1 block text-sm font-semibold" htmlFor="proof-file">รูปแดชบอร์ด TikTok LIVE</label>
          <input
            id="proof-file"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => takeFile(e.target.files?.[0])}
            className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-2 file:font-semibold file:text-brand"
          />
          <p className="mt-1 text-xs text-muted">เลือกไฟล์ หรือแคปหน้าจอแล้วกด Ctrl + V ที่หน้านี้ · ต้องเห็นวันที่และเวลาเริ่ม–จบไลฟ์ในรูป</p>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt="ตัวอย่างรูปหลักฐาน" className="mt-2 max-h-72 w-full rounded-lg border border-line object-contain" />
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">เริ่มไลฟ์จริง</span>
            <input type="datetime-local" step={1} value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">จบไลฟ์จริง</span>
            <input type="datetime-local" step={1} value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        </div>
        <p className={`rounded-lg px-3 py-2 text-sm ${invalid ? "border border-warn-line bg-warn-bg text-warn-ink" : "bg-brand-soft text-info-ink"}`}>
          {invalid || <>ไลฟ์จริง <strong>{spanText}</strong> · แก้ให้ตรงกับในรูป (ระบบใส่เวลาตาม slot ไว้ให้ก่อน)</>}
        </p>
        {replacing ? (
          <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink">
            มี {replacing} slot ที่แนบหลักฐานไว้แล้ว จะถูกแทนที่ด้วยรูปนี้
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btn.ghost} disabled={busy} onClick={() => onClose(false)}>ยกเลิก</button>
        <button type="button" className={btn.primary} disabled={busy || !image || !!invalid} onClick={save}>
          {busy ? "กำลังอัปโหลด..." : `บันทึกให้ ${slots.length} slot`}
        </button>
      </div>
    </Sheet>
  );
}
