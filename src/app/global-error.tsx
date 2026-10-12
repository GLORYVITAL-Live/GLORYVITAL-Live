"use client";

/**
 * error ที่ทำให้ทั้งเว็บแสดงผลไม่ได้ (เช่น layout หลักพัง) — แสดงแทนทั้งหน้า
 *   ไฟล์นี้ไม่ได้ใช้ style ของเว็บ (ตาม Next.js) จึงใส่ style ในตัว · สีตามธีมของเครื่อง
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <title>เกิดข้อผิดพลาด | GLORY VITAL Live</title>
        <main style={{ maxWidth: 520, margin: "0 auto", minHeight: "100dvh", padding: "40px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
          <strong style={{ letterSpacing: ".12em" }}>GLORY VITAL</strong>
          <h1 style={{ fontSize: 24, margin: 0 }}>ขออภัย เว็บทำงานผิดพลาด</h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>ลองกด &quot;ลองใหม่&quot; หรือเปิดเว็บใหม่อีกครั้ง ถ้าเป็นซ้ำ แจ้งทีมงานพร้อมรหัสด้านล่าง</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#C62F6A", color: "#fff", fontSize: 15, cursor: "pointer" }}>
              ลองใหม่
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- หน้านี้แทนทั้งเว็บ ต้องโหลดใหม่ทั้งหน้า */}
            <a href="/" style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #C62F6A55", color: "inherit", fontSize: 15, textDecoration: "none" }}>
              กลับหน้าแรก
            </a>
          </div>
          {error.digest ? <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>รหัส: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
