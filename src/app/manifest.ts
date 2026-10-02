import type { MetadataRoute } from "next";

// ข้อมูลแอปตอน "เพิ่มลงหน้าจอโฮม" (Android / Chrome) — iPhone ใช้ app/apple-icon.png + metadata.appleWebApp ใน layout.tsx
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GLORY VITAL Live",
    short_name: "GLORY VITAL",
    description: "จองคิวไลฟ์ Mc และจัดคิว Admin ของ GLORY VITAL",
    start_url: "/",
    display: "standalone",
    background_color: "#FFF7FA",
    theme_color: "#E85B7F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
