"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Me, Role } from "@/lib/types";
import { MySchedule } from "@/components/MySchedule";
import { OwnerView } from "@/components/OwnerView";
import { RulesDialog } from "@/components/RulesDialog";
import { SlotBoard } from "@/components/SlotBoard";
import { SlotManager } from "@/components/SlotManager";
import { StaffManager } from "@/components/StaffManager";
import { Icon, ToastProvider, btn, useIsDark, useIsHydrated, useLocal, useToast, writeLocal } from "@/components/ui";
import { todayKey } from "@/lib/format";

export const MODES = {
  mc: {
    sub: "Live booking", title: "จองคิวไลฟ์", label: "หน้า Mc",
    hint: "แตะเลือก slot ที่ต้องการ แล้วกดจองที่แถบด้านล่าง ระบบจะลงปฏิทินให้อัตโนมัติ",
    rule: "",
  },
  admin: {
    sub: "Admin", title: "จัดคิว Admin", label: "หน้า Admin",
    hint: "แตะเลือก slot ที่ต้องการรับ ระบบจะใส่ชื่อและเบอร์โทรของคุณในปฏิทินของ Mc ให้อัตโนมัติ",
    rule: "รับได้สูงสุด 4 slot (8 ชม.) ต่อวัน แบ่งได้ไม่เกิน 2 ช่วง และเวลาห้ามทับกันแม้คนละแพลตฟอร์ม เช่น 09:30–13:30 กับ 17:30–21:30",
  },
  owner: {
    sub: "Owner", title: "หน้าเจ้าของ", label: "หน้าเจ้าของ",
    hint: "ดูสรุปชั่วโมงและค่าจ้างรายเดือน และเพิ่ม/แก้ไข slot ไลฟ์ของ Mc และ Admin",
    rule: "",
  },
} as const;

const ROLE_KEY = "glory_booking_role";
const THEME_KEY = "glory_booking_theme";

export function rolesOf(me: Me | null): Role[] {
  if (!me) return [];
  return (["mc", "admin", "owner"] as const).filter((r) => me[r]);
}

export function displayName(me: Me, role: Role) {
  if (role === "owner") return me.owner!.name;
  return role === "admin" ? me.admin!.name : `Mc ${me.mc!.name}`;
}

export function App({ me }: { me: Me | null }) {
  return (
    <ToastProvider>
      <Shell me={me} />
    </ToastProvider>
  );
}

function Shell({ me }: { me: Me | null }) {
  const router = useRouter();
  const toast = useToast();
  const roles = rolesOf(me);
  // บทบาทที่ใช้ล่าสุด (จำไว้ในเครื่อง) ไม่เคยใช้ = บทบาทแรก
  const savedRole = useLocal(ROLE_KEY) as Role | null;
  const role: Role | null = savedRole && roles.includes(savedRole) ? savedRole : roles[0] ?? null;
  const [myOpen, setMyOpen] = useState(false);
  const [rulesManual, setRulesManual] = useState(false);
  const dark = useIsDark();

  // กฎการทำงาน: เด้งวันละครั้งต่อบทบาท
  const rulesKey = me && role ? `glory_rules_seen_${me.email}_${role}` : "";
  const rulesSeen = useLocal(rulesKey);
  const hydrated = useIsHydrated();
  const rulesAuto = hydrated && !!rulesKey && role !== "owner" && rulesSeen !== todayKey();
  const rulesOpen = rulesManual || rulesAuto;
  function closeRules() {
    setRulesManual(false);
    if (rulesKey) writeLocal(rulesKey, todayKey());
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).has("authError")) toast("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่", "error");
  }, [toast]);

  const mode = role ? MODES[role] : null;
  useEffect(() => {
    document.title = mode ? `${mode.title} | GLORY VITAL` : "GLORY VITAL Live";
  }, [mode]);

  function setRole(next: Role) {
    writeLocal(ROLE_KEY, next);
    toast("ไปที่" + MODES[next].label + "แล้ว");
  }

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    writeLocal(THEME_KEY, next ? "dark" : "light");
  }

  async function signIn() {
    await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
  }

  async function signOut() {
    await createClient().auth.signOut();
    toast("ออกจากระบบแล้ว");
    router.refresh();
  }

  const registered = roles.length > 0;
  const name = me && role ? displayName(me, role) : "";

  return (
    <div className="mx-auto max-w-[760px] px-4">
      <header className="flex items-center justify-between gap-3 pt-[calc(14px+env(safe-area-inset-top))] pb-2">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-[17px] font-bold tracking-[.14em]" aria-label="GLORY VITAL">
            GL<span className="tracking-normal text-accent">✦</span>RY VITAL
          </span>
          <span className="text-[13px] font-medium text-muted">{mode?.sub ?? "Live booking"}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {roles.length > 1 && role ? (
            <select
              aria-label="เลือกหน้า"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-9 rounded-full border border-line bg-surface px-3 text-sm font-medium"
            >
              {roles.map((r) => <option key={r} value={r}>{MODES[r].label}</option>)}
            </select>
          ) : null}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"}
            title={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"}
            className="grid size-[38px] shrink-0 place-items-center rounded-full border border-line bg-surface shadow-card hover:border-accent hover:text-brand [&_svg]:size-[18px]"
          >
            {dark ? <Icon.sun /> : <Icon.moon />}
          </button>
          {me ? (
            <div className="flex min-w-0 items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-card">
              <button
                type="button"
                disabled={!registered || role === "owner"}
                onClick={() => setMyOpen(true)}
                title={role === "owner" ? "" : "ดูตารางของฉัน"}
                className="flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 text-left enabled:hover:bg-brand-soft"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink" aria-hidden>
                  {((name || me.email).match(/[ก-ฮA-Za-z0-9]/) ?? ["?"])[0]}
                </span>
                <span className="hidden min-w-0 flex-col leading-tight sm:flex">
                  <span className="truncate text-sm font-semibold">{name || "ยังไม่ได้ลงทะเบียน"}</span>
                  <span className="truncate text-xs text-muted">{me.email}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label="ออกจากระบบ"
                title="ออกจากระบบ"
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-brand-soft hover:text-brand [&_svg]:size-[18px]"
              >
                <Icon.signOut />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <section className="pt-4 pb-3">
        <h1 className="text-2xl font-bold sm:text-[28px]">{mode?.title ?? "ตารางไลฟ์ GLORY VITAL"}</h1>
        <p className="mt-1 text-sm text-muted">
          {mode?.hint ?? "เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ ระบบจะพาไปหน้าของ Mc หรือ Admin ให้อัตโนมัติ"}
        </p>
      </section>

      {!me ? (
        <div className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="text-sm">
            <strong className="block text-base">เข้าสู่ระบบ</strong>
            <span className="text-muted">ใช้อีเมลที่ลงทะเบียนไว้กับทีมงาน</span>
          </div>
          <button type="button" className={btn.primary} onClick={signIn}>เข้าสู่ระบบด้วย Google</button>
        </div>
      ) : !registered ? (
        <div className="my-3 rounded-2xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <strong className="block text-base">อีเมล {me.email} ยังไม่ได้ลงทะเบียน</strong>
          กรุณาติดต่อแอดมินให้เพิ่มอีเมลนี้ในระบบ หรือออกจากระบบแล้วเข้าด้วยอีเมลอื่น
        </div>
      ) : null}

      {mode?.rule ? <p className="my-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-info-ink">{mode.rule}</p> : null}

      {me && role === "owner" ? <OwnerTabs /> : null}
      {me && (role === "mc" || role === "admin") ? <SlotBoard key={role} me={me} role={role} /> : null}
      {!me || !registered ? (
        <div className="my-6 rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
          <strong className="mb-1 block text-base text-ink">เข้าสู่ระบบเพื่อดูตาราง</strong>
          Mc จะเห็น slot ที่เปิดให้จอง ส่วน Admin จะเห็น slot ที่รอ Admin
        </div>
      ) : null}

      {me && (role === "mc" || role === "admin") ? (
        <>
          <MySchedule
            open={myOpen}
            onClose={() => setMyOpen(false)}
            role={role}
            who={displayName(me, role)}
            onOpenRules={() => setRulesManual(true)}
          />
          <RulesDialog open={rulesOpen} onClose={closeRules} role={role} who={displayName(me, role)} />
        </>
      ) : null}
      <ToTop />
    </div>
  );
}

const OWNER_TAB_KEY = "glory_owner_tab";

/** หน้าเจ้าของ: สรุปรายเดือน | จัดการ slot (จำแท็บล่าสุดไว้ในเครื่อง) */
function OwnerTabs() {
  const saved = useLocal(OWNER_TAB_KEY);
  const tab = saved === "slots" || saved === "staff" ? saved : "summary";
  const tabs = [["summary", "สรุปรายเดือน"], ["slots", "จัดการ slot"], ["staff", "พนักงาน"]] as const;
  return (
    <>
      <div role="tablist" aria-label="เมนูเจ้าของ" className="my-3 flex gap-1 rounded-full border border-line bg-surface p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => writeLocal(OWNER_TAB_KEY, id)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              tab === id ? "bg-brand text-brand-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "slots" ? <SlotManager /> : tab === "staff" ? <StaffManager /> : <OwnerView />}
    </>
  );
}

function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 250);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="กลับขึ้นบนสุด"
      title="กลับขึ้นบนสุด"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed right-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-30 grid size-11 place-items-center rounded-full border border-line bg-surface shadow-card transition [&_svg]:size-5 ${
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      } [body:has(.slot-bar-open)_&]:bottom-[calc(104px+env(safe-area-inset-bottom))]`}
    >
      <Icon.up />
    </button>
  );
}
