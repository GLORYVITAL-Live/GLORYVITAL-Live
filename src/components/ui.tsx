"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";

// ---------- เรียก API ----------

export async function api<T>(
  url: string,
  body?: object,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
): Promise<T & { ok: boolean; message?: string; authError?: boolean }> {
  let res: Response;
  try {
    res = await fetch(url, body
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { cache: "no-store" });
  } catch {
    throw new Error("เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต");
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("ระบบตอบกลับผิดรูปแบบ (HTTP " + res.status + ")");
  return data;
}

// ---------- ค่าที่จำไว้ในเครื่อง ----------

export function readLocal(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
  window.dispatchEvent(new Event("glory-local"));
}

function subscribeLocal(cb: () => void) {
  window.addEventListener("glory-local", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("glory-local", cb);
    window.removeEventListener("storage", cb);
  };
}

/** ค่าใน localStorage แบบ reactive (ฝั่ง server / ตอน hydrate ใช้ค่า null) */
export function useLocal(key: string) {
  return useSyncExternalStore(subscribeLocal, () => readLocal(key), () => null);
}

const noopSubscribe = () => () => {};
/** true เมื่อทำงานใน browser แล้ว (false ตอน render ฝั่ง server และตอน hydrate) */
export function useIsHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

/** ธีมมืดอยู่หรือไม่ (อ่านจาก class "dark" ที่ <html>) */
export function useIsDark() {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
}

// ---------- toast ----------

type Toast = { message: string; error: boolean; id: number };
const ToastCtx = createContext<(message: string, type?: "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((message: string, type?: "error") => {
    setToast({ message, error: type === "error", id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg transition-all duration-200 bottom-[calc(24px+env(safe-area-inset-bottom))] ${
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        } ${toast?.error ? "bg-err text-white" : "bg-ink text-bg"}`}
      >
        {toast?.message}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- หน้าต่าง (dialog) ----------

export function Sheet({ open, onClose, busy, labelledBy, children }: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onClose(); }}
    >
      <div className="flex max-h-[88dvh] flex-col p-5 pb-[calc(20px+env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}

export function SheetHead({ id, title, note }: { id: string; title: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-bold">{title}</h2>
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

// ---------- ปุ่ม ----------

const BTN = "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
export const btn = {
  primary: `${BTN} bg-brand text-brand-ink hover:brightness-105`,
  ghost: `${BTN} border border-line bg-surface text-ink hover:border-accent`,
  danger: `${BTN} bg-err text-white hover:brightness-105`,
};

export function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink hover:border-accent hover:text-brand [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}

// ---------- ชิ้นส่วนที่ใช้ซ้ำ ----------

export const TAG_COLORS = [
  "bg-p0/15 text-p0",
  "bg-p1/15 text-p1",
  "bg-p2/15 text-p2",
  "bg-p3/15 text-p3",
];

export function Tag({ name, index }: { name: string; index: number }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_COLORS[index % 4]}`}>{name}</span>
  );
}

export function StateBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="my-6 rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
      <strong className="mb-1 block text-base text-ink">{title}</strong>
      {children}
    </div>
  );
}

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconBtn label="เดือนก่อนหน้า" onClick={onPrev}><Icon.left /></IconBtn>
      <strong aria-live="polite">{label}</strong>
      <IconBtn label="เดือนถัดไป" onClick={onNext}><Icon.right /></IconBtn>
    </div>
  );
}

export function Stats({ items }: { items: [string, string][] }) {
  return (
    <div className="my-3 grid grid-cols-3 gap-2">
      {items.map(([n, l]) => (
        <div key={l} className="rounded-xl bg-brand-soft px-3 py-2.5 text-center">
          <span className="block text-xl font-bold text-brand">{n}</span>
          <span className="text-xs text-muted">{l}</span>
        </div>
      ))}
    </div>
  );
}

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
export const Icon = {
  left: () => <svg {...svg}><path d="M15 6l-6 6 6 6" /></svg>,
  right: () => <svg {...svg}><path d="M9 6l6 6-6 6" /></svg>,
  close: () => <svg {...svg}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  moon: () => <svg {...svg} strokeWidth={1.8}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
  sun: () => <svg {...svg} strokeWidth={1.8}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>,
  signOut: () => <svg {...svg} strokeWidth={1.8}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></svg>,
  check: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>,
  up: () => <svg {...svg} strokeWidth={2.2}><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  grid: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></svg>,
  rows: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden><path d="M2 4h12M2 8h12M2 12h12" /></svg>,
};
