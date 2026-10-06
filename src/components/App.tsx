"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon, LogOutIcon, MoonIcon, SunIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Me, OwnerScope, Role } from "@/lib/types";
import { BookingWindowEditor } from "@/components/BookingWindow";
import { LiveStats } from "@/components/LiveStats";
import { MySchedule } from "@/components/MySchedule";
import { OwnerView } from "@/components/OwnerView";
import { ProofPage } from "@/components/ProofPage";
import { RulesDialog } from "@/components/RulesDialog";
import { RulesEditor } from "@/components/RulesEditor";
import { SlotBoard } from "@/components/SlotBoard";
import { SlotManager } from "@/components/SlotManager";
import { StaffManager } from "@/components/StaffManager";
import { AppProviders, IconButton, Notice, StateBox, useToast } from "@/components/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayKey } from "@/lib/format";
import { useIsDark, useIsHydrated, useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

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
  proof: {
    sub: "Live proof", title: "หลักฐานไลฟ์", label: "หลักฐานไลฟ์",
    hint: "แนบรูปแดชบอร์ด TikTok LIVE พร้อมเวลาเริ่ม–จบไลฟ์จริงของแต่ละ slot ใช้เป็นหลักฐานทำเบิก",
    rule: "",
  },
  stats: {
    sub: "Live stats", title: "สถิติไลฟ์", label: "สถิติไลฟ์",
    hint: "ยอดไลฟ์ TikTok / Shopee จากไฟล์ Export เทียบเดือนก่อน (MoM) ปีก่อน (YoY) และเทียบแคมเปญกับช่วงเดียวกันของเดือนก่อน",
    rule: "",
  },
} as const;

/** หน้าที่เลือกได้จากเมนู = บทบาท + หน้าหลักฐานไลฟ์ (Admin ทุกคน / Owner ฝั่ง Mc) + สถิติไลฟ์ (Owner) */
type Page = Role | "proof" | "stats";

const ROLE_KEY = "glory_booking_role";
const THEME_KEY = "glory_booking_theme";

/**
 * หน้าที่บัญชีนี้เปิดได้: บทบาทจริงก่อน แล้วต่อด้วยหน้าที่ Owner เปิดดูได้ตามสิทธิ์ (ดูอย่างเดียว)
 * เช่น Owner ที่ติ๊ก Mc + Admin = [owner, mc (ดู), admin (ดู)]
 */
export function rolesOf(me: Me | null): Role[] {
  if (!me) return [];
  const real = (["mc", "admin", "owner"] as const).filter((r) => me[r]);
  const view = (["mc", "admin"] as const).filter((r) => !me[r] && me.owner?.[r]);
  return [...real, ...view];
}

/** Owner เปิดหน้า Mc / Admin โดยไม่ได้เป็น Mc / Admin เอง = ดูอย่างเดียว จองไม่ได้ */
export const isPreview = (me: Me | null, role: Role | null) => !!me && (role === "mc" || role === "admin") && !me[role];

export function displayName(me: Me, role: Role) {
  if (role === "owner" || isPreview(me, role)) return me.owner!.name;
  return role === "admin" ? me.admin!.name : `Mc ${me.mc!.name}`;
}

export function App({ me }: { me: Me | null }) {
  return (
    <AppProviders>
      <Shell me={me} />
    </AppProviders>
  );
}

function Shell({ me }: { me: Me | null }) {
  const router = useRouter();
  const toast = useToast();
  const roles = rolesOf(me);
  const pages: Page[] = [
    ...roles,
    ...(me && (me.admin || me.owner?.mc || me.owner?.proofs) ? ["proof" as const] : []),
    ...(me?.owner && (me.owner.mc || me.owner.admin) ? ["stats" as const] : []),
  ];
  // หน้าที่ใช้ล่าสุด (จำไว้ในเครื่อง) ไม่เคยใช้ = บทบาทแรก
  const savedPage = useLocal(ROLE_KEY) as Page | null;
  const page: Page | null = savedPage && pages.includes(savedPage) ? savedPage : pages[0] ?? null;
  const role: Role | null = page === "proof" || page === "stats" ? null : page;
  const preview = isPreview(me, role);
  const [myOpen, setMyOpen] = useState(false);
  const [rulesManual, setRulesManual] = useState(false);
  const dark = useIsDark();

  // กฎการทำงาน: เด้งวันละครั้งต่อบทบาท
  const rulesKey = me && role ? `glory_rules_seen_${me.email}_${role}` : "";
  const rulesSeen = useLocal(rulesKey);
  const hydrated = useIsHydrated();
  const rulesAuto = hydrated && !!rulesKey && role !== "owner" && !preview && rulesSeen !== todayKey();
  const rulesOpen = rulesManual || rulesAuto;
  function closeRules() {
    setRulesManual(false);
    if (rulesKey) writeLocal(rulesKey, todayKey());
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).has("authError")) toast("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่", "error");
  }, [toast]);

  const mode = page ? MODES[page] : null;
  useEffect(() => {
    document.title = mode ? `${mode.title} | GLORY VITAL` : "GLORY VITAL Live";
  }, [mode]);

  function setRole(next: Page) {
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
  const name = me && role ? displayName(me, role)
    : me && page === "proof" ? me.owner?.name || me.admin?.name || ""
      : me && page === "stats" ? me.owner?.name || "" : "";

  // เมนูเลือกหน้า: จอกว้างอยู่ในแถวบน / มือถืออยู่แถวที่ 2 เต็มความกว้าง (แถวบนจะได้ไม่ล้นจอจนปุ่มทับกัน)
  const rolePicker = (cls: string) => pages.length > 1 && page ? (
    <Select value={page} onValueChange={(v) => setRole(v as Page)}>
      <SelectTrigger aria-label="เลือกหน้า" className={cn("h-9 rounded-full bg-card font-medium", cls)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {pages.map((p) => (
          <SelectItem key={p} value={p}>{MODES[p].label}{(p === "mc" || p === "admin") && isPreview(me, p) ? " (ดูอย่างเดียว)" : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;

  // หน้าหลักฐานไลฟ์ไม่มีบทบาท (role = null) จึงเปิดตารางของฉันไม่ได้
  const canOpenMine = registered && !!role && role !== "owner" && !preview;
  return (
    <div className="mx-auto max-w-[760px] px-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-[calc(14px+env(safe-area-inset-top))] pb-2">
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          <span className="text-[15px] font-bold tracking-[.12em] sm:text-[17px] sm:tracking-[.14em]" aria-label="GLORY VITAL">
            GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL
          </span>
          <span className="hidden text-[13px] font-medium text-muted-foreground sm:inline">{mode?.sub ?? "Live booking"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rolePicker("hidden sm:flex")}
          <IconButton label={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"} onClick={toggleTheme} className="bg-card shadow-card">
            {dark ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          {me ? (
            <div className="flex shrink-0 items-center gap-1 rounded-full border bg-card p-1 shadow-card">
              <Button
                variant="ghost"
                disabled={!canOpenMine}
                onClick={() => setMyOpen(true)}
                title={canOpenMine ? "ดูตารางของฉัน" : ""}
                aria-label={canOpenMine ? "ดูตารางของฉัน" : name}
                className="h-auto min-w-0 gap-2 rounded-full p-0.5 text-left disabled:opacity-100 sm:pr-2"
              >
                <Avatar aria-hidden>
                  <AvatarFallback className="bg-primary font-bold text-primary-foreground">
                    {((name || me.email).match(/[ก-ฮA-Za-z0-9]/) ?? ["?"])[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 flex-col leading-tight sm:flex">
                  <span className="truncate text-sm font-semibold">{name || "ยังไม่ได้ลงทะเบียน"}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">{me.email}</span>
                </span>
              </Button>
              <Button variant="ghost" size="icon" onClick={signOut} aria-label="ออกจากระบบ" title="ออกจากระบบ" className="rounded-full text-muted-foreground">
                <LogOutIcon />
              </Button>
            </div>
          ) : null}
        </div>
        {rolePicker("w-full sm:hidden")}
      </header>

      <section className="pt-4 pb-3">
        <h1 className="text-2xl font-bold sm:text-[28px]">{mode?.title ?? "ตารางไลฟ์ GLORY VITAL"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode?.hint ?? "เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ ระบบจะพาไปหน้าของ Mc หรือ Admin ให้อัตโนมัติ"}
        </p>
      </section>

      {!me ? (
        <Card className="my-3 shadow-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <strong className="block text-base">เข้าสู่ระบบ</strong>
              <span className="text-muted-foreground">ใช้อีเมลที่ลงทะเบียนไว้กับทีมงาน</span>
            </div>
            <Button size="lg" className="rounded-full px-4" onClick={signIn}>เข้าสู่ระบบด้วย Google</Button>
          </CardContent>
        </Card>
      ) : !registered ? (
        <Notice variant="warning" icon title={`อีเมล ${me.email} ยังไม่ได้ลงทะเบียน`}>
          กรุณาติดต่อแอดมินให้เพิ่มอีเมลนี้ในระบบ หรือออกจากระบบแล้วเข้าด้วยอีเมลอื่น
        </Notice>
      ) : null}

      {mode?.rule ? <Notice>{mode.rule}</Notice> : null}

      {me?.owner && role === "owner" ? <OwnerTabs scope={{ mc: me.owner.mc, admin: me.owner.admin }} /> : null}
      {me && (role === "mc" || role === "admin") ? <SlotBoard key={role} me={me} role={role} preview={preview} /> : null}
      {me && registered && page === "proof" ? <ProofPage /> : null}
      {me && registered && page === "stats" ? <LiveStats /> : null}
      {!me || !registered ? (
        <StateBox title="เข้าสู่ระบบเพื่อดูตาราง">Mc จะเห็น slot ที่เปิดให้จอง ส่วน Admin จะเห็น slot ที่รอ Admin</StateBox>
      ) : null}

      {me && (role === "mc" || role === "admin") && !preview ? (
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

/** หน้าเจ้าของ: สรุปรายเดือน | จัดการ slot | พนักงาน (จำแท็บล่าสุดไว้ในเครื่อง) — เห็นเฉพาะฝั่งที่มีสิทธิ์ */
function OwnerTabs({ scope }: { scope: OwnerScope }) {
  const saved = useLocal(OWNER_TAB_KEY);
  const tab = saved === "slots" || saved === "staff" || saved === "rules" ? saved : "summary";
  const tabs = [["summary", "สรุปรายเดือน"], ["slots", "จัดการ slot"], ["staff", "พนักงาน"], ["rules", "กฎการทำงาน"]] as const;
  if (!scope.mc && !scope.admin) {
    return (
      <Notice variant="warning" icon title="ยังไม่ได้รับสิทธิ์จัดการ" className="my-6">
        ติดต่อเจ้าของคนอื่นให้ติ๊กสิทธิ์ Mc หรือ Admin ในหน้าพนักงาน
      </Notice>
    );
  }
  return (
    <Tabs value={tab} onValueChange={(v) => writeLocal(OWNER_TAB_KEY, v)} className="gap-0">
      <TabsList aria-label="เมนูเจ้าของ" className="my-3 h-auto! w-full rounded-full border bg-card p-1">
        {tabs.map(([id, label]) => (
          <TabsTrigger
            key={id}
            value={id}
            className="rounded-full py-1.5 text-[13px] font-semibold data-active:bg-primary! data-active:text-primary-foreground! sm:text-sm"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {!(scope.mc && scope.admin) ? (
        <Notice>บัญชีนี้มีสิทธิ์จัดการเฉพาะฝั่ง <strong>{scope.mc ? "Mc" : "Admin"}</strong></Notice>
      ) : null}
      <TabsContent value="summary"><OwnerView /></TabsContent>
      <TabsContent value="slots"><BookingWindowEditor scope={scope} /><SlotManager scope={scope} /></TabsContent>
      <TabsContent value="staff"><StaffManager scope={scope} /></TabsContent>
      <TabsContent value="rules"><RulesEditor scope={scope} /></TabsContent>
    </Tabs>
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
    <IconButton
      label="กลับขึ้นบนสุด"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed right-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-30 size-11 bg-card shadow-card [&_svg]:size-5",
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        "[body:has(.slot-bar-open)_&]:bottom-[calc(104px+env(safe-area-inset-bottom))]",
      )}
    >
      <ArrowUpIcon />
    </IconButton>
  );
}
