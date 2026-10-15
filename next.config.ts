import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
