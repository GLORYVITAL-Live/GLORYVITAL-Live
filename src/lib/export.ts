// ส่งออกตาราง: ไฟล์ Microsoft Excel (.xlsx สร้างในเบราว์เซอร์) หรือ Google Sheet (สร้างที่ /api/export/sheet)
//   ใช้ข้อมูลรูปแบบเดียวกัน ExportBook = หลายแผ่นงาน แต่ละแผ่นเป็นตาราง (แถวหัวตารางตัวหนา + ตรึงไว้)

import { strToU8, zipSync } from "fflate";

/** รูปแบบตัวเลข: int = 1,234 / money = 1,234.56 / pct = 12.34% (ค่า 0.1234) / dec = 1.5 */
export type NumFmt = "int" | "money" | "pct" | "dec";
export type Cell = string | number | null | undefined | { v: number | null; f: NumFmt };
export type ExportSheet = {
  name: string;
  rows: Cell[][];
  /** แถวหัวตาราง (นับจาก 0) ตัวหนาและตรึงไว้ ไม่ใส่ = แถวแรก / -1 = ไม่มี */
  header?: number;
};
export type ExportBook = { title: string; sheets: ExportSheet[] };

export const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s);

/** ชื่อแผ่นงาน: ไม่เกิน 31 ตัว ห้าม []:*?/\ และห้ามซ้ำ (ใช้ทั้ง Excel และ Google Sheet) */
export function sheetNames(sheets: { name: string }[]) {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name.replace(/[[\]:*?/\\]/g, " ").trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------- Microsoft Excel (.xlsx) ----------

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ลำดับสไตล์ใน styles.xml (cellXfs)
const STYLE = { plain: 0, bold: 1, int: 2, money: 3, pct: 4, dec: 5, link: 6 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><u/><sz val="11"/><color rgb="FF1155CC"/><name val="Tahoma"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE8F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** ความกว้างคอลัมน์โดยประมาณจากความยาวข้อความ */
function cellText(c: Cell) {
  if (c === null || c === undefined) return "";
  if (typeof c === "object") return c.v === null ? "" : c.f === "pct" ? `${(c.v * 100).toFixed(2)}%` : c.v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 2 }) : c;
}

function sheetXml(sheet: ExportSheet, links: string[]) {
  const header = sheet.header ?? 0;
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, j) =>
    Math.min(60, Math.max(8, ...sheet.rows.slice(0, 500).map((r) => (isUrl(r[j]) ? 16 : cellText(r[j]).length + 2)))));
  const hyperlinks: string[] = [];
  const rows = sheet.rows.map((r, i) => {
    const cells = r.map((c, j) => {
      const ref = `${colName(j)}${i + 1}`;
      const bold = i === header;
      if (c === null || c === undefined || c === "") return "";
      if (typeof c === "object") {
        if (c.v === null || !Number.isFinite(c.v)) return "";
        return `<c r="${ref}" s="${bold ? STYLE.bold : STYLE[c.f]}"><v>${c.v}</v></c>`;
      }
      if (typeof c === "number") {
        return Number.isFinite(c) ? `<c r="${ref}"${bold ? ` s="${STYLE.bold}"` : ""}><v>${c}</v></c>` : "";
      }
      if (isUrl(c) && !bold) {
        links.push(c);
        hyperlinks.push(`<hyperlink ref="${ref}" r:id="rId${links.length}"/>`);
      }
      const s = bold ? STYLE.bold : isUrl(c) ? STYLE.link : STYLE.plain;
      return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
    });
    return `<row r="${i + 1}">${cells.join("")}</row>`;
  });
  const freeze = header >= 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${freeze}<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.join("")}</sheetData>${hyperlinks.length ? `<hyperlinks>${hyperlinks.join("")}</hyperlinks>` : ""}
</worksheet>`;
}

export function buildXlsx(book: ExportBook): Uint8Array {
  const names = sheetNames(book.sheets);
  const files: Record<string, Uint8Array> = {};
  const n = book.sheets.length;
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${book.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(STYLES_XML);
  book.sheets.forEach((s, i) => {
    const links: string[] = [];
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s, links));
    if (links.length) {
      files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((u, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(u)}" TargetMode="External"/>`).join("")}</Relationships>`);
    }
  });
  return zipSync(files, { level: 6 });
}

export const fileTitle = (title: string) => title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "export";

export function downloadXlsx(book: ExportBook) {
  const data = buildXlsx(book);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `${fileTitle(book.title)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- ตรวจข้อมูลฝั่ง server (Google Sheet) ----------

const MAX_CELLS = 200_000;

/** ข้อมูลที่ส่งมาสร้าง Google Sheet -> ExportBook ที่ปลอดภัย (null = ผิดรูปแบบ / ใหญ่เกิน) */
export function cleanBook(v: unknown): ExportBook | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.sheets) || !o.sheets.length || o.sheets.length > 20) return null;
  let cells = 0;
  const sheets: ExportSheet[] = [];
  for (const s of o.sheets as Record<string, unknown>[]) {
    if (!s || !Array.isArray(s.rows)) return null;
    const rows: Cell[][] = [];
    for (const r of s.rows as unknown[]) {
      if (!Array.isArray(r)) return null;
      cells += r.length;
      if (cells > MAX_CELLS) return null;
      rows.push(r.slice(0, 200).map((c): Cell => {
        if (c === null || c === undefined) return null;
        if (typeof c === "number") return Number.isFinite(c) ? c : null;
        if (typeof c === "string") return c.slice(0, 5000);
        if (typeof c === "object") {
          const x = c as { v?: unknown; f?: unknown };
          const f = (["int", "money", "pct", "dec"] as const).find((k) => k === x.f);
          return f && typeof x.v === "number" && Number.isFinite(x.v) ? { v: x.v, f } : null;
        }
        return String(c).slice(0, 5000);
      }));
    }
    sheets.push({ name: String(s.name ?? "").slice(0, 100), rows, header: typeof s.header === "number" ? Math.floor(s.header) : 0 });
  }
  return { title: String(o.title ?? "").slice(0, 150) || "GLORY VITAL export", sheets };
}
