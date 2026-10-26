"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlarmClockIcon, BellIcon, BellRingIcon, CalendarCheckIcon, CalendarClockIcon, CalendarPlusIcon, CalendarRangeIcon, CameraIcon, CalendarXIcon, FileTextIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon, TrophyIcon,
  type LucideIcon,
} from "lucide-react";
import { api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// กระดิ่งแจ้งเตือนบนหัวเว็บ + เปิด / ปิดแจ้งเตือนเด้งเข้ามือถือ (Web Push) ของเครื่องนี้
//   ข้อมูลจาก /api/notifications (โหลดใหม่ทุก 1 นาทีตอนเปิดหน้าอยู่ + ตอนกลับมาที่แอป) · เด้ง = /api/push + public/sw.js

type Item = { id: number; kind: string; title: string; body: string; page: string | null; at: string; read: boolean };
/** asking = รอคนกด "อนุญาต" ที่ป๊อปอัปของเบราว์เซอร์ · enabling / disabling = กำลังเปิด / ปิด */
type PushState = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "asking" | "enabling" | "disabling";

/** รอได้ไม่เกินกี่วินาที (กันปุ่มค้างถ้าเบราว์เซอร์ไม่ตอบ) */
function withTimeout<T>(p: Promise<T>, sec: number, message: string) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), sec * 1000))]);
}

const KIND_ICON: Record<string, LucideIcon> = {
  booked: CalendarPlusIcon, cancelled: CalendarXIcon, slot_open: SparklesIcon, changed: RefreshCwIcon,
  reminder: AlarmClockIcon, open_soon: TriangleAlertIcon, proof: CameraIcon, calendar: CalendarCheckIcon,
  data: TriangleAlertIcon, weekly: CalendarRangeIcon, window: CalendarClockIcon, tawi: FileTextIcon, receipt: FileTextIcon,
  quota: TrophyIcon,
};

/** "เมื่อสักครู่" / "5 นาทีที่แล้ว" / "3 ชม.ที่แล้ว" / "17 ต.ค. 09:30" */
function ago(iso: string, now = Date.now()) {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} ชม.ที่แล้ว`;
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(iso));
}

/** เสียง "ติ๊ง-ต่อง" สั้นๆ (สร้างด้วย Web Audio ไม่ต้องมีไฟล์เสียง) · เบราว์เซอร์ไม่ให้เล่น (ยังไม่เคยแตะหน้าเว็บ) = เงียบ */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[880, 0], [1320, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1000);
    navigator.vibrate?.(150);
  } catch { /* ไม่มีเสียงก็ไม่เป็นไร */ }
}

function keyBytes(base64: string) {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** สถานะแจ้งเตือนเด้งของเครื่องนี้ + ลงทะเบียน service worker (เปิดไว้แล้ว = ส่งข้อมูลเครื่องให้เซิร์ฟเวอร์อีกรอบ กันข้อมูลหาย) */
function usePush() {
  const [state, setState] = useState<PushState>("checking");
  useEffect(() => {
    let alive = true;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const sub = await reg.pushManager.getSubscription();
        if (!alive) return;
        if (Notification.permission === "denied") return setState("denied");
        if (sub && Notification.permission === "granted") {
          setState("on");
          api("/api/push", { subscription: sub.toJSON() }).catch(() => undefined);
        } else setState("off");
      } catch {
        if (alive) setState("unsupported");
      }
    })();
    return () => { alive = false; };
  }, []);
  return [state, setState] as const;
}

export function NotificationBell({ onGo }: { onGo: (page: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [push, setPush] = usePush();

  // เครื่องที่ยังไม่เปิดแจ้งเตือนเด้ง แต่เปิดเว็บอยู่: มีแจ้งเตือนใหม่ = เล่นเสียง "ติ๊ง" (เปิดเด้งแล้ว = เครื่องมีเสียงเองอยู่แล้ว)
  const lastUnread = useRef<number | null>(null);
  const pushRef = useRef(push);
  useEffect(() => { pushRef.current = push; }, [push]);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[]; unread: number }>("/api/notifications");
      if (r.ok) {
        if (lastUnread.current !== null && r.unread > lastUnread.current && pushRef.current !== "on") chime();
        lastUnread.current = r.unread;
        setItems(r.items);
        setUnread(r.unread);
      }
    } catch { /* เน็ตหลุด: ลองใหม่รอบหน้า */ }
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const first = setTimeout(load, 0);
    const timer = setInterval(() => { if (visible()) load(); }, 60_000);
    const onVisible = () => { if (visible()) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // ตัวเลขบนไอคอนแอปที่หน้าจอโฮม (เครื่องที่รองรับ)
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => undefined);
  }, [unread]);

  // เปิดกระดิ่ง = อ่านแล้วทั้งหมด (รายการยังไฮไลต์ตัวที่ใหม่จนกว่าจะปิด)
  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setItems((list) => list?.map((x) => ({ ...x, read: true })) ?? list);
      return;
    }
    await load();
    setUnread(0);
    lastUnread.current = 0;
    api("/api/notifications", { action: "read" }).catch(() => undefined);
  }

  async function enable() {
    setPush("enabling");
    try {
      const { publicKey } = await api<{ publicKey: string | null }>("/api/push");
      if (!publicKey) throw new Error("ระบบยังไม่ได้ตั้งค่าแจ้งเตือนเด้ง (ติดต่อ Owner)");
      if (Notification.permission !== "granted") {
        setPush("asking");
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setPush(perm === "denied" ? "denied" : "off");
          if (perm !== "denied") toast("ยังไม่ได้กดอนุญาต ลองกดเปิดแจ้งเตือนอีกครั้ง", "error");
          return;
        }
        setPush("enabling");
      }
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration("/").then((r) => r ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }))
          .then(() => navigator.serviceWorker.ready),
        15, "เตรียมแจ้งเตือนไม่สำเร็จ ลองรีเฟรชหน้าแล้วกดใหม่",
      );
      const sub = (await reg.pushManager.getSubscription())
        ?? await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), 20, "เบราว์เซอร์ไม่ตอบ ลองรีเฟรชหน้าแล้วกดใหม่");
      const r = await api<{ message: string }>("/api/push", { subscription: sub.toJSON() });
      if (!r.ok) throw new Error(r.message);
      setPush("on");
      toast("เปิดแจ้งเตือนบนเครื่องนี้แล้ว");
    } catch (err) {
      setPush("off");
      toast((err as Error).message || "เปิดแจ้งเตือนไม่สำเร็จ", "error");
    }
  }

  async function disable() {
    setPush("disabling");
    try {
      const sub = await (await withTimeout(navigator.serviceWorker.ready, 10, "timeout")).pushManager.getSubscription();
      if (sub) {
        await api("/api/push", { endpoint: sub.endpoint }, "DELETE");
        await sub.unsubscribe();
      }
      setPush("off");
      toast("ปิดแจ้งเตือนบนเครื่องนี้แล้ว");
    } catch {
      setPush("on");
      toast("ปิดแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    }
  }

  async function test() {
    try {
      const r = await api<{ message: string }>("/api/push", { action: "test" });
      toast(r.message ?? "ส่งแล้ว", r.ok ? undefined : "error");
      setTimeout(load, 800);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" size="icon-lg" aria-label={unread ? `แจ้งเตือน (ยังไม่อ่าน ${unread})` : "แจ้งเตือน"} title="แจ้งเตือน"
          className="relative rounded-full bg-card shadow-card max-sm:size-9"
        >
          {unread ? <BellRingIcon /> : <BellIcon />}
          {unread ? (
            <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-white tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="w-[min(24rem,calc(100vw-1.5rem))] gap-2 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 pt-3 pb-2">
          <span className="font-bold">แจ้งเตือน</span>
          <PushControl state={push} onEnable={enable} onDisable={disable} onTest={test} compact />
        </div>
        {push !== "on" && push !== "disabling" && push !== "checking" ?<div className="px-3"><PushControl state={push} onEnable={enable} onDisable={disable} onTest={test} /></div> : null}
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain px-1.5 pb-1.5">
          {!items ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">กำลังโหลด…</p>
          ) : !items.length ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">ยังไม่มีแจ้งเตือน</p>
          ) : items.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? BellIcon;
            return (
              <button
                key={n.id} type="button"
                onClick={() => { if (n.page) onGo(n.page); onOpenChange(false); }}
                className={cn("flex w-full cursor-pointer gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted", !n.read && "bg-primary/8")}
              >
                <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5", !n.read && "bg-primary text-primary-foreground", /^\[(ด่วน|ค้าง)\]/.test(n.title) && "bg-destructive text-white")}>
                  <Icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug font-semibold">{n.title}</span>
                  {n.body ? <span className="mt-0.5 line-clamp-5 block text-xs whitespace-pre-line text-muted-foreground">{n.body}</span> : null}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{ago(n.at)}</span>
                </span>
                {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="ใหม่" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** ปุ่มเปิด / ปิดแจ้งเตือนเด้ง: compact = ปุ่มเล็กบนหัวกล่อง (ตอนเปิดอยู่) · ปกติ = กล่องอธิบาย (ตอนยังไม่เปิด) */
function PushControl({ state, onEnable, onDisable, onTest, compact }: {
  state: PushState; onEnable: () => void; onDisable: () => void; onTest: () => void; compact?: boolean;
}) {
  if (compact) {
    if (state !== "on" && state !== "disabling") return null;
    return (
      <span className="flex items-center gap-1">
        <span className="mr-1 text-xs font-semibold text-success">● เด้งเข้าเครื่องนี้</span>
        <Button size="xs" variant="outline" disabled={state === "disabling"} onClick={onTest}>ทดสอบ</Button>
        <Button size="xs" variant="ghost" disabled={state === "disabling"} onClick={onDisable}>ปิด</Button>
      </span>
    );
  }
  const box = (children: React.ReactNode) => <div className="rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed">{children}</div>;
  if (state === "asking") {
    return box(<>
      <b className="text-primary">กด &quot;อนุญาต&quot; ที่ป๊อปอัปของเบราว์เซอร์</b> (มุมซ้ายบน ใต้แถบที่อยู่เว็บ) — ถ้าไม่เห็นป๊อปอัป ให้กดไอคอน 🔔 / แม่กุญแจ ในแถบที่อยู่เว็บ แล้วเลือกอนุญาตการแจ้งเตือน
    </>);
  }
  if (state === "off" || state === "enabling") {
    return box(
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">ให้แจ้งเตือน<b>เด้งเข้าเครื่องนี้</b> แม้ไม่ได้เปิดเว็บอยู่</span>
        <Button size="sm" disabled={state === "enabling"} onClick={onEnable}><BellRingIcon />{state === "enabling" ? "กำลังเปิด…" : "เปิดแจ้งเตือน"}</Button>
      </div>,
    );
  }
  if (state === "ios-install") {
    return box(<>
      <b>iPhone / iPad:</b> ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อนถึงจะรับแจ้งเตือนเด้งได้ — กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b> จากนั้นเปิดเว็บจากไอคอนนั้น แล้วกดกระดิ่งอีกครั้ง
    </>);
  }
  if (state === "denied") {
    return box(<>เครื่องนี้<b>บล็อกแจ้งเตือน</b>ของเว็บนี้ไว้ เปิดได้ที่ การตั้งค่าเบราว์เซอร์ / ตั้งค่าเครื่อง &gt; การแจ้งเตือน แล้วกลับมากดเปิดอีกครั้ง</>);
  }
  return box(<>เบราว์เซอร์นี้รับแจ้งเตือนเด้งไม่ได้ ดูแจ้งเตือนได้ที่กระดิ่งนี้แทน</>);
}
