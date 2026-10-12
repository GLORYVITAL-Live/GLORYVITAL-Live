import type { Metadata } from "next";
import Link from "next/link";
import { CalendarSteps } from "@/components/CalendarGuide";
import { AppProviders } from "@/components/shared";

export const metadata: Metadata = {
  title: "วิธีใช้ | GLORY VITAL Live",
  description: "แชร์ปฏิทินให้คิวไลฟ์ขึ้นอัตโนมัติ และเพิ่มเว็บไว้หน้าจอโฮม",
};

/** คู่มือ (เปิดได้โดยไม่ต้อง login ส่งลิงก์ทาง LINE ได้) */
export default function GuidePage() {
  return (
    <AppProviders>
    <main className="mx-auto max-w-[640px] space-y-8 px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-16">
      <header>
        <Link href="/" className="text-[15px] font-bold tracking-[.12em]">
          GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL
        </Link>
        <h1 className="mt-3 text-2xl font-bold">วิธีใช้</h1>
        <nav className="mt-2 flex flex-wrap gap-2 text-sm">
          <a href="#calendar" className="rounded-full border bg-card px-3 py-1.5 font-semibold">📅 แชร์ปฏิทิน</a>
          <a href="#home-screen" className="rounded-full border bg-card px-3 py-1.5 font-semibold">📱 เพิ่มไว้หน้าจอโฮม</a>
        </nav>
      </header>

      <section id="calendar" className="scroll-mt-6 space-y-3">
        <h2 className="text-xl font-bold">แชร์ปฏิทินให้คิวไลฟ์ขึ้นอัตโนมัติ</h2>
        <p className="text-sm text-muted-foreground">
          ทำครั้งเดียว ทุกคิวที่จอง / ยกเลิก จะขึ้นใน Google Calendar ของคุณเองภายใน 1–2 นาที (พร้อมชื่อและเบอร์ของคู่ไลฟ์)
          · ใช้อีเมล @glorythailand.com ไม่ต้องทำ
        </p>
        <CalendarSteps />
      </section>

      <section id="home-screen" className="scroll-mt-6 space-y-3">
        <h2 className="text-xl font-bold">เพิ่มเว็บไว้หน้าจอโฮม (ใช้เหมือนแอป)</h2>
        <div className="rounded-xl border bg-card p-4 text-sm">
          <h3 className="mb-2 font-semibold">iPhone (Safari)</h3>
          {/* วิดีโอตัวอย่าง (เบลอรายชื่อติดต่อในหน้าแชร์แล้ว ไม่มีเสียง) */}
          <video
            src="/guide/home-screen.mp4"
            controls
            muted
            playsInline
            preload="metadata"
            className="mx-auto mb-3 w-full max-w-[260px] rounded-xl border bg-black"
            aria-label="วิดีโอวิธีเพิ่มเว็บไว้หน้าจอโฮมบน iPhone"
          />
          <ol className="list-decimal space-y-1 pl-5">
            <li>เปิดเว็บ <b>glory-vital-live.vercel.app</b> ใน Safari</li>
            <li>กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่แถบล่าง</li>
            <li>เลื่อนลง กด &quot;เพิ่มไปยังหน้าจอโฮม&quot;</li>
            <li>กด &quot;เพิ่ม&quot; มุมขวาบน ไอคอน GLORY VITAL จะอยู่บนหน้าจอโฮม</li>
          </ol>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm">
          <h3 className="mb-2 font-semibold">Android (Chrome)</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>เปิดเว็บ <b>glory-vital-live.vercel.app</b> ใน Chrome</li>
            <li>กด ⋮ มุมขวาบน</li>
            <li>กด &quot;เพิ่มลงในหน้าจอหลัก&quot; หรือ &quot;ติดตั้งแอป&quot; แล้วกดยืนยัน</li>
          </ol>
        </div>
      </section>

      <Link href="/" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">ไปที่เว็บ GLORY VITAL Live</Link>
    </main>
    </AppProviders>
  );
}
