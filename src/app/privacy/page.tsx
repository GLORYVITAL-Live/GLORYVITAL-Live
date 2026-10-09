import type { Metadata } from "next";
import Link from "next/link";

// นโยบายความเป็นส่วนตัว (หน้าสาธารณะ ไม่ต้อง login) — ใช้เป็นลิงก์ในหน้า OAuth consent ของ Google Cloud
export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว | GLORY VITAL Live",
  description: "Privacy policy of GLORY VITAL Live booking",
};

const CONTACT = "kunraroj.d@glorythailand.com";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[760px] space-y-8 px-4 py-10 text-sm leading-relaxed">
      <header>
        <Link href="/" className="text-[15px] font-bold tracking-[.12em]">
          GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL
        </Link>
        <h1 className="mt-4 text-2xl font-bold">นโยบายความเป็นส่วนตัว</h1>
        <p className="text-muted-foreground">Privacy Policy · ปรับปรุงล่าสุด 9 ตุลาคม 2026</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">ภาษาไทย</h2>
        <p>
          GLORY VITAL Live เป็นระบบภายในสำหรับให้ Mc และ Admin ของ GLORY VITAL จองคิวไลฟ์ ดูตารางงาน
          และแนบหลักฐานการไลฟ์ ใช้งานได้เฉพาะพนักงานที่ลงทะเบียนอีเมลไว้กับทีมงานเท่านั้น
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>ข้อมูลที่ใช้:</strong> อีเมล ชื่อ และเบอร์โทรที่ทีมงานบันทึกไว้ คิวไลฟ์ที่จอง และรูปหลักฐานการไลฟ์ที่อัปโหลด</li>
          <li><strong>เข้าสู่ระบบด้วย Google:</strong> ใช้เฉพาะอีเมลเพื่อยืนยันว่าเป็นพนักงานที่ลงทะเบียนไว้</li>
          <li>
            <strong>Google Calendar / Sheets / Drive:</strong> บัญชีระบบของบริษัทใช้สิทธิ์เหล่านี้เพื่อลงนัดคิวไลฟ์ในปฏิทินที่พนักงานแชร์ให้
            ซิงค์ตารางงานกับ Google Sheet ของบริษัท และเก็บสำเนารูปหลักฐานในโฟลเดอร์ Drive ที่ระบบสร้างเอง (มองไม่เห็นไฟล์อื่นในไดรฟ์)
          </li>
          <li>
            <strong>Gmail (ส่งอย่างเดียว):</strong> บัญชีระบบส่งอีเมลแจ้งเตือนภายใน (เช่น มีคนยกเลิกคิว) เข้ากล่องเมลของบริษัทเอง
            ไม่อ่านอีเมล และไม่ส่งอีเมลหาพนักงานหรือบุคคลภายนอก
          </li>
          <li><strong>การเก็บรักษา:</strong> ข้อมูลเก็บในฐานข้อมูลของระบบ ใช้เพื่อจัดตารางงานและคำนวณค่าจ้างเท่านั้น ไม่ขาย ไม่ส่งต่อให้บุคคลภายนอก</li>
          <li><strong>การลบข้อมูล:</strong> ติดต่อทีมงานเพื่อขอดูหรือลบข้อมูลของคุณ และยกเลิกการแชร์ปฏิทินกับบัญชีระบบได้ทุกเมื่อ</li>
        </ul>
        <p>ติดต่อ: <a className="text-primary underline" href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">English</h2>
        <p>
          GLORY VITAL Live is an internal tool that lets GLORY VITAL live-stream hosts (Mc) and admins book live-stream slots,
          view their schedule and upload proof of each live stream. Only staff whose email is registered by the team can use it.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Data we use:</strong> the email, name and phone number registered by the team, booked slots, and uploaded live-stream proof images.</li>
          <li><strong>Google Sign-In:</strong> we only use your email address to confirm you are registered staff.</li>
          <li>
            <strong>Google Calendar, Sheets and Drive:</strong> the company&apos;s system account uses these scopes to add booked slots to calendars
            that staff have shared with it, keep the company&apos;s schedule spreadsheet in sync, and store copies of proof images in a Drive folder
            the app creates itself (it cannot see any other Drive files).
          </li>
          <li>
            <strong>Gmail (send only):</strong> the system account sends internal notification emails (for example, when someone cancels a slot)
            to the company&apos;s own mailbox. It does not read email and does not email staff or third parties.
          </li>
          <li><strong>Storage and sharing:</strong> data is stored in the app&apos;s database and used only for scheduling and payroll. We do not sell or share it with third parties.</li>
          <li><strong>Deletion:</strong> contact the team to view or delete your data. You can stop sharing your calendar with the system account at any time.</li>
        </ul>
        <p>Contact: <a className="text-primary underline" href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
      </section>
    </main>
  );
}
