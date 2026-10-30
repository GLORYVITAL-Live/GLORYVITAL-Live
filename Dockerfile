# เว็บจริงบน Render: build + รันด้วย Node 22 (เหมือนตอนอยู่ Vercel) · ติดตั้งแพ็กเกจด้วย bun ตาม bun.lock
#   ค่า NEXT_PUBLIC_* ถูกฝังในไฟล์ตอน build → Render ส่งตัวแปรของ service มาเป็น build arg ให้อัตโนมัติ
#   ห้ามส่งวิดีโอ / ไฟล์ใหญ่ผ่านเซิร์ฟเวอร์นี้ (ปริมาณส่งข้อมูลคิดเงิน) — ให้เบราว์เซอร์โหลดจาก Google / YouTube ตรง
FROM oven/bun:1.4.2 AS bun

FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN node node_modules/next/dist/bin/next build

ENV NODE_ENV=production
EXPOSE 3000
# Render กำหนด PORT ให้ (next start อ่าน PORT เอง)
CMD ["node", "node_modules/next/dist/bin/next", "start"]
