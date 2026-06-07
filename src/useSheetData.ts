/**
 * Auto-fetch từ Google Sheets dùng Google Identity Services (GIS).
 * Sau khi setup VITE_GOOGLE_CLIENT_ID, dashboard tự lấy data
 * mỗi khi click ↻ — dùng session @chotot.vn đang có sẵn trong Chrome.
 */

const SHEET_ID  = "1VkmHBo_1RtzCyo24yhoJbYmZqrgjSl9KGY3w9XWDUqQ";
const RANGE     = "'Data for Claude'!A1:AI";
const SCOPES    = "https://www.googleapis.com/auth/spreadsheets.readonly";
const CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string || "";

export interface ParsedSheetData {
  budgetMatrix: Record<string, Record<string, number[]>>;
  totalByMonth: number[];
  OG: Record<string, { DAU: number[]; DwL: number[]; Lead: number[] }>;
  OS: Record<string, { DAU: number[]; DwL: number[]; Lead: number[] }>;
  OB: Record<string, { fol: number[]; int: number[]; reach: number[]; bclk: number[] }>;
  OA: { inst: number[]; act: number[] };
  timestamp: string;
}

// ── Token cache ────────────────────────────────────────
let _token = ""; let _expiry = 0;

async function waitGIS(ms = 6000) {
  const t = Date.now() + ms;
  while (!(window as any).google?.accounts?.oauth2) {
    if (Date.now() > t) throw new Error("GIS script chưa load — kiểm tra kết nối internet");
    await new Promise(r => setTimeout(r, 150));
  }
}

async function getToken(): Promise<string> {
  if (_token && Date.now() < _expiry - 60_000) return _token;
  await waitGIS();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      prompt: "",                          // silent nếu đã authorize trước
      callback: (r: any) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        _token  = r.access_token;
        _expiry = Date.now() + (r.expires_in || 3600) * 1000;
        resolve(_token);
      },
    });
    // Try silent first; if fails (new session) a popup shows once
    client.requestAccessToken({ prompt: "" });
  });
}

// ── Main fetch ─────────────────────────────────────────
export async function fetchSheetData(): Promise<ParsedSheetData> {
  if (!CLIENT_ID) throw new Error("NO_CLIENT_ID");

  const token = await getToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Sheets API error ${res.status}`);
  }
  const json = await res.json();
  return parseValuesFromRows((json.values || []).slice(1));
}

// ── Helpers ────────────────────────────────────────────
function pN(v: any): number {
  if (!v && v !== 0) return 0;
  const n = parseFloat(String(v).replace(/[,%\s₫đ]/g, ""));
  return isNaN(n) ? 0 : n;
}
function dVert(l: string) {
  const u = l.toUpperCase();
  if (/\bPTY\b|NHÀ TỐT/.test(u)||u.startsWith("PTY")||u.startsWith("/PTY")) return "PTY";
  if (/\bJOB\b|VIỆC LÀM|VLT/.test(u)||u.startsWith("JOB"))                  return "JOB";
  if (/\bVEH\b|\bCTX\b|\bXE\b/.test(u)||u.startsWith("VEH"))                return "VEH";
  if (/\bGDS\b|\bELT\b/.test(u)||u.startsWith("GDS"))                       return "GDS";
  if (/PARENT|MASTER/.test(u))                                               return "PARENT";
  return "OTHER";
}
function dCat(l: string) {
  const s = l.toLowerCase();
  if (/seo|content\s*(blog|hub|outsource)/.test(s))                                           return "SEO";
  if (/growth|digital|retarget|app download|always.on|performance/.test(s))                   return "Growth";
  if (/brand|campaign|kol|influencer|\bpr\b|creative|b2c|b2b|livestream|integrated/.test(s))  return "Brand";
  if (/supply|voucher|zns|sms|incentive/.test(s))                                             return "Supply";
  return "Other";
}

export function parseValuesFromRows(rows: string[][]): ParsedSheetData {
  const VERTS = ["PTY","JOB","VEH","GDS","PARENT"];
  const CATS  = ["Brand","Growth","SEO","Supply"];
  const bm: Record<string, Record<string, number[]>> = {};
  VERTS.forEach(v => { bm[v] = {}; CATS.forEach(c => { bm[v][c] = Array(12).fill(0); }); });
  const OG: any = {PTY:{DAU:[],DwL:[],Lead:[]},JOB:{DAU:[],DwL:[],Lead:[]},VEH:{DAU:[],DwL:[],Lead:[]},GDS:{DAU:[],DwL:[],Lead:[]}};
  const OS: any = {PTY:{DAU:[],DwL:[],Lead:[]},JOB:{DAU:[],DwL:[],Lead:[]},VEH:{DAU:[],DwL:[],Lead:[]},GDS:{DAU:[],DwL:[],Lead:[]}};
  const OB: any = {PTY:{fol:[],int:[],reach:[],bclk:[]},JOB:{fol:[],int:[],reach:[],bclk:[]},VEH:{fol:[],int:[],reach:[],bclk:[]},GDS:{fol:[],int:[],reach:[],bclk:[]}};
  const OA: any = { inst:[], act:[] };

  for (const r of rows) {
    const lbl = String(r[0] || "").trim(); if (!lbl) continue;
    const vert = dVert(lbl), cat = dCat(lbl);
    const months = Array.from({length:12}, (_,j) => pN(r[j+1]));
    if (VERTS.includes(vert) && CATS.includes(cat)) {
      months.forEach((v, mi) => { const m = v > 100_000 ? v/1_000_000 : v; bm[vert][cat][mi] += m; });
    }
    const og={dau:pN(r[19]),dwl:pN(r[20]),lead:pN(r[21])};
    const os={dau:pN(r[24]),dwl:pN(r[25]),lead:pN(r[26])};
    const ob={fol:pN(r[27]),int:pN(r[28]),reach:pN(r[29]),bclk:pN(r[30])};
    if (["PTY","JOB","VEH","GDS"].includes(vert)) {
      if (og.lead||og.dau){OG[vert].DAU.push(og.dau);OG[vert].DwL.push(og.dwl);OG[vert].Lead.push(og.lead);}
      if (os.lead||os.dau){OS[vert].DAU.push(os.dau);OS[vert].DwL.push(os.dwl);OS[vert].Lead.push(os.lead);}
      if (ob.reach||ob.bclk){OB[vert].fol.push(ob.fol);OB[vert].int.push(ob.int);OB[vert].reach.push(ob.reach);OB[vert].bclk.push(ob.bclk);}
    }
    if (pN(r[23])) OA.inst.push(pN(r[23]));
    if (pN(r[32])) OA.act.push(pN(r[32]));
  }

  const totalByMonth = Array(12).fill(0).map((_,mi) =>
    VERTS.reduce((s,v) => s + CATS.reduce((sc,c) => sc + (bm[v][c][mi]||0), 0), 0)
  );
  return { budgetMatrix:bm, totalByMonth, OG, OS, OB, OA, timestamp: new Date().toISOString() };
}
