"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpIcon, BriefcaseIcon, CalendarDaysIcon, CalendarRangeIcon, CameraIcon, ChartColumnIcon, CrownIcon, HeadsetIcon, HouseIcon, LogOutIcon, MicIcon, MoonIcon,
  GraduationCapIcon, PackageIcon, PackageOpenIcon, ShoppingBagIcon, SunIcon, type LucideIcon,
} from "lucide-react";
import { isShopeeRole } from "@/lib/live-team";
import type { Me, OwnerScope, Role } from "@/lib/types";
import dynamic from "next/dynamic";
import type { Go } from "@/components/HomeView";
import { NotificationBell } from "@/components/Notifications";
import { SlotBoard } from "@/components/SlotBoard";
import { WorkLocationButton } from "@/components/WorkLocation";
import { AppProviders, IconButton, LoadingBlock, Notice, StateBox, useToast } from "@/components/shared";

// หน้าอื่นโหลดแยกเมื่อเปิดใช้ (แต่ละคนใช้แค่ 1–2 หน้า ไม่ต้องโหลดทั้งเว็บตอนเปิดครั้งแรก)
// หน้าจองคิว (SlotBoard) โหลดมาเลย เพราะเป็นหน้าหลักของ Mc / Admin
const Loading = () => <LoadingBlock />;
const Nothing = () => null;
const CeoLive = dynamic(() => import("@/components/CeoLive").then((m) => m.CeoLive), { loading: Loading });
const EquipmentPage = dynamic(() => import("@/components/EquipmentPage").then((m) => m.EquipmentPage), { loading: Loading });
const HomeView = dynamic(() => import("@/components/HomeView").then((m) => m.HomeView), { loading: Loading });
const LiveStats = dynamic(() => import("@/components/LiveStats").then((m) => m.LiveStats), { loading: Loading });
const OwnerView = dynamic(() => import("@/components/OwnerView").then((m) => m.OwnerView), { loading: Loading });
const PerformanceView = dynamic(() => import("@/components/PerformanceView").then((m) => m.PerformanceView), { loading: Loading });
const PlanSlots = dynamic(() => import("@/components/PlanSlots").then((m) => m.PlanSlots), { loading: Loading });
const ProofPage = dynamic(() => import("@/components/ProofPage").then((m) => m.ProofPage), { loading: Loading });
const RulesEditor = dynamic(() => import("@/components/RulesEditor").then((m) => m.RulesEditor), { loading: Loading });
const SlotWorkspace = dynamic(() => import("@/components/SlotWorkspace").then((m) => m.SlotWorkspace), { loading: Loading });
const StaffManager = dynamic(() => import("@/components/StaffManager").then((m) => m.StaffManager), { loading: Loading });
const TrainingPage = dynamic(() => import("@/components/TrainingPage").then((m) => m.TrainingPage), { loading: Loading });
const BorrowPage = dynamic(() => import("@/components/Loans").then((m) => m.BorrowPage), { loading: Loading });
// หน้าต่าง / ป้ายในหน้าจอง (ไม่ต้องมีตัวโหลด)
const MySchedule = dynamic(() => import("@/components/MySchedule").then((m) => m.MySchedule), { loading: Nothing });
const PayDocs = dynamic(() => import("@/components/PayDocs").then((m) => m.PayDocs), { loading: Nothing });
const RulesDialog = dynamic(() => import("@/components/RulesDialog").then((m) => m.RulesDialog), { loading: Nothing });
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayKey } from "@/lib/format";
import { PAGE_KEY, SLOT_VIEW_KEY, useIsDark, useIsHydrated, useLocal, writeLocal } from "@/lib/hooks";
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
    // โควต้าต่อวันแสดงในหน้าจองจากค่าใน settings แล้ว (SlotBoard) ไม่เขียนตัวเลขตายตัวไว้ที่นี่
    rule: "",
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
  equipment: {
    sub: "Equipment", title: "อุปกรณ์โปรดักชั่น", label: "อุปกรณ์",
    hint: "ทะเบียนอุปกรณ์ไลฟ์ / โปรดักชั่น: มีอะไรบ้าง อยู่ที่ไหน สถานะ ยี่ห้อ รุ่น Serial วันที่ซื้อ ราคา และรูป",
    rule: "",
  },
  ceo: {
    sub: "CEO Live", title: "CEO Live", label: "CEO Live",
    hint: "ยอดทั้งวันของวันที่มี CEO Live เทียบวันก่อน ทั้งช่องที่ CEO ไลฟ์และทุกบัญชี (TikTok / Shopee จากไฟล์ Export)",
    rule: "",
  },
  training: {
    sub: "Training", title: "เทรนนิ่ง", label: "เทรนนิ่ง",
    hint: "วิดีโอ product training และสไลด์บรีฟโปรดักต์ กดเล่นในหน้านี้ได้เลย",
    rule: "",
  },
  borrow: {
    sub: "Borrow", title: "ขอยืมอุปกรณ์", label: "ขอยืมอุปกรณ์",
    hint: "ยืมอุปกรณ์โปรดักชั่นของทีมไลฟ์: เลือกวันเวลายืม / คืน แล้วเลือกของที่ว่าง ใส่สถานที่ใช้งาน ส่งคำขอให้ทีมงานอนุมัติ",
    rule: "",
  },
  plan: {
    sub: "Plan slot", title: "Plan Slot Live", label: "Plan Slot Live",
    hint: "แพลน slot ไลฟ์ทั้งเดือนเป็นร่างก่อน แล้วกดบันทึก ระบบจะเขียนลงชีตทั้งแท็บ \"ลงตาราง Deal Mc\" และ \"ลงตาราง Admin เสริม\" (กำหนด Mc / Admin ต่อที่หน้าจัดการ slot)",
    rule: "",
  },
} as const;

/**
 * หน้าที่เลือกได้จากเมนู = บทบาท + หน้าหลักฐานไลฟ์ (Admin ทุกคน / Owner ฝั่ง Mc) + สถิติไลฟ์ / Plan Slot Live (Owner ที่ติ๊กสิทธิ์)
 *   + CEO Live (บัญชี Marketing — Owner ดูได้ที่แท็บ CEO Live ในหน้าสถิติไลฟ์) + เทรนนิ่ง (ทุกคน)
 */
type Page = Role | "home" | "proof" | "stats" | "plan" | "ceo" | "equipment" | "training" | "borrow";
/** ลำดับในเมนูเลือกหน้า */
const PAGE_ORDER: Page[] = ["home", "owner", "stats", "ceo", "plan", "mc", "admin", "proof", "equipment", "borrow", "training"];
/** ชื่อสั้น + ไอคอนในแถบเมนู */
const PAGE_SHORT: Record<Page, string> = {
  home: "หน้าแรก", owner: "เจ้าของ", stats: "สถิติไลฟ์", ceo: "CEO Live", plan: "แพลน slot", mc: "Mc", admin: "Admin", proof: "หลักฐานไลฟ์", equipment: "อุปกรณ์",
  training: "เทรนนิ่ง", borrow: "ขอยืม",
};
const PAGE_ICON: Record<Page, LucideIcon> = {
  home: HouseIcon, owner: BriefcaseIcon, stats: ChartColumnIcon, ceo: CrownIcon, plan: CalendarRangeIcon, mc: MicIcon, admin: HeadsetIcon, proof: CameraIcon, equipment: PackageIcon,
  training: GraduationCapIcon, borrow: PackageOpenIcon,
};

const ROLE_KEY = PAGE_KEY;
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
    // CEO Live: บัญชี Marketing (Owner ที่เข้าสถิติไลฟ์ได้ ดูที่แท็บ CEO Live ในหน้านั้นแทน)
    ...(me?.marketing && !me.owner?.see.analytics ? ["ceo" as const] : []),
    // Plan Slot Live: Owner ที่มีสิทธิ์นี้แต่ไม่มีหน้าเจ้าของ (คนอื่นใช้ที่หน้าเจ้าของ > ตาราง slot)
    ...(me?.owner?.see.plan && !ownerPage ? ["plan" as const] : []),
    // อุปกรณ์โปรดักชั่น: Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊กในหน้าพนักงาน
    ...(me?.equipment ? ["equipment" as const] : []),
    // ขอยืมอุปกรณ์: บัญชีทีมอื่นในบริษัท + Marketing (ทีมเราจัดการคำขอที่หน้าอุปกรณ์ > คำขอยืม)
    ...(me?.borrower ? ["borrow" as const] : []),
    // เทรนนิ่ง (วิดีโอ product training + สไลด์บรีฟ + เฟรมไลฟ์สำหรับคนที่จัดการบรีฟการแต่งตัว): ทุกคนในทีมไลฟ์ (ไม่รวมบัญชีทีมอื่น)
    ...(me && (me.mc || me.admin || me.owner || me.marketing) ? ["training" as const] : []),
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
  const role: Role | null = page === "mc" || page === "admin" || page === "owner" ? page : null;
  const preview = isPreview(me, role);
  // ทีม Shopee: คิวในระบบเป็นบัญชี TikTok ทั้งหมด ไม่แสดงหน้าจอง ใช้ได้แค่ตารางของฉัน (Owner ที่เปิดดูแบบ preview ไม่เกี่ยว)
  const shopee = isShopeeRole(me, role);
  const [myOpen, setMyOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [rulesManual, setRulesManual] = useState(false);
  const dark = useIsDark();

  // กฎการทำงาน: เด้งวันละครั้งต่อบทบาท (ทีม Shopee ไม่เด้ง — เป็นกฎของคิวไลฟ์ TikTok · ยังเปิดเองได้จากตารางของฉัน)
  const rulesKey = me && role ? `glory_rules_seen_${me.email}_${role}` : "";
  const rulesSeen = useLocal(rulesKey);
  const hydrated = useIsHydrated();
  const rulesAuto = hydrated && !!rulesKey && role !== "owner" && !preview && !shopee && rulesSeen !== todayKey();
  const rulesOpen = rulesManual || rulesAuto;
  function closeRules() {
    setRulesManual(false);
    if (rulesKey) writeLocal(rulesKey, todayKey());
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).has("authError")) toast("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่", "error");
  }, [toast]);

  // กดแจ้งเตือนเด้ง (public/sw.js) เปิด /?go=<หน้า> → ไปหน้านั้น แล้วล้างพารามิเตอร์ออกจากลิงก์
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const go = params.get("go");
    if (!go) return;
    if (pageKey.split(",").includes(go)) writeLocal(ROLE_KEY, go);
    params.delete("go");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }, [pageKey]);

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
    // ไลบรารี Supabase โหลดตอนกดเท่านั้น (ไม่ต้องโหลดทุกครั้งที่เปิดเว็บ)
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
  }

  async function signOut() {
    const { createClient } = await import("@/lib/supabase/client");
    // local = ออกเฉพาะเครื่องนี้ (ค่าเริ่มต้นของ Supabase คือ global = เด้งออกทุกเครื่องของบัญชีนี้ เช่น มือถือ + คอม)
    await createClient().auth.signOut({ scope: "local" });
    toast("ออกจากระบบแล้ว");
    router.refresh();
  }

  // ลงทะเบียนแล้ว = มีหน้าที่เปิดได้อย่างน้อยหนึ่งหน้า (รวม Owner ที่ติ๊กแค่ Data analytics / หลักฐานไลฟ์ ซึ่งไม่มีหน้าเจ้าของ)
  const registered = pages.length > 0;
  const name = me && role ? displayName(me, role)
    : me && page === "proof" ? me.owner?.name || me.admin?.name || ""
      : me && (page === "home" || page === "stats" || page === "plan") ? me.owner?.name || ""
        : me && page === "ceo" ? me.marketing?.name || ""
          : me && page === "equipment" ? me.owner?.name || me.admin?.name || ""
            : me && page === "training" ? me.owner?.name || (me.mc ? `Mc ${me.mc.name}` : "") || me.admin?.name || me.marketing?.name || ""
              : me && page === "borrow" ? me.borrower?.name || "" : "";

  // เมนูหน้า: จอกว้าง = แถบปุ่มใต้หัวเว็บ / มือถือ = แถบล่าง (หน้าจองคิวมีแถบจองอยู่ล่างแล้ว จึงใช้แถบบนแทน)
  const showNav = pages.length > 1 && !!page;
  const bottomNav = showNav && role !== "mc" && role !== "admin";
  const navLabel = (p: Page) => `${PAGE_SHORT[p]}${(p === "mc" || p === "admin") && isPreview(me, p) ? " (ดู)" : ""}`;

  // หน้าหลักฐานไลฟ์ไม่มีบทบาท (role = null) จึงเปิดตารางของฉันไม่ได้
  const canOpenMine = registered && !!role && role !== "owner" && !preview;
  return (
    <div className={cn("mx-auto px-4", wide ? "max-w-[1200px]" : "max-w-[760px]", bottomNav && "pb-20 sm:pb-0")}>
      {/* มือถือ: ปุ่มหัวเว็บเล็กลง (36px) + ช่องไฟแคบลง ให้โลโก้กับปุ่มอยู่แถวเดียวกันได้ถึงจอ 360px */}
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 pt-[calc(14px+env(safe-area-inset-top))] pb-2 sm:gap-x-3">
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          <span className="text-[15px] font-bold tracking-[.12em] sm:text-[17px] sm:tracking-[.14em]" aria-label="GLORY VITAL">
            GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL
          </span>
          <span className="hidden text-[13px] font-medium text-muted-foreground sm:inline">{mode?.sub ?? "Live booking"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {registered ? (
            <NotificationBell onGo={(p) => {
              if (p === "guide") router.push("/guide"); // วิธีแชร์ปฏิทิน
              else if (pages.includes(p as Page)) { writeLocal(ROLE_KEY, p); window.scrollTo({ top: 0 }); }
            }} />
          ) : null}
          {/* โลเคชั่นที่ทำงาน: เฉพาะคนที่มีบัญชี (ตั้งลิงก์ไว้แล้วถึงแสดง) */}
          {registered ? <WorkLocationButton /> : null}
          <IconButton label={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"} onClick={toggleTheme} className="bg-card shadow-card max-sm:size-9">
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
              <Button variant="ghost" size="icon" onClick={signOut} aria-label="ออกจากระบบ" title="ออกจากระบบ" className="rounded-full text-muted-foreground max-sm:size-8">
                <LogOutIcon />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {showNav ? (
        <nav aria-label="เมนูหน้า" className={cn("no-scrollbar -mx-1 mt-1 overflow-x-auto px-1", bottomNav && "max-sm:hidden")}>
          <div className="flex w-max gap-1 rounded-full border bg-card p-1 shadow-card">
            {pages.map((p) => {
              const Icon = PAGE_ICON[p];
              const on = p === page;
              return (
                <button
                  key={p} type="button" onClick={() => setRole(p)} aria-current={on ? "page" : undefined}
                  className={cn(
                    // มือถือ: ช่องไฟแคบลง (Mc + Admin + หลักฐานไลฟ์ + เทรนนิ่ง พอดีจอ 375px ไม่ต้องเลื่อน)
                    "flex cursor-pointer items-center gap-1 rounded-full px-2 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors sm:gap-1.5 sm:px-3 [&_svg]:size-4",
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
        {/* หน้าจอง (Mc / Admin) บนมือถือ: ซ่อนคำอธิบายวิธีใช้ ให้ slot ขึ้นมาในจอแรก (กฎดูได้ที่ "กฎการทำงาน") */}
        <p className={cn("mt-1 text-sm text-muted-foreground", (role === "mc" || role === "admin") && !shopee && "max-sm:hidden")}>
          {shopee
            ? "ทีม Shopee — คิวไลฟ์ในหน้านี้ตอนนี้เป็นของช่อง TikTok"
            : page === "training" && me?.briefs ? `${MODES.training.hint} · แท็บเฟรมไลฟ์: เฟรมของแต่ละช่อง / ช่วงวัน + บรีฟการแต่งตัวให้ Mc`
              : mode?.hint ?? "เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ ระบบจะพาไปหน้าของ Mc หรือ Admin ให้อัตโนมัติ"}
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
      {/* เอกสารทำเบิก: ป้ายเตือนถ้ายังไม่ส่ง + หน้าต่างส่ง / แก้ (เปิดจาก "ตารางของฉัน" ได้ด้วย) */}
      {me && (role === "mc" || role === "admin") && !preview ? <PayDocs open={docsOpen} onOpenChange={setDocsOpen} /> : null}
      {me && (role === "mc" || role === "admin") && shopee ? <ShopeeSoon onOpenMine={() => setMyOpen(true)} /> : null}
      {me && (role === "mc" || role === "admin") && !shopee ? <SlotBoard key={role} me={me} role={role} preview={preview} /> : null}
      {me && registered && page === "home" ? <HomeView go={goTo} /> : null}
      {me && registered && page === "proof" ? <ProofPage /> : null}
      {me && registered && page === "stats" ? <LiveStats readOnly={!me.owner?.analytics} /> : null}
      {me && registered && page === "plan" ? <PlanSlots readOnly={!me.owner?.plan} /> : null}
      {me && registered && page === "ceo" ? <CeoLive /> : null}
      {me && registered && page === "equipment" ? <EquipmentPage /> : null}
      {me && registered && page === "training" ? <TrainingPage /> : null}
      {me && registered && page === "borrow" ? <BorrowPage /> : null}
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
            onOpenPayDocs={() => { setMyOpen(false); setDocsOpen(true); }}
            canBook={!shopee}
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
  // [id, ชื่อเต็ม, ชื่อสั้นบนมือถือ (5 แท็บชื่อเต็มยาวเกินจอ 375px)]
  const tabs = [
    ["summary", "สรุปรายเดือน", "สรุป"],
    ...(scope.mc ? [["performance", "ผลงาน Mc", "ผลงาน Mc"] as const] : []),
    ["slots", "ตาราง slot", "ตาราง slot"], ["staff", "พนักงาน", "พนักงาน"], ["rules", "กฎการทำงาน", "กฎ"],
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
      <TabsList aria-label="เมนูเจ้าของ" className="no-scrollbar my-3 h-auto! w-full justify-start overflow-x-auto rounded-full border bg-card p-1 sm:justify-center">
        {tabs.map(([id, label, short]) => (
          <TabsTrigger
            key={id}
            value={id}
            aria-label={label}
            className="rounded-full py-1.5 text-[13px] font-semibold data-active:bg-tint! data-active:text-tint-foreground! sm:text-sm"
          >
            <span className="sm:hidden">{short}</span><span className="max-sm:hidden">{label}</span>
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

/** ทีม Shopee: ยังไม่มีหน้าจองคิว Shopee (คิวในระบบเป็นบัญชี TikTok) ใช้ได้แค่ตารางของฉัน */
function ShopeeSoon({ onOpenMine }: { onOpenMine: () => void }) {
  return (
    <Card className="my-3 shadow-card">
      <CardContent className="flex flex-col items-center gap-3 py-2 text-center">
        <span aria-hidden className="grid size-12 place-items-center rounded-full bg-p1/15 text-p1 [&_svg]:size-6"><ShoppingBagIcon /></span>
        <div>
          <strong className="block text-base">หน้าจองคิว Shopee จะเปิดเร็วๆ นี้</strong>
          <span className="mt-1 block text-sm text-muted-foreground">
            ตอนนี้ดูคิวของคุณ ดาวน์โหลดใบ 50 ทวิ และส่งเอกสารทำเบิกได้ที่ &quot;ตารางของฉัน&quot;
          </span>
        </div>
        <Button size="lg" className="rounded-full px-5 pointer-coarse:min-h-11" onClick={onOpenMine}>
          <CalendarDaysIcon />ตารางของฉัน
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * raised = มือถือมีแถบเมนูล่าง ยกปุ่มขึ้นเหนือแถบ
 *   จอสัมผัส: ขึ้นเฉพาะตอนเลื่อนขึ้น แล้วหายเมื่อเลื่อนลง / หยุดเลื่อน 2.5 วินาที — ปุ่มลอยเคยทับวงกลมติ๊กของการ์ด slot
 *   และปุ่มในหน้า (ย้ายมุมก็ไปทับปุ่มอื่นแทน) · คอม: ขึ้นเมื่อเลื่อนลงมาเกิน 250px เหมือนเดิม (มุมขวาอยู่นอกเนื้อหา)
 */
function ToTop({ raised = false }: { raised?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let timer = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if (!matchMedia("(pointer: coarse)").matches) setShow(y > 250);
      else if (Math.abs(y - last) > 2) {
        // ตำแหน่งเดิม (ท้ายการเลื่อนแบบนุ่ม) = ไม่เปลี่ยน
        setShow(y > 250 && y < last);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setShow(false), 2500);
      }
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.clearTimeout(timer); };
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
