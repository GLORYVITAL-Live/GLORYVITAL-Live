import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render: build ในเครื่องที่ RAM จำกัด (เกิน 8 GB = build ล้ม) และรันใน 512 MB
  //   ตรวจ TypeScript ตอน build ซ้ำกับ CI (.github/workflows/ci.yml ตรวจทุก push) → ข้าม · ไม่สร้าง source map ฝั่งเซิร์ฟเวอร์
  //   cpus = จำนวน worker ตอนสร้างหน้า (เดิมเท่าจำนวน CPU ของเครื่อง build) · ไม่โหลดทุกหน้าเข้าหน่วยความจำตอนเปิดเซิร์ฟเวอร์
  typescript: { ignoreBuildErrors: true },
  enablePrerenderSourceMaps: false,
  experimental: { cpus: 2, serverSourceMaps: false, preloadEntriesOnStart: false },
  // service worker (แจ้งเตือนเด้ง) ต้องไม่ถูกแคช ไม่งั้นเครื่องจะใช้ไฟล์เก่า
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
