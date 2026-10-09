"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpIcon, BriefcaseIcon, CalendarRangeIcon, CameraIcon, ChartColumnIcon, HeadsetIcon, HouseIcon, LogOutIcon, MicIcon, MoonIcon, SunIcon,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Me, OwnerScope, Role } from "@/lib/types";
import { LiveStats } from "@/components/LiveStats";
import { MySchedule } from "@/components/MySchedule";
import { HomeView, type Go } from "@/components/HomeView";
import { PerformanceView } from "@/components/PerformanceView";
import { OwnerView } from "@/components/OwnerView";
import { PlanSlots } from "@/components/PlanSlots";
import { ProofPage } from "@/components/ProofPage";
import { RulesDialog } from "@/components/RulesDialog";
import { RulesEditor } from "@/components/RulesEditor";
import { SlotBoard } from "@/components/SlotBoard";
import { SLOT_VIEW_KEY, SlotWorkspace } from "@/components/SlotWorkspace";
import { StaffManager } from "@/components/StaffManager";
import { AppProviders, IconButton, Notice, StateBox, useToast } from "@/components/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayKey } from "@/lib/format";
import { useIsDark, useIsHydrated, useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export const MODES = {
  mc: {
    sub: "Live booking", title: "จองคิวไลฟ์", label: "Booking Mc",
    hint: "แตะเลือก slot ที่ต้องการ แล้วกดจองที่แถบด้านล่าง ระบบจะลงปฏิทินให้อัตโนมัติ",
    rule: "",
  },
  admin: {
    sub: "Admin", title: "จัดคิว Admin", label: "Booking Admin",
    hint: "แตะเลือก slot ที่ต้องการรับ ระบบจะใส่ชื่อและเบอร์โทรของคุณในปฏิทินของ Mc ให้อัตโนมัติ",
    rule: "รับได้สูงสุด 4 slot (8 ชม.) ต่อวัน แบ่งได้ไม่เกิน 2 ช่วง และเวลาห้ามทับกันแม้คนละแพลตฟอร์ม เช่น 09:30–13:30 กับ 17:30–21:30",
  },
  owner: {
    sub: "Owner", title: "หน้าเจ้าของ", label: "Owner",
    hint: "สรุปค่าจ้างรายเดือน · ผลงาน Mc · ตาราง slot (แพลนทั้งเดือน / ใส่คนรายวัน) · พนักงาน · กฎการทำงาน",
    rule: "",
  },
  home: {
    sub: "Home", title: "หน้าแรก", label: "หน้าแรก",
    hint: "งานที่ต้องทำในหน้าเดียว: ไลฟ์วันนี้ · slot ที่ยังไม่มีคน · หลักฐานและ GMV ที่ค้าง · แคมเปญถัดไป · ข้อมูลที่ควรแก้",
    rule: "",
  },
  proof: {
    sub: "Live proof", title: "หลักฐานไลฟ์", label: "หลักฐานไลฟ์",
    hint: "แนบรูปแดชบอร์ด TikTok LIVE พร้อมเวลาเริ่ม–จบไลฟ์จริงของแต่ละ slot ใช้เป็นหลักฐานทำเบิก",
    rule: "",
  },
  stats: {
    sub: "Live stats", title: "สถิติไลฟ์", label: "Data analytics",
    hint: "ยอดไลฟ์ TikTok / Shopee จากไฟล์ Export เทียบเดือนก่อน (MoM) ปีก่อน (YoY) และเทียบแคมเปญกับช่วงเดียวกันของเดือนก่อน",
    rule: "",
  },
  plan: {
    sub: "Plan slot", title: "Plan Slot Live", label: "Plan Slot Live",
    hint: "แพลน slot ไลฟ์ทั้งเดือนเป็นร่างก่อน แล้วกดบันทึก ระบบจะเขียนลงชีตทั้งแท็บ \"ลงตาราง Deal Mc\" และ \"ลงตาราง Admin เสริม\" (กำหนด Mc / Admin ต่อที่หน้าจัดการ slot)",
    rule: "",
  },
} as const;

/** หน้าที่เลือกได้จากเมนู = บทบาท + หน้าหลักฐานไลฟ์ (Admin ทุกคน / Owner ฝั่ง Mc) + สถิติไลฟ์ / Plan Slot Live (Owner ที่ติ๊กสิทธิ์) */
type Page = Role | "home" | "proof" | "stats" | "plan";
/** ลำดับในเมนูเลือกหน้า */
const PAGE_ORDER: Page[] = ["home", "owner", "stats", "plan", "mc", "admin", "proof"];
/** ชื่อสั้น + ไอคอนในแถบเมนู */
const PAGE_SHORT: Record<Page, string> = { home: "หน้าแรก", owner: "เจ้าของ", stats: "สถิติไลฟ์", plan: "แพลน slot", mc: "Mc", admin: "Admin", proof: "หลักฐานไลฟ์" };
const PAGE_ICON: Record<Page, LucideIcon> = {
  home: HouseIcon, owner: BriefcaseIcon, stats: ChartColumnIcon, plan: CalendarRangeIcon, mc: MicIcon, admin: HeadsetIcon, proof: CameraIcon,
};

const ROLE_KEY = "glory_booking_role";
const THEME_KEY = "glory_booking_theme";

/**
 * หน้าที่บัญชีนี้เปิดได้: บทบาทจริงก่อน แล้วต่อด้วยหน้าที่ Owner เปิดดูได้ตามสิทธิ์ (ดูอย่างเดียว)
 * เช่น Owner ที่ติ๊ก Mc + Admin = [owner, mc (ดู), admin (ดู)]
 */
export function rolesOf(me: Me | null): Role[] {
  if (!me) return [];
  // หน้าเจ้าของ: Owner ที่จัดการหรือดูฝั่ง Mc / Admin ได้ (ติ๊กแค่ Data analytics / หลักฐานไลฟ์ = ไม่เห็นหน้าเจ้าของ)
  const real = (["mc", "admin", "owner"] as const).filter((r) => (r === "owner" ? !!me.owner && (me.owner.see.mc || me.owner.see.admin) : me[r]));
  const view = (["mc", "admin"] as const).filter((r) => !me[r] && me.owner?.see[r]);
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
  // Owner ที่เปิดหน้าเจ้าของได้: Plan Slot Live และหน้าจองแบบดูอย่างเดียว ย้ายไปอยู่ในหน้าเจ้าของ > ตาราง slot
  const ownerPage = !!me?.owner && (me.owner.see.mc || me.owner.see.admin);
  const roles = rolesOf(me).filter((r) => !(ownerPage && isPreview(me, r)));
  const pages: Page[] = [
    // หน้าแรก (งานค้าง): Owner ที่จัดการ Mc หรือ Admin
    ...(ownerPage ? ["home" as const] : []),
    ...roles,
    ...(me && (me.admin || me.owner?.see.mc || me.owner?.see.proofs) ? ["proof" as const] : []),
    // Data analytics: Owner ที่ติ๊กสิทธิ์ (จัดการได้ หรือ ดูได้อย่างเดียว)
    ...(me?.owner?.see.analytics ? ["stats" as const] : []),
    // Plan Slot Live: Owner ที่มีสิทธิ์นี้แต่ไม่มีหน้าเจ้าของ (คนอื่นใช้ที่หน้าเจ้าของ > ตาราง slot)
    ...(me?.owner?.see.plan && !ownerPage ? ["plan" as const] : []),
  ].sort((a, b) => PAGE_ORDER.indexOf(a) - PAGE_ORDER.indexOf(b));
  // หน้าที่ใช้ล่าสุด (จำไว้ในเครื่อง) ไม่เคยใช้ = บทบาทแรก
  const savedPage = useLocal(ROLE_KEY) as Page | null;
  const page: Page | null = savedPage && pages.includes(savedPage) ? savedPage : pages[0] ?? null;
  // หน้าเดิมที่ย้ายไปอยู่ในหน้าเจ้าของแล้ว (Plan Slot Live / ดูหน้าจองของ Mc, Admin) -> เปิดแท็บนั้นให้
  const pageKey = pages.join(",");
  useEffect(() => {
    if (!savedPage || pageKey.split(",").includes(savedPage) || !pageKey.split(",").includes("owner")) return;
    if (savedPage !== "plan" && savedPage !== "mc" && savedPage !== "admin") return;
    writeLocal(OWNER_TAB_KEY, "slots");
    writeLocal(SLOT_VIEW_KEY, savedPage === "plan" ? "plan" : "view");
    writeLocal(ROLE_KEY, "owner");
  }, [savedPage, pageKey]);
  const ownerTab = useLocal(OWNER_TAB_KEY), slotView = useLocal(SLOT_VIEW_KEY);
  // แพลนทั้งเดือนเป็นตารางกว้าง ใช้หน้าจอกว้างกว่า
  const wide = page === "plan" || (page === "owner" && ownerTab === "slots" && slotView === "plan");
  const role: Role | null = page === "home" || page === "proof" || page === "stats" || page === "plan" ? null : page;
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
    toast(`ไปที่ ${MODES[next].label} แล้ว`);
  }

  // จากหน้าแรก: ไปหน้าที่เกี่ยวข้อง (หน้าเจ้าของ เปิดแท็บที่ต้องการ)
  const goTo: Go = (next, ownerTab) => {
    if (ownerTab) writeLocal(OWNER_TAB_KEY, ownerTab);
    writeLocal(ROLE_KEY, next);
    window.scrollTo({ top: 0 });
  };

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

  // ลงทะเบียนแล้ว = มีหน้าที่เปิดได้อย่างน้อยหนึ่งหน้า (รวม Owner ที่ติ๊กแค่ Data analytics / หลักฐานไลฟ์ ซึ่งไม่มีหน้าเจ้าของ)
  const registered = pages.length > 0;
  const name = me && role ? displayName(me, role)
    : me && page === "proof" ? me.owner?.name || me.admin?.name || ""
      : me && (page === "home" || page === "stats" || page === "plan") ? me.owner?.name || "" : "";

  // เมนูหน้า: จอกว้าง = แถบปุ่มใต้หัวเว็บ / มือถือ = แถบล่าง (หน้าจองคิวมีแถบจองอยู่ล่างแล้ว จึงใช้แถบบนแทน)
  const showNav = pages.length > 1 && !!page;
  const bottomNav = showNav && role !== "mc" && role !== "admin";
  const navLabel = (p: Page) => `${PAGE_SHORT[p]}${(p === "mc" || p === "admin") && isPreview(me, p) ? " (ดู)" : ""}`;

  // หน้าหลักฐานไลฟ์ไม่มีบทบาท (role = null) จึงเปิดตารางของฉันไม่ได้
  const canOpenMine = registered && !!role && role !== "owner" && !preview;
  return (
    <div className={cn("mx-auto px-4", wide ? "max-w-[1200px]" : "max-w-[760px]", bottomNav && "pb-20 sm:pb-0")}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-[calc(14px+env(safe-area-inset-top))] pb-2">
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          <span className="text-[15px] font-bold tracking-[.12em] sm:text-[17px] sm:tracking-[.14em]" aria-label="GLORY VITAL">
            GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL
          </span>
          <span className="hidden text-[13px] font-medium text-muted-foreground sm:inline">{mode?.sub ?? "Live booking"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
      </header>

      {showNav ? (
        <nav aria-label="เมนูหน้า" className={cn("-mx-1 mt-1 overflow-x-auto px-1", bottomNav && "max-sm:hidden")}>
          <div className="flex w-max gap-1 rounded-full border bg-card p-1 shadow-card">
            {pages.map((p) => {
              const Icon = PAGE_ICON[p];
              const on = p === page;
              return (
                <button
                  key={p} type="button" onClick={() => setRole(p)} aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors [&_svg]:size-4",
                    on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon />{navLabel(p)}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
      {bottomNav ? (
        <nav aria-label="เมนูหน้า" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-[760px]">
            {pages.map((p) => {
              const Icon = PAGE_ICON[p];
              const on = p === page;
              return (
                <button
                  key={p} type="button" onClick={() => setRole(p)} aria-current={on ? "page" : undefined}
                  className={cn("flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-2 text-[11px] font-semibold [&_svg]:size-5", on ? "text-primary" : "text-muted-foreground")}
                >
                  <Icon /><span className="max-w-full truncate px-0.5">{navLabel(p)}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

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

      {me?.owner && role === "owner" ? <OwnerTabs me={me} /> : null}
      {me && (role === "mc" || role === "admin") ? <SlotBoard key={role} me={me} role={role} preview={preview} /> : null}
      {me && registered && page === "home" ? <HomeView go={goTo} /> : null}
      {me && registered && page === "proof" ? <ProofPage /> : null}
      {me && registered && page === "stats" ? <LiveStats readOnly={!me.owner?.analytics} /> : null}
      {me && registered && page === "plan" ? <PlanSlots readOnly={!me.owner?.plan} /> : null}
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
      <ToTop raised={bottomNav} />
    </div>
  );
}

const OWNER_TAB_KEY = "glory_owner_tab";

/** หน้าเจ้าของ: สรุปรายเดือน | ผลงาน Mc | ตาราง slot | พนักงาน | กฎ (จำแท็บล่าสุดไว้ในเครื่อง) — เห็นเฉพาะฝั่งที่มีสิทธิ์ */
function OwnerTabs({ me }: { me: Me }) {
  const o = me.owner!;
  // scope = ฝั่งที่เปิดดูได้ / edit = ฝั่งที่จัดการได้ (ดูได้อย่างเดียว = ไม่มีปุ่มแก้ และไม่เห็นค่าจ้าง)
  const scope: OwnerScope = { mc: o.see.mc, admin: o.see.admin };
  const edit: OwnerScope = { mc: o.mc, admin: o.admin };
  const canGrantPlan = o.plan;
  const saved = useLocal(OWNER_TAB_KEY);
  // ผลงาน Mc (อันดับ + แคมเปญ) ใช้ยอด GMV ราย Mc จึงเห็นเฉพาะ Owner ที่จัดการ Mc ได้
  const tabs = [
    ["summary", "สรุปรายเดือน"],
    ...(scope.mc ? [["performance", "ผลงาน Mc"] as const] : []),
    ["slots", "ตาราง slot"], ["staff", "พนักงาน"], ["rules", "กฎการทำงาน"],
  ] as const;
  // แท็บเดิม "campaign" ย้ายไปอยู่ใน "ผลงาน Mc"
  const wanted = saved === "campaign" ? "performance" : saved;
  const tab = tabs.some(([id]) => id === wanted) ? wanted! : "summary";
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
      {!(scope.mc && scope.admin) || !(edit.mc && edit.admin) ? (
        <Notice>
          {(["mc", "admin"] as const).filter((s) => scope[s]).map((s, i) => (
            <span key={s}>
              {i ? " · " : ""}ฝั่ง {s === "mc" ? "Mc" : "Admin"}: <strong>{edit[s] ? "จัดการได้" : "ดูได้อย่างเดียว (ไม่เห็นค่าจ้าง)"}</strong>
            </span>
          ))}
        </Notice>
      ) : null}
      <TabsContent value="summary"><OwnerView requester={o.name} /></TabsContent>
      {scope.mc ? <TabsContent value="performance"><PerformanceView /></TabsContent> : null}
      <TabsContent value="slots">
        <SlotWorkspace me={me} scope={scope} edit={edit} plan={o.see.plan ? (o.plan ? "edit" : "view") : null} />
      </TabsContent>
      <TabsContent value="staff"><StaffManager scope={scope} canGrantPlan={canGrantPlan} /></TabsContent>
      <TabsContent value="rules"><RulesEditor scope={scope} edit={edit} /></TabsContent>
    </Tabs>
  );
}

/** raised = มือถือมีแถบเมนูล่าง ยกปุ่มขึ้นเหนือแถบ */
function ToTop({ raised = false }: { raised?: boolean }) {
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
        raised && "max-sm:bottom-[calc(76px+env(safe-area-inset-bottom))]",
      )}
    >
      <ArrowUpIcon />
    </IconButton>
  );
}
