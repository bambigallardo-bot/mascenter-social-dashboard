"use client";

import { useEffect, useState, useCallback, useMemo, useContext, createContext } from "react";

// Contexto de edición: provee si se puede editar, de dónde leer los overrides y cómo guardar.
const EditCtx = createContext({ kv: false, canEdit: false, getOverride: () => null, save: null, reset: null });
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

const REFRESH_MS = 300000; // 5 min
const BRAND = "#E52522"; // rojo de marca Más Center / Grupo IFB (muestreado del logo oficial)
const BRAND_DARK = "#B01D1A";
const COLORS = ["#E52522", "#2563eb", "#16a34a", "#7c3aed", "#d97706", "#0891b2", "#ea580c", "#64748b"];

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("es-CL") : n ?? "—");
// Parser tolerante al formato chileno: "3,36" -> 3.36 · "13.572" -> 13572 · "12,5%" -> 12.5
function parseNum(v) {
  if (v == null) return null;
  let s = String(v).trim().replace(/%/g, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // coma decimal, punto de miles
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // puntos de miles: 13.572 -> 13572
  const n = Number(s);
  return isNaN(n) ? null : n;
}
const fmtPct = (n) => (typeof n === "number" ? `${n}%`.replace(".", ",") : "—");
const fmtMoney = (n) => (typeof n === "number" ? `$${Math.round(n).toLocaleString("es-CL")}` : "—");
const fmtDuration = (s) => {
  if (typeof s !== "number") return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const monthLabel = (key) => {
  if (!key) return "—";
  const [y, m] = key.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const monthName = (key) => {
  if (!key) return "el mes";
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-CL", { month: "long", timeZone: "UTC" });
};

// Variación porcentual cur vs prev -> { pct, dir: 1|0|-1 }
function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { pct, dir: pct > 0 ? 1 : pct < 0 ? -1 : 0 };
}

// La API solo da el total de seguidores ACTUAL. Reconstruye el total de cada mes
// hacia atrás: total actual − nuevos seguidores de los meses posteriores. (Aproximado.)
function followersByMonth(monthly, currentTotal, gainKey) {
  const map = {};
  let running = currentTotal;
  for (let i = (monthly || []).length - 1; i >= 0; i--) {
    map[monthly[i].key] = running;
    if (running != null) running -= (monthly[i][gainKey] || 0);
  }
  return map;
}

// ---------------- UI helpers ----------------
function Card({ label, value, accent, change }) {
  const arrow = change ? (change.dir > 0 ? "▲" : change.dir < 0 ? "▼" : "▬") : null;
  const color = change ? (change.dir > 0 ? "#16a34a" : change.dir < 0 ? "#dc2626" : "#6b7280") : null;
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e4e7ec", borderRadius: 14, padding: "16px 18px", minWidth: 0, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || "#1a1a1a" }}>{value}</div>
      {change && (
        <div style={{ fontSize: 12, color, marginTop: 4 }}>
          {arrow} {Math.abs(change.pct).toLocaleString("es-CL")}% <span style={{ color: "#9aa3af" }}>vs mes ant.</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, subtitle }) {
  return (
    <section style={{ marginTop: 44 }}>
      <h2 style={{ fontSize: 19, margin: 0 }}>{title}</h2>
      {subtitle && <div style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>{subtitle}</div>}
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}

const grid = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 14 });
const panel = { background: "#ffffff", border: "1px solid #e4e7ec", borderRadius: 14, padding: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" };
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#ffffff", borderRadius: 14, overflow: "hidden", border: "1px solid #e4e7ec" };
const th = { textAlign: "left", padding: "10px 12px", color: "#6b7280", borderBottom: "1px solid #e4e7ec", fontWeight: 600, background: "#f9fafb" };
const td = { padding: "10px 12px", borderBottom: "1px solid #e4e7ec" };
const manualBadge = { fontSize: 11, fontWeight: 700, color: "#d97706", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 6, padding: "2px 7px", marginLeft: 8, verticalAlign: "middle" };
const chromeBadge = { fontSize: 11, fontWeight: 700, color: "#2563eb", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.4)", borderRadius: 6, padding: "2px 7px", marginLeft: 8, verticalAlign: "middle" };
const autoBadge = { fontSize: 11, fontWeight: 700, color: "#16a34a", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "2px 7px", marginLeft: 8, verticalAlign: "middle" };
const alertBox = { background: "#fff8e6", border: "1px solid #f0d68a", color: "#92670a", padding: "12px 16px", borderRadius: 12, fontSize: 13.5 };
const toneColor = { good: "#16a34a", warn: "#d97706", bad: "#dc2626", info: "#2563eb" };

const miniBtn = { background: "#f4f5f7", color: "#374151", border: "1px solid #e4e7ec", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 };

// Conclusión auto-redactada, editable en modo edición. Override desde servidor (KV) o localStorage.
function Conclusion({ id, text }) {
  const ctx = useContext(EditCtx);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [localOv, setLocalOv] = useState(null);
  const [saving, setSaving] = useState(false);
  const usingServer = ctx.kv;
  useEffect(() => {
    if (usingServer || !id) return;
    try { setLocalOv(localStorage.getItem(`concl:${id}`)); } catch (_) {}
  }, [id, usingServer]);
  const override = usingServer ? ctx.getOverride(id) : localOv;
  if (!text && !override) return null;
  const shown = (override ?? text) || "";
  const doSave = async () => {
    setSaving(true);
    if (usingServer) { await ctx.save(id, draft); }
    else { try { localStorage.setItem(`concl:${id}`, draft); } catch (_) {} setLocalOv(draft); }
    setSaving(false); setEditing(false);
  };
  const doReset = async () => {
    setSaving(true);
    if (usingServer) { await ctx.reset(id); }
    else { try { localStorage.removeItem(`concl:${id}`); } catch (_) {} setLocalOv(null); }
    setSaving(false); setEditing(false);
  };
  const whiteBtn = { background: "rgba(255,255,255,0.18)", color: "#fff", border: "1px solid rgba(255,255,255,0.55)", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 };
  return (
    <div style={{ background: BRAND, borderRadius: 14, padding: 16, marginTop: 18, color: "#fff", boxShadow: "0 1px 3px rgba(229,37,34,0.25)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", fontWeight: 700, letterSpacing: 0.4 }}>📝 CONCLUSIÓN {override ? "· EDITADA" : "AUTOMÁTICA"}</div>
        {ctx.canEdit && !editing && (
          <button className="no-print" onClick={() => { setDraft(shown); setEditing(true); }} style={whiteBtn}>✏️ Editar</button>
        )}
      </div>
      {editing ? (
        <div className="no-print">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} style={{ width: "100%", boxSizing: "border-box", background: "#fff", color: "#1a1a1a", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "inherit", lineHeight: 1.5 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button disabled={saving} onClick={doSave} style={{ background: "#fff", color: BRAND, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{saving ? "Guardando…" : "Guardar"}</button>
            <button disabled={saving} onClick={doReset} style={whiteBtn}>Restaurar automática</button>
            <button onClick={() => setEditing(false)} style={whiteBtn}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14.5, lineHeight: 1.55, color: "#fff", whiteSpace: "pre-wrap" }}>{shown}</div>
      )}
    </div>
  );
}

function ChartBox({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{title}</div>
      <div style={{ ...panel, height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

const axis = { tick: { fill: "#6b7280", fontSize: 11 } };
const tip = { contentStyle: { background: "#f4f5f7", border: "1px solid #e4e7ec" } };

// ---------------- Conclusiones automáticas (voz del informe) ----------------
const trend = (d, up = "aumentó", down = "disminuyó", flat = "se mantuvo estable") =>
  !d ? flat : d.dir > 0 ? up : d.dir < 0 ? down : flat;
const absPct = (d) => (d ? `${Math.abs(d.pct).toLocaleString("es-CL")}%` : "");

function igConclusion(key, cur, prev, followers) {
  if (!cur) return null;
  const mes = monthName(key);
  const dReach = delta(cur.reach, prev?.reach);
  const dViews = delta(cur.views, prev?.views);
  const dInter = delta(cur.interactions, prev?.interactions);
  const dPosts = delta(cur.posts, prev?.posts);
  const p = [];
  p.push(
    `Durante ${mes}, la cuenta de Instagram ${dReach ? `registró ${trend(dReach, "una expansión", "una contracción", "estabilidad")} en su alcance del ${absPct(dReach)}` : `alcanzó ${fmt(cur.reach)} cuentas`}` +
    `${dViews ? ` y ${trend(dViews, "un alza", "una baja", "estabilidad")} en las visualizaciones de ${absPct(dViews)}` : ""}, con ${fmt(cur.posts)} publicaciones en el mes${dPosts ? ` (${trend(dPosts, "más", "menos", "igual")} que el período anterior)` : ""}.`
  );
  if (cur.engagement != null)
    p.push(`La participación de la comunidad ${trend(dInter, "creció", "se moderó", "se mantuvo plana")}${dInter ? ` (interacciones ${absPct(dInter)})` : ""}, situando el engagement en ${fmtPct(cur.engagement)}, lo que refleja el interés de la audiencia base.`);
  if (followers != null) p.push(`La cuenta llegó a ${fmt(followers)} seguidores${cur.newFollowers ? ` tras sumar ${fmt(cur.newFollowers)} nuevos en el mes` : ""}.`);
  if (cur.webClicks != null) p.push(`Los clics hacia la web fueron ${fmt(cur.webClicks)}, principal puente hacia la conversión.`);
  return p.join(" ");
}

function fbConclusion(key, cur, prev, followers) {
  if (!cur) return null;
  const mes = monthName(key);
  const dViews = delta(cur.impressions, prev?.impressions);
  const dInter = delta(cur.engagement, prev?.engagement);
  const p = [];
  p.push(
    `En Facebook, durante ${mes} la página ${followers != null ? `alcanzó los ${fmt(followers)} seguidores` : "mantuvo su comunidad"}${cur.fanAdds ? ` sumando ${fmt(cur.fanAdds)} nuevos` : ""}, ` +
    `con ${fmt(cur.impressions)} visualizaciones${dViews ? ` (${trend(dViews, "+", "−", "")}${absPct(dViews)})` : ""} e interacciones de ${fmt(cur.engagement)}${dInter ? ` (${trend(dInter, "al alza", "a la baja", "estables")})` : ""}, sobre ${fmt(cur.posts)} publicaciones.`
  );
  if (cur.profileViews != null) p.push(`Se registraron ${fmt(cur.profileViews)} visitas al perfil, una oportunidad para convertir en clientes potenciales con pauta de productos y precios claros.`);
  return p.join(" ");
}

function adsConclusion(key, cur, prev, currency) {
  if (!cur) return null;
  const mes = monthName(key);
  const dLeads = delta(cur.leads, prev?.leads);
  const dLP = delta(cur.landingViews, prev?.landingViews);
  const p = [];
  p.push(
    `Durante ${mes}, las campañas de Meta Ads de Más Center invirtieron ${fmtMoney(cur.spend)} con un alcance de ${fmt(cur.reach)} cuentas, repartidas entre los objetivos de Tráfico, Formularios y Mensajes.`
  );
  if (cur.landingViews) p.push(`Las campañas de Tráfico llevaron ${fmt(cur.landingViews)} visitas a la página de destino${dLP ? ` (${trend(dLP, "+", "−", "")}${absPct(dLP)})` : ""}, sosteniendo el rol de Meta como principal motor de adquisición.`);
  if (cur.leads) p.push(`Las campañas de Formularios generaron ${fmt(cur.leads)} leads${dLeads ? ` (${trend(dLeads, "al alza", "a la baja", "estable")} ${absPct(dLeads)} vs. el mes anterior)` : ""}${cur.costPerLead != null ? `, con un costo por lead de ${fmtMoney(cur.costPerLead)}` : ""}.`);
  if (cur.conversations) p.push(`Las campañas de Mensajes sumaron ${fmt(cur.conversations)} conversaciones iniciadas${cur.cpr != null ? ` (costo por conversación ${fmtMoney(cur.cpr)})` : ""}.`);
  return p.join(" ");
}

function googleAdsConclusion(key, cur, prev, topKw) {
  if (!cur) return null;
  const mes = monthName(key);
  const dConv = delta(cur.conversions, prev?.conversions);
  const dCost = delta(cur.cost, prev?.cost);
  const p = [];
  p.push(
    `Durante ${mes}, Google Ads generó ${fmt(cur.conversions)} conversiones${dConv ? ` (${trend(dConv, "al alza", "a la baja", "estable")} ${absPct(dConv)} vs. el mes anterior)` : ""}, ` +
    `con ${fmt(cur.clicks)} clics, un CTR de ${fmtPct(cur.ctr)} y una inversión de ${fmtMoney(cur.cost)}${dCost ? ` (${trend(dCost, "+", "−", "")}${absPct(dCost)})` : ""}.`
  );
  if (cur.costPerConv != null) p.push(`El costo por conversión se situó en ${fmtMoney(cur.costPerConv)} y el CPC promedio en ${fmtMoney(cur.cpc)}.`);
  if (topKw) p.push(`La keyword con más resultados fue «${topKw.text}» (${fmt(topKw.conversions)} conversiones, CTR ${fmtPct(topKw.ctr)}), reflejando tráfico calificado con intención de compra.`);
  return p.join(" ");
}

function ga4Conclusion(key, cur, prev, topChannel) {
  if (!cur) return null;
  const mes = monthName(key);
  const dUsers = delta(cur.activeUsers, prev?.activeUsers);
  const dKey = delta(cur.keyEvents, prev?.keyEvents);
  const p = [];
  p.push(
    `En ${mes}, el sitio registró ${fmt(cur.activeUsers)} usuarios activos${dUsers ? ` (${trend(dUsers, "+", "−", "")}${absPct(dUsers)})` : ""} y ${fmt(cur.sessions)} sesiones, con ${fmt(cur.views)} vistas de página.`
  );
  p.push(`Los eventos clave (conversiones) fueron ${fmt(cur.keyEvents)}${dKey ? `, ${trend(dKey, "creciendo", "disminuyendo", "estables")} ${absPct(dKey)}` : ""}, con una duración media de interacción de ${fmtDuration(cur.avgEngagementSec)}.`);
  if (topChannel) p.push(`${topChannel.channel} fue la principal fuente de conversiones del mes (${fmt(topChannel.keyEvents)} eventos clave sobre ${fmt(topChannel.sessions)} sesiones).`);
  return p.join(" ");
}

function emailConclusion(key, cur, prev, best) {
  if (!cur || !cur.campaigns?.length) return null;
  const mes = monthName(key);
  const dOpen = delta(cur.openRate, prev?.openRate);
  const p = [];
  p.push(
    `En ${mes}, Email Marketing (Ebema Click) entregó ${fmt(cur.delivered)} correos con ${fmt(cur.opens)} aperturas, alcanzando un Open Rate de ${fmtPct(cur.openRate)}${dOpen ? ` (${trend(dOpen, "+", "−", "")}${absPct(dOpen)} vs. el mes anterior)` : ""} y un CTOR de ${fmtPct(cur.ctor)}.`
  );
  if (best) p.push(`La campaña «${best.name}» destacó como el mejor envío del período, con ${fmtPct(best.openRate)} de apertura y ${fmtPct(best.clickRate)} de clic.`);
  p.push(`Los resultados confirman que los contenidos segmentados y relevantes generan mayor interacción aun con menor volumen de envíos.`);
  return p.join(" ");
}

function waConclusion(key, cur, prev, best) {
  if (!cur || !cur.campaigns?.length) return null;
  const mes = monthName(key);
  const dRead = delta(cur.readRate, prev?.readRate);
  const p = [];
  p.push(
    `En ${mes}, WhatsApp (Ebema Click) envió ${fmt(cur.sent)} mensajes con ${fmtPct(cur.deliveryRate)} de entrega y ${fmt(cur.read)} lecturas (${fmtPct(cur.readRate)}${dRead ? `, ${trend(dRead, "+", "−", "")}${absPct(dRead)} vs. el mes anterior` : ""}).`
  );
  if (best) p.push(`La campaña «${best.name}» fue la más leída del período (${fmtPct(best.readRate)}).`);
  if (cur.errors > 0) p.push(`Se registraron ${fmt(cur.errors)} errores de entrega a revisar.`);
  p.push(`WhatsApp mantiene una visibilidad muy superior al email, ideal para mensajes urgentes o de alto valor.`);
  return p.join(" ");
}

const shortName = (s) => (s || "").replace(/^.*?[-–|]\s*/, "").slice(0, 26) || (s || "").slice(0, 26);

// Resumen ejecutivo: 1 línea por canal disponible para el mes.
function execSummary(sel, ig, fb, ads, gads, ga4, li, email, wa) {
  const out = [];
  if (ig?.cur) out.push({ emoji: "📸", t: `Instagram: ${fmt(ig.followers)} seguidores · alcance ${fmt(ig.cur.reach)} · engagement ${fmtPct(ig.cur.engagement)}.` });
  if (fb?.cur) out.push({ emoji: "👍", t: `Facebook: ${fmt(fb.followers)} seguidores · ${fmt(fb.cur.impressions)} visualizaciones · ${fmt(fb.cur.engagement)} interacciones.` });
  if (li?.cur) out.push({ emoji: "💼", t: `LinkedIn (IFB): ${fmt(li.followers)} seguidores · ${fmt(li.cur.impressions)} impresiones · ${fmt(li.cur.reactions)} reacciones.` });
  if (ads?.cur) out.push({ emoji: "🎯", t: `Meta Ads: inversión ${fmtMoney(ads.cur.spend)}${ads.cur.leads ? ` · ${fmt(ads.cur.leads)} leads` : ""}${ads.cur.landingViews ? ` · ${fmt(ads.cur.landingViews)} visitas LP` : ""}${ads.cur.conversations ? ` · ${fmt(ads.cur.conversations)} conversaciones` : ""}.` });
  if (gads?.cur) out.push({ emoji: "🔎", t: `Google Ads: ${fmt(gads.cur.conversions)} conversiones · CTR ${fmtPct(gads.cur.ctr)} · inversión ${fmtMoney(gads.cur.cost)}.` });
  if (ga4?.cur) out.push({ emoji: "📊", t: `GA4: ${fmt(ga4.cur.activeUsers)} usuarios · ${fmt(ga4.cur.sessions)} sesiones · ${fmt(ga4.cur.keyEvents)} eventos clave.` });
  if (email?.cur) out.push({ emoji: "✉️", t: `Email: ${fmt(email.cur.delivered)} entregados · Open Rate ${fmtPct(email.cur.openRate)} · CTOR ${fmtPct(email.cur.ctor)}.` });
  if (wa?.cur) out.push({ emoji: "💬", t: `WhatsApp: ${fmt(wa.cur.sent)} enviados · ${fmtPct(wa.cur.deliveryRate)} entrega · ${fmtPct(wa.cur.readRate)} leído.` });
  return out;
}

// ---------------- LinkedIn (manual) ----------------
function linkedinConclusion(key, cur, prev, followers, fPrev, best) {
  if (!cur) return null;
  const mes = monthName(key);
  const dImp = delta(cur.impressions, prev?.impressions);
  const dReac = delta(cur.reactions, prev?.reactions);
  const dFoll = delta(followers, fPrev);
  const p = [];
  p.push(
    `Durante ${mes}, Grupo IFB alcanzó los ${fmt(followers)} seguidores en LinkedIn${cur.acquired ? ` tras sumar ${fmt(cur.acquired)} nuevos` : ""}${dFoll ? ` (${trend(dFoll, "+", "−", "")}${absPct(dFoll)})` : ""}.`
  );
  p.push(`Las impresiones ${trend(dImp, "se elevaron", "bajaron", "se mantuvieron")}${dImp ? ` ${absPct(dImp)}` : ""} alcanzando las ${fmt(cur.impressions)}, y las reacciones ${trend(dReac, "subieron", "bajaron", "se mantuvieron")} a ${fmt(cur.reactions)}, situando el engagement en ${fmtPct(cur.engagement)}.`);
  if (best?.[0]) p.push(`El contenido más relevante fue «${best[0].label}» (${fmt(best[0].impressions)} impresiones), validando la respuesta de la comunidad profesional a los hitos institucionales.`);
  return p.join(" ");
}

// ---------------- Competencia (manual) ----------------
// Compara el ENGAGEMENT (ER%) de Más Center vs. la competencia.
// Fórmula del informe: (Likes + Comentarios) / Seguidores × 100. Rango esperado 1–5%.
// Cada marca tiene { followers, engagement } por mes; las cifras de la competencia son aproximadas.
const RED_NAME = "MÁS CENTER";
function competenciaRows(block, key, prevKey) {
  if (!block) return [];
  const cur = block[key] || null;
  const prev = block[prevKey] || null;
  if (!cur) return [];
  return Object.keys(cur)
    .map((brand) => {
      const c = cur[brand] || {};
      const p = prev?.[brand] || {};
      const er = c.engagement ?? null;
      const erPrev = p.engagement ?? null;
      const followers = c.followers ?? null;
      const follPrev = p.followers ?? null;
      return {
        brand,
        er,
        erPrev,
        erDelta: er != null && erPrev != null ? Math.round((er - erPrev) * 100) / 100 : null,
        followers,
        follPrev,
        follGrowth: followers && follPrev ? Math.round(((followers - follPrev) / follPrev) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (b.er ?? -1) - (a.er ?? -1));
}

function competenciaConclusion(rows) {
  if (!rows.length) return null;
  const me = rows.find((r) => r.brand.toUpperCase().includes(RED_NAME));
  if (!me) return null;
  const others = rows.filter((r) => r !== me && r.er != null);
  const avgOthers = others.length ? Math.round((others.reduce((a, r) => a + r.er, 0) / others.length) * 100) / 100 : null;
  const p = [];
  p.push(
    `Más Center registró un engagement de ${me.er != null ? fmtPct(me.er) : "—"} en el mes${avgOthers != null ? `, ${me.er > avgOthers ? "por sobre" : "frente a"} un promedio de ${fmtPct(avgOthers)} de la competencia` : ""}.`
  );
  if (others.length) p.push(`En el set competitivo, ${others.map((r) => `${r.brand} (${fmtPct(r.er)})`).join(", ")} operan con comunidades grandes y una estrategia enfocada en alcance masivo, lo que tiende a diluir su ER.`);
  p.push(`El enfoque comunitario y la cercanía con locatarios le permiten a Más Center sostener un engagement por sobre el rango habitual del rubro.`);
  return p.join(" ");
}

// ---------------- Plan del próximo mes (predictivo / prescriptivo) ----------------
function buildPlan(sel, ads, gads, ga4, ig, fb, email) {
  const out = [];
  const a = ads?.cur, g = gads?.cur;

  // Eficiencia comparada paid: CPR Meta vs costo/conv Google.
  if (a?.cpr != null && g?.costPerConv != null) {
    const cheaper = a.cpr <= g.costPerConv ? "Meta Ads" : "Google Ads";
    const ratio = Math.round((Math.max(a.cpr, g.costPerConv) / Math.max(1, Math.min(a.cpr, g.costPerConv))) * 10) / 10;
    out.push({ emoji: "⚖️", tone: "info", title: "Reasignar presupuesto al canal más eficiente", text: `${cheaper} rinde más barato por resultado (Meta CPR ${fmtMoney(a.cpr)} vs Google costo/conv ${fmtMoney(g.costPerConv)}, ~${ratio}×). Inclina ~10-15% del presupuesto hacia ${cheaper} y mide el efecto.` });
  }

  // Inversión sugerida (mantiene total, inclina al más eficiente).
  if (a?.spend != null && g?.cost != null) {
    const total = a.spend + g.cost;
    const metaEff = a.cpr || Infinity, gEff = g.costPerConv || Infinity;
    const tilt = metaEff <= gEff ? { meta: 0.57, google: 0.43 } : { meta: 0.43, google: 0.57 };
    out.push({ emoji: "💰", tone: "good", title: "Inversión sugerida próximo mes", text: `Total ${fmtMoney(total)} aprox: Meta ${fmtMoney(total * tilt.meta)} · Google ${fmtMoney(total * tilt.google)} (ponderado por eficiencia actual). Ajusta según objetivos del mes.` });
  }

  // Pausar / optimizar la sucursal/campaña Meta más cara.
  if (ads?.cur?.campaigns?.length) {
    const withCpr = ads.cur.campaigns.filter((c) => c.cpr != null && c.conversations > 0);
    if (withCpr.length) {
      const worst = [...withCpr].sort((a, b) => b.cpr - a.cpr)[0];
      const best = [...withCpr].sort((a, b) => a.cpr - b.cpr)[0];
      out.push({ emoji: "✂️", tone: "warn", title: "Revisar campaña Meta más cara", text: `«${worst.name}» tuvo el CPR más alto (${fmtMoney(worst.cpr)}). Revisa segmentación/creatividad o redistribuye hacia «${best.name}» (CPR ${fmtMoney(best.cpr)}).` });
    }
  }

  // Escalar las keywords de Google con mejor conversión.
  if (gads?.keywords?.length) {
    const top = gads.keywords.slice(0, 3).map((k) => `«${k.text}»`).join(", ");
    out.push({ emoji: "🔑", tone: "good", title: "Escalar keywords ganadoras", text: `Sube pujas/presupuesto en ${top}, que concentran las conversiones de Search con buen CTR.` });
  }

  // Canal de mayor conversión en GA4.
  if (ga4?.channels?.length) {
    const top = ga4.channels[0];
    out.push({ emoji: "🌐", tone: "info", title: "Apoyar el canal que más convierte", text: `${top.channel} fue la principal fuente de eventos clave (${fmt(top.keyEvents)}). Refuerza landing y remarketing para ese tráfico.` });
  }

  // Orgánico: foco de contenido según engagement.
  if (ig?.cur || fb?.cur) {
    out.push({ emoji: "🖼️", tone: "info", title: "Contenido orgánico con producto y precio", text: `Sumar publicaciones de productos con precios visibles en IG/FB para reactivar clics a la web y convertir las visitas al perfil en clientes.` });
  }

  // Email: próxima acción según open/ctor.
  if (email?.cur) {
    const low = email.cur.clickRate != null && email.cur.clickRate < 2;
    out.push({ emoji: "✉️", tone: low ? "warn" : "good", title: low ? "Reforzar el CTA del email" : "Mantener segmentación del email", text: low ? `El clic está bajo (${fmtPct(email.cur.clickRate)}). Usa un CTA único y claro y segmenta por comuna/necesidad operativa.` : `La segmentación operativa rinde (Open ${fmtPct(email.cur.openRate)}, CTOR ${fmtPct(email.cur.ctor)}). Reincorpora gradualmente campañas comerciales con beneficio claro.` });
  }

  return out;
}

// ---------------- Puntos de mejora (qué optimizar / qué se hizo mal) ----------------
function buildImprovements(sel, ig, fb, ads, gads, ga4, li, email, comp) {
  const out = [];
  const dn = (c, p) => { const d = delta(c, p); return d && d.dir < 0; };

  if (ig?.cur && dn(ig.cur.reach, ig.prev?.reach)) out.push({ emoji: "📉", tone: "warn", title: "Instagram: alcance a la baja", text: `El alcance cayó ${absPct(delta(ig.cur.reach, ig.prev?.reach))}. Sube la frecuencia de publicación y prueba formatos de mayor alcance (reels, colaboraciones).` });
  if (ig?.cur && ig.cur.engagement != null && ig.cur.engagement < 1) out.push({ emoji: "💬", tone: "warn", title: "Instagram: engagement bajo", text: `El engagement (${fmtPct(ig.cur.engagement)}) está bajo. Más CTAs, preguntas y contenido de producto con precio para activar interacción.` });

  if (fb?.cur && dn(fb.cur.impressions, fb.prev?.impressions)) out.push({ emoji: "📉", tone: "warn", title: "Facebook: visualizaciones a la baja", text: `Las visualizaciones bajaron ${absPct(delta(fb.cur.impressions, fb.prev?.impressions))}. Recupera frecuencia y refuerza con pauta de bajo costo los mejores posts.` });

  if (li?.cur && dn(li.cur.impressions, li.prev?.impressions)) out.push({ emoji: "📉", tone: "warn", title: "LinkedIn: impresiones a la baja", text: `Impresiones ${absPct(delta(li.cur.impressions, li.prev?.impressions))} menos. Publica más hitos institucionales y efemérides, que es lo que mejor responde en este canal.` });

  if (ads?.cur && delta(ads.cur.cpr, ads.prev?.cpr)?.dir > 0) out.push({ emoji: "💸", tone: "warn", title: "Meta Ads: CPR al alza", text: `El costo por conversación subió ${absPct(delta(ads.cur.cpr, ads.prev?.cpr))} (${fmtMoney(ads.cur.cpr)}). Revisa segmentación y creatividades de las sucursales más caras.` });
  if (ads?.cur?.campaigns?.length) {
    const worst = [...ads.cur.campaigns].filter((c) => c.cpr != null && c.conversations > 0).sort((a, b) => b.cpr - a.cpr)[0];
    if (worst) out.push({ emoji: "🎯", tone: "warn", title: "Meta Ads: sucursal ineficiente", text: `«${worst.name}» tuvo el CPR más alto (${fmtMoney(worst.cpr)}). Optimiza o redistribuye su presupuesto.` });
  }

  if (gads?.cur && delta(gads.cur.costPerConv, gads.prev?.costPerConv)?.dir > 0) out.push({ emoji: "💸", tone: "warn", title: "Google Ads: costo/conv. al alza", text: `El costo por conversión subió ${absPct(delta(gads.cur.costPerConv, gads.prev?.costPerConv))} (${fmtMoney(gads.cur.costPerConv)}). Pausa keywords caras sin conversión y sube pujas en las ganadoras.` });
  if (gads?.cur && gads.cur.ctr != null && gads.cur.ctr < 5) out.push({ emoji: "🔎", tone: "warn", title: "Google Ads: CTR mejorable", text: `El CTR (${fmtPct(gads.cur.ctr)}) tiene espacio. Ajusta titulares y extensiones; prioriza términos de marca y de alta intención.` });

  if (ga4?.cur && dn(ga4.cur.activeUsers, ga4.prev?.activeUsers)) out.push({ emoji: "📊", tone: "warn", title: "GA4: caída de usuarios", text: `Usuarios activos ${absPct(delta(ga4.cur.activeUsers, ga4.prev?.activeUsers))} menos. Refuerza el tráfico del canal más eficiente y revisa velocidad/experiencia del sitio.` });
  if (ga4?.cur && ga4.cur.avgEngagementSec != null && ga4.cur.avgEngagementSec < 40) out.push({ emoji: "⏱️", tone: "warn", title: "GA4: interacción corta", text: `La duración media (${fmtDuration(ga4.cur.avgEngagementSec)}) es baja. Mejora landing pages, claridad de la oferta y enlaces internos.` });

  if (email?.cur && email.cur.clickRate != null && email.cur.clickRate < 2) out.push({ emoji: "✉️", tone: "warn", title: "Email: clics bajos", text: `La tasa de clic (${fmtPct(email.cur.clickRate)}) está bajo referencia. CTA único y claro, menos enlaces compitiendo y segmentación por necesidad operativa.` });

  if (comp?.rows?.length) {
    const me = comp.rows.find((r) => r.brand.toUpperCase().includes(RED_NAME));
    const others = comp.rows.filter((r) => r !== me && r.er != null);
    const avg = others.length ? others.reduce((a, r) => a + r.er, 0) / others.length : null;
    if (me && avg != null && me.er != null && me.er < avg) out.push({ emoji: "🥊", tone: "warn", title: "Competencia: ER por debajo del set", text: `Más Center tuvo un ER de ${fmtPct(me.er)} vs un promedio de ${fmtPct(Math.round(avg * 100) / 100)} de la competencia. Refuerza dinámicas participativas (concursos, colaboraciones con locatarios) que activan comentarios y guardados.` });
  }

  if (out.length === 0) out.push({ emoji: "✅", tone: "good", title: "Sin alertas relevantes", text: "Las métricas del mes están en rangos sanos. Mantén la consistencia y sigue testeando contenidos, audiencias y keywords." });
  return out;
}

// ---------------- Miniatura de publicación ----------------
function Thumb({ src, alt }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt || ""}
      loading="lazy"
      style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: "1px solid #e4e7ec", flexShrink: 0 }}
    />
  );
}

// ---------------- Editor de LinkedIn (modo edición — manual con gráficos) ----------------
function LinkedinEditor({ source, monthKey, onSave }) {
  const src = source || {};
  const seedM = (src.monthly || {})[monthKey] || {};
  const seedBest = ((src.best || {})[monthKey] || []).map((b) => ({ ...b }));
  while (seedBest.length < 3) seedBest.push({ label: "", date: "", impressions: "", reactions: "", clicks: "", newFollowers: "", image: "" });
  const [followers, setFollowers] = useState((src.followers || {})[monthKey] ?? "");
  const [m, setM] = useState({
    acquired: seedM.acquired ?? "", impressions: seedM.impressions ?? "", views: seedM.views ?? "",
    reactions: seedM.reactions ?? "", engagement: seedM.engagement ?? "",
  });
  const [best, setBest] = useState(seedBest);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const inp = { background: "#f4f5f7", color: "#1a1a1a", border: "1px solid #e4e7ec", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const num = parseNum;
  const updM = (f, v) => setM((o) => ({ ...o, [f]: v }));
  const updB = (i, f, v) => setBest((rs) => rs.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));
  const save = async () => {
    setSaving(true); setOk(false);
    const obj = {
      profileUrl: src.profileUrl || "",
      followers: { ...(src.followers || {}) },
      monthly: { ...(src.monthly || {}) },
      best: { ...(src.best || {}) },
    };
    if (num(followers) != null) obj.followers[monthKey] = num(followers);
    obj.monthly[monthKey] = {
      acquired: num(m.acquired) ?? 0, impressions: num(m.impressions) ?? 0, views: num(m.views) ?? 0,
      reactions: num(m.reactions) ?? 0, engagement: num(m.engagement) ?? 0,
    };
    const cleanBest = best
      .filter((b) => (b.label || "").trim())
      .map((b) => ({ label: b.label.trim(), date: b.date || "", impressions: num(b.impressions) ?? 0, reactions: num(b.reactions) ?? 0, clicks: num(b.clicks) ?? 0, newFollowers: num(b.newFollowers) ?? 0, image: (b.image || "").trim() || undefined }));
    if (cleanBest.length) obj.best[monthKey] = cleanBest; else delete obj.best[monthKey];
    const r = await onSave(obj);
    setSaving(false); setOk(r !== false);
  };
  const field = (label, val, setter, extra) => (
    <label style={{ fontSize: 12, color: "#6b7280" }}>{label}
      <input value={val} onChange={(e) => setter(e.target.value)} style={{ ...inp, marginTop: 4 }} inputMode="numeric" placeholder="—" {...extra} />
    </label>
  );
  return (
    <div className="no-print" style={{ ...panel, marginBottom: 16, borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>✏️ Editar LinkedIn · {monthLabel(monthKey)} <span style={{ color: "#6b7280", fontWeight: 400 }}>(datos desde LinkedIn Analytics; los gráficos se generan solos)</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        {field("Seguidores (total)", followers, setFollowers)}
        {field("Adquiridos (mes)", m.acquired, (v) => updM("acquired", v))}
        {field("Impresiones", m.impressions, (v) => updM("impressions", v))}
        {field("Visualizaciones", m.views, (v) => updM("views", v))}
        {field("Reacciones", m.reactions, (v) => updM("reactions", v))}
        {field("Engagement %", m.engagement, (v) => updM("engagement", v))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>🏆 Mejores publicaciones (hasta 3)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...tableStyle, background: "transparent" }}>
          <thead><tr><th style={th}>Título</th><th style={th}>Fecha</th><th style={th}>Impres.</th><th style={th}>Reacc.</th><th style={th}>Clics</th><th style={th}>Nuevos seg.</th><th style={th}>Imagen (URL)</th></tr></thead>
          <tbody>
            {best.map((b, i) => (
              <tr key={i}>
                <td style={td}><input value={b.label} onChange={(e) => updB(i, "label", e.target.value)} style={inp} placeholder="POST: …" /></td>
                <td style={td}><input value={b.date} onChange={(e) => updB(i, "date", e.target.value)} style={{ ...inp, width: 90 }} placeholder="5 mayo" /></td>
                <td style={td}><input value={b.impressions} onChange={(e) => updB(i, "impressions", e.target.value)} style={{ ...inp, width: 80 }} inputMode="numeric" /></td>
                <td style={td}><input value={b.reactions} onChange={(e) => updB(i, "reactions", e.target.value)} style={{ ...inp, width: 70 }} inputMode="numeric" /></td>
                <td style={td}><input value={b.clicks} onChange={(e) => updB(i, "clicks", e.target.value)} style={{ ...inp, width: 70 }} inputMode="numeric" /></td>
                <td style={td}><input value={b.newFollowers} onChange={(e) => updB(i, "newFollowers", e.target.value)} style={{ ...inp, width: 70 }} inputMode="numeric" /></td>
                <td style={td}><input value={b.image} onChange={(e) => updB(i, "image", e.target.value)} style={{ ...inp, minWidth: 160 }} placeholder="https://…" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button disabled={saving} onClick={save} style={{ ...miniBtn, background: BRAND, color: "#fff", border: "none" }}>{saving ? "Guardando…" : "Guardar LinkedIn"}</button>
        {ok && <span style={{ color: "#16a34a", fontSize: 13 }}>✓ Guardado</span>}
      </div>
    </div>
  );
}

// ---------------- Editor de competencia (modo edición) ----------------
function CompetenciaEditor({ source, monthKey, prevMonthKey, onSave }) {
  const src = source || {};
  const seed = () => {
    const brands = Array.from(new Set([
      ...Object.keys(src[monthKey] || {}),
      ...Object.keys(src[prevMonthKey] || {}),
    ]));
    if (!brands.length) brands.push(RED_NAME);
    return brands.map((b) => ({ brand: b, followers: (src[monthKey] || {})[b]?.followers ?? "", engagement: (src[monthKey] || {})[b]?.engagement ?? "" }));
  };
  const [rows, setRows] = useState(seed);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const upd = (i, f, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));
  const inp = { background: "#f4f5f7", color: "#1a1a1a", border: "1px solid #e4e7ec", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const save = async () => {
    setSaving(true); setOk(false);
    const obj = { ...src };
    const monthObj = {};
    for (const r of rows) {
      const b = (r.brand || "").trim();
      if (!b) continue;
      const entry = {};
      entry.followers = parseNum(r.followers);
      const er = parseNum(r.engagement);
      if (er != null) entry.engagement = er;
      monthObj[b] = entry;
    }
    obj[monthKey] = monthObj;
    const r = await onSave(obj);
    setSaving(false); setOk(r !== false);
  };
  return (
    <div className="no-print" style={{ ...panel, marginBottom: 16, borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>✏️ Editar competencia · {monthLabel(monthKey)} <span style={{ color: "#6b7280", fontWeight: 400 }}>(ER% = (Likes + Comentarios) / Seguidores × 100)</span></div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...tableStyle, background: "transparent" }}>
          <thead><tr><th style={th}>Marca</th><th style={th}>Seguidores</th><th style={th}>ER %</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={td}><input value={r.brand} onChange={(e) => upd(i, "brand", e.target.value)} style={inp} placeholder="Marca" /></td>
                <td style={td}><input value={r.followers} onChange={(e) => upd(i, "followers", e.target.value)} style={inp} inputMode="numeric" placeholder="—" /></td>
                <td style={td}><input value={r.engagement} onChange={(e) => upd(i, "engagement", e.target.value)} style={inp} inputMode="decimal" placeholder="—" /></td>
                <td style={td}><button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} style={{ ...miniBtn, padding: "4px 8px" }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setRows((rs) => [...rs, { brand: "", followers: "", engagement: "" }])} style={miniBtn}>+ Agregar marca</button>
        <button disabled={saving} onClick={save} style={{ ...miniBtn, background: BRAND, color: "#fff", border: "none" }}>{saving ? "Guardando…" : "Guardar competencia"}</button>
        {ok && <span style={{ color: "#16a34a", fontSize: 13 }}>✓ Guardado</span>}
      </div>
    </div>
  );
}

// ---------------- Page ----------------
export default function Page() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);

  // Modo edición + overrides compartidos (servidor).
  const [server, setServer] = useState({ conclusions: {}, competencia: null, linkedin: null, kv: false });
  const [editParam, setEditParam] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editPass, setEditPass] = useState("");
  const [passInput, setPassInput] = useState("");
  const [passMsg, setPassMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch("/api/overrides", { cache: "no-store" });
      const j = await res.json();
      setServer({ conclusions: j.conclusions || {}, competencia: j.competencia || null, linkedin: j.linkedin || null, kv: !!j.kv });
    } catch (_) {}
  }, []);

  useEffect(() => {
    load();
    loadOverrides();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, loadOverrides]);

  // ?edit en la URL activa la barra de modo edición.
  useEffect(() => {
    try { setEditParam(new URLSearchParams(window.location.search).has("edit")); } catch (_) {}
  }, []);

  const unlock = async () => {
    try {
      const res = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check", password: passInput }) });
      const j = await res.json();
      if (res.ok && j.ok) { setEditMode(true); setEditPass(passInput); setPassMsg(""); }
      else setPassMsg(j.error || "Clave incorrecta");
    } catch (e) { setPassMsg(String(e.message || e)); }
  };

  const saveConclusion = useCallback(async (id, text) => {
    const res = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: editPass, type: "conclusion", key: id, value: text }) });
    if (res.ok) setServer((s) => ({ ...s, conclusions: { ...s.conclusions, [id]: text } }));
    else { const j = await res.json().catch(() => ({})); alert("No se pudo guardar: " + (j.error || res.status)); }
  }, [editPass]);

  const resetConclusion = useCallback(async (id) => {
    const res = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: editPass, type: "conclusion", key: id, value: "" }) });
    if (res.ok) setServer((s) => { const c = { ...s.conclusions }; delete c[id]; return { ...s, conclusions: c }; });
  }, [editPass]);

  const saveCompetencia = useCallback(async (obj) => {
    const res = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: editPass, type: "competencia", value: obj }) });
    if (res.ok) { setServer((s) => ({ ...s, competencia: obj })); return true; }
    const j = await res.json().catch(() => ({})); alert("No se pudo guardar: " + (j.error || res.status)); return false;
  }, [editPass]);

  const saveLinkedin = useCallback(async (obj) => {
    const res = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: editPass, type: "linkedin", value: obj }) });
    if (res.ok) { setServer((s) => ({ ...s, linkedin: obj })); return true; }
    const j = await res.json().catch(() => ({})); alert("No se pudo guardar: " + (j.error || res.status)); return false;
  }, [editPass]);

  const editCtxValue = useMemo(() => ({
    kv: server.kv,
    canEdit: editMode,
    getOverride: (id) => server.conclusions?.[id] ?? null,
    save: saveConclusion,
    reset: resetConclusion,
  }), [server.kv, server.conclusions, editMode, saveConclusion, resetConclusion]);

  const months = data?.months || [];
  // Selecciona por defecto el último mes con datos.
  useEffect(() => {
    if (!sel && months.length) setSel(months[months.length - 1]);
  }, [months, sel]);

  const prevKey = useMemo(() => {
    const i = months.indexOf(sel);
    return i > 0 ? months[i - 1] : null;
  }, [months, sel]);

  // --- Instagram ---
  const ig = useMemo(() => {
    const m = data?.instagram;
    if (!m) return null;
    const monthly = m.monthly || [];
    const fMap = followersByMonth(monthly, m.followers ?? null, "newFollowers");
    const cur = monthly.find((x) => x.key === sel) || null;
    const prev = monthly.find((x) => x.key === prevKey) || null;
    return { followers: fMap[sel] ?? m.followers, fPrev: fMap[prevKey] ?? null, username: m.username, cur, prev, best: m.bestByMonth?.[sel] || [], series: monthly };
  }, [data, sel, prevKey]);

  // --- Facebook ---
  const fb = useMemo(() => {
    const m = data?.facebook;
    if (!m) return null;
    const monthly = m.monthly || [];
    const fMap = followersByMonth(monthly, m.followers ?? null, "fanAdds");
    const cur = monthly.find((x) => x.key === sel) || null;
    const prev = monthly.find((x) => x.key === prevKey) || null;
    return { followers: fMap[sel] ?? m.followers, fPrev: fMap[prevKey] ?? null, name: m.name, cur, prev, best: m.bestByMonth?.[sel] || [], series: monthly };
  }, [data, sel, prevKey]);

  // --- Meta Ads ---
  const ads = useMemo(() => {
    const m = data?.ads;
    if (!m) return null;
    const cur = m.monthly?.find((x) => x.key === sel) || null;
    const prev = m.monthly?.find((x) => x.key === prevKey) || null;
    return { currency: m.currency, cur, prev, series: m.monthly || [] };
  }, [data, sel, prevKey]);

  // --- Google Ads ---
  const gads = useMemo(() => {
    const m = data?.googleAds;
    if (!m) return null;
    const cur = m.monthly?.find((x) => x.key === sel) || null;
    const prev = m.monthly?.find((x) => x.key === prevKey) || null;
    return {
      currency: m.currency,
      cur,
      prev,
      series: m.monthly || [],
      keywords: m.keywordsByMonth?.[sel] || [],
      campaigns: m.campaignsByMonth?.[sel] || [],
    };
  }, [data, sel, prevKey]);

  // --- GA4 ---
  const ga4 = useMemo(() => {
    const m = data?.ga4;
    if (!m) return null;
    const cur = m.monthly?.find((x) => x.key === sel) || null;
    const prev = m.monthly?.find((x) => x.key === prevKey) || null;
    return { cur, prev, series: m.monthly || [], channels: m.channelsByMonth?.[sel] || [], pages: m.pagesByMonth?.[sel] || [] };
  }, [data, sel, prevKey]);

  // --- LinkedIn (API en vivo, o manual editado por el CM con prioridad, o ejemplo sembrado) ---
  const li = useMemo(() => {
    const api = data?.linkedin;
    const man = server.linkedin || data?.manual?.linkedin;
    if (!api && !man) return null;
    const monthlyOf = (k) => api?.monthly?.[k] || man?.monthly?.[k] || null;
    const cur = monthlyOf(sel);
    const prev = monthlyOf(prevKey);
    const manMap = man?.followers || {};
    // Reconstrucción del total por mes: total actual − adquiridos de meses posteriores.
    const latestKey = months[months.length - 1];
    const currentTotal = api?.followersTotal ?? manMap[latestKey] ?? null;
    const fMap = {};
    let running = currentTotal;
    for (let i = months.length - 1; i >= 0; i--) {
      const k = months[i];
      fMap[k] = running ?? manMap[k] ?? null;
      if (running != null) running -= (monthlyOf(k)?.acquired || 0);
    }
    const followers = fMap[sel];
    const fPrev = fMap[prevKey] ?? null;
    const best = (api?.bestByMonth?.[sel]?.length ? api.bestByMonth[sel] : man?.best?.[sel]) || [];
    const series = months.map((k) => ({ key: k, ...(monthlyOf(k) || {}), followers: fMap[k] ?? null }));
    return { cur, prev, followers, fPrev, best, series, hasMonth: !!cur, connected: !!api };
  }, [data, server.linkedin, sel, prevKey, months]);

  // --- Competencia (editable; servidor tiene prioridad sobre el seed manual) ---
  const compSource = server.competencia || data?.manual?.competencia || null;
  const comp = useMemo(() => {
    const m = compSource;
    if (!m) return null;
    return {
      source: m,
      rows: competenciaRows(m, sel, prevKey),
      hasMonth: !!m[sel],
    };
  }, [compSource, sel, prevKey]);

  // --- Email (agregado por mes desde campañas) ---
  const emailAgg = useMemo(() => {
    const camps = data?.email?.campaigns || [];
    if (!camps.length) return null;
    const byMonth = {};
    for (const c of camps) {
      if (!c.monthKey) continue;
      const b = (byMonth[c.monthKey] = byMonth[c.monthKey] || { delivered: 0, opens: 0, clicks: 0, sent: 0, list: [] });
      b.delivered += c.delivered; b.opens += c.opens; b.clicks += c.clicks; b.sent += c.sent; b.list.push(c);
    }
    const agg = (b) => b ? {
      ...b,
      openRate: b.delivered ? Math.round((b.opens / b.delivered) * 1000) / 10 : 0,
      clickRate: b.delivered ? Math.round((b.clicks / b.delivered) * 1000) / 10 : 0,
      ctor: b.opens ? Math.round((b.clicks / b.opens) * 1000) / 10 : 0,
    } : null;
    const cur = agg(byMonth[sel]);
    const prev = agg(byMonth[prevKey]);
    const best = cur?.list?.length ? [...cur.list].filter((c) => c.delivered >= 10).sort((a, b) => b.openRate - a.openRate)[0] : null;
    const series = months.map((k) => ({ key: k, ...(agg(byMonth[k]) || { openRate: 0, ctor: 0 }) }));
    return { cur, prev, best, series, all: byMonth };
  }, [data, sel, prevKey, months]);

  // --- WhatsApp (agregado por mes desde campañas) ---
  const waAgg = useMemo(() => {
    const camps = data?.whatsapp?.campaigns || [];
    if (!camps.length) return null;
    const byMonth = {};
    for (const c of camps) {
      if (!c.monthKey) continue;
      const b = (byMonth[c.monthKey] = byMonth[c.monthKey] || { sent: 0, delivered: 0, read: 0, clicks: 0, errors: 0, list: [] });
      b.sent += c.sent; b.delivered += c.delivered; b.read += c.read; b.clicks += c.clicks; b.errors += c.errors; b.list.push(c);
    }
    const agg = (b) => b ? {
      ...b,
      deliveryRate: b.sent ? Math.round((b.delivered / b.sent) * 1000) / 10 : 0,
      readRate: b.delivered ? Math.round((b.read / b.delivered) * 1000) / 10 : 0,
    } : null;
    const cur = agg(byMonth[sel]);
    const prev = agg(byMonth[prevKey]);
    const best = cur?.list?.length ? [...cur.list].sort((a, b) => b.readRate - a.readRate)[0] : null;
    const series = months.map((k) => ({ key: k, ...(agg(byMonth[k]) || { readRate: 0, deliveryRate: 0 }) }));
    return { cur, prev, best, series };
  }, [data, sel, prevKey, months]);

  const exec = useMemo(() => (sel ? execSummary(sel, ig, fb, ads, gads, ga4, li, emailAgg, waAgg) : []), [sel, ig, fb, ads, gads, ga4, li, emailAgg, waAgg]);
  const waSeries = (waAgg?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], "Entrega": x.deliveryRate, "Leído": x.readRate }));
  const plan = useMemo(() => (sel ? buildPlan(sel, ads, gads, ga4, ig, fb, emailAgg) : []), [sel, ads, gads, ga4, ig, fb, emailAgg]);
  const improvements = useMemo(() => (sel ? buildImprovements(sel, ig, fb, ads, gads, ga4, li, emailAgg, comp) : []), [sel, ig, fb, ads, gads, ga4, li, emailAgg, comp]);
  const liSeries = (li?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], Impresiones: x.impressions || 0, Reacciones: x.reactions || 0, Seguidores: x.followers ?? null }));

  // Series para gráficos de evolución (todos los meses, ascendente).
  const igSeries = (ig?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], Alcance: x.reach, Interacciones: x.interactions }));
  const fbSeries = (fb?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], Visualizaciones: x.impressions, Interacciones: x.engagement }));
  const adsSeries = (ads?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], "Visitas LP": x.landingViews || 0, Leads: x.leads || 0, Inversión: x.spend || 0 }));
  const emailSeries = (emailAgg?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], "Open Rate": x.openRate, CTOR: x.ctor }));
  const gadsSeries = (gads?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], Conversiones: x.conversions, "Costo/conv.": x.costPerConv }));
  const ga4Series = (ga4?.series || []).map((x) => ({ name: monthLabel(x.key).split(" ")[0], Usuarios: x.activeUsers, "Eventos clave": x.keyEvents }));

  const selStyle = { background: "#f4f5f7", color: "#1a1a1a", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 12px", fontSize: 14 };

  return (
   <EditCtx.Provider value={editCtxValue}>
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ height: 5, background: `linear-gradient(90deg, ${BRAND}, ${BRAND_DARK})`, borderRadius: 6, marginBottom: 18 }} />

      {/* BARRA DE MODO EDICIÓN (solo con ?edit en la URL) */}
      {editParam && (
        <div className="no-print" style={{ ...panel, marginBottom: 16, borderLeft: `3px solid ${BRAND}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {editMode ? (
            <>
              <span style={{ fontWeight: 700, color: BRAND }}>🔓 Modo edición activo</span>
              <span style={{ color: "#6b7280", fontSize: 13 }}>Edita conclusiones y competencia; el cliente verá la versión guardada.{!server.kv ? " ⚠️ Falta crear el store Blob en Vercel: por ahora se guarda solo en este navegador." : ""}</span>
              <button onClick={() => setEditMode(false)} style={{ ...miniBtn, marginLeft: "auto" }}>Salir de edición</button>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 700 }}>🔒 Modo edición</span>
              <input type="password" value={passInput} placeholder="Clave" onChange={(e) => setPassInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} style={{ ...selStyle, padding: "7px 10px" }} />
              <button onClick={unlock} style={{ ...miniBtn, background: BRAND, color: "#fff", border: "none" }}>Entrar</button>
              {passMsg && <span style={{ color: "#b42318", fontSize: 13 }}>{passMsg}</span>}
            </>
          )}
        </div>
      )}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            role="img"
            aria-label="Más Center · Grupo IFB"
            style={{
              height: 56,
              width: 113,
              background: BRAND,
              WebkitMaskImage: "url(/logo-mascenter.png)",
              maskImage: "url(/logo-mascenter.png)",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "left center",
              maskPosition: "left center",
            }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: 25, color: "#111" }}>
              <span style={{ color: BRAND }}>Más Center</span> · Informe de Redes
            </h1>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
              {loading ? "Cargando…" : data?.updatedAt ? `Actualizado: ${new Date(data.updatedAt).toLocaleString("es-CL")}${data?.stale ? " · última copia disponible" : ""}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {months.length > 0 && (
              <select value={sel || ""} onChange={(e) => setSel(e.target.value)} style={selStyle}>
                {[...months].reverse().map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
              </select>
            )}
            <button onClick={() => window.print()} style={{ background: "#f4f5f7", color: "#1a1a1a", border: "1px solid #e4e7ec", borderRadius: 10, padding: "9px 14px", cursor: "pointer", fontSize: 14 }}>🖨️ Exportar PDF</button>
            <button onClick={load} style={{ background: BRAND, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 14 }}>Actualizar</button>
          </div>
          <img src="/logo-copylab.png" alt="Grupo CopyLab" title="Grupo CopyLab LATAM" style={{ height: 58, objectFit: "contain", filter: "brightness(0)" }} />
        </div>
      </header>

      {error && <div style={{ marginTop: 20, background: "#fdecef", border: "1px solid #f5c2cc", color: "#b42318", padding: "12px 16px", borderRadius: 12 }}>{error}</div>}

      {/* CÓMO LEER ESTE INFORME — Automático vs Manual */}
      <details className="no-print" style={{ ...panel, marginTop: 20, padding: 0 }}>
        <summary style={{ listStyle: "none", cursor: "pointer", padding: "14px 16px", fontWeight: 600, fontSize: 14 }}>
          📋 Cómo leer este informe — <span style={{ color: "#16a34a" }}>Automático</span> vs <span style={{ color: "#d97706" }}>Manual</span>
        </summary>
        <div style={{ padding: "0 16px 16px", fontSize: 13.5, lineHeight: 1.5, color: "#374151" }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#16a34a", fontWeight: 600, marginBottom: 4 }}>✅ AUTOMÁTICO — no necesitas tocar</div>
            KPIs del mes y comparativas vs. mes anterior · gráficos de tendencia · Instagram orgánico · Meta Ads por objetivo (Tráfico/Formularios/Mensajes) y por sucursal · GA4 con fuentes de tráfico y páginas más vistas · LinkedIn de Grupo IFB · conclusiones redactadas por canal · <b>Plan del próximo mes</b> con acciones priorizadas.
          </div>
          <div>
            <div style={{ color: "#d97706", fontWeight: 600, marginBottom: 4 }}>⚠️ MANUAL — revisar antes de enviar al cliente</div>
Actualizar a inicio de mes: <b>Competencia</b> (ER% de cada cuenta) en modo edición · leer las conclusiones IA y corregir si algo suena impreciso · validar el Plan del próximo mes según contexto del cliente (lanzamientos, eventos, cambios de mando que la IA no conoce) · exportar a PDF si el cliente pide formato formal.
          </div>
        </div>
      </details>

      {/* RESUMEN EJECUTIVO */}
      {exec.length > 0 && (
        <Section title={`🧠 Resumen ejecutivo · ${monthLabel(sel)}`} subtitle="Lo más destacado del mes, por canal">
          <div style={grid(280)}>
            {exec.map((it, i) => (
              <div key={i} style={{ ...panel, borderLeft: `4px solid ${BRAND}` }}>
                <div style={{ fontSize: 14.5, lineHeight: 1.45, color: "#1a1a1a" }}><span style={{ marginRight: 6 }}>{it.emoji}</span>{it.t}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* INSTAGRAM */}
      <Section title="📸 Instagram (orgánico)" subtitle={ig?.username ? `@${ig.username}` : undefined}>
        {data?.errors?.instagram && <div style={{ color: "#b45309", fontSize: 13, marginBottom: 10 }}>Instagram: {data.errors.instagram}</div>}
        {ig?.cur ? (
          <>
            <div style={grid(150)}>
              <Card label="Seguidores" value={fmt(ig.followers)} accent="#7c3aed" change={delta(ig.followers, ig.fPrev)} />
              <Card label="Nuevos seguidores" value={fmt(ig.cur.newFollowers)} change={delta(ig.cur.newFollowers, ig.prev?.newFollowers)} />
              <Card label="Posts" value={fmt(ig.cur.posts)} change={delta(ig.cur.posts, ig.prev?.posts)} />
              <Card label="Alcance" value={fmt(ig.cur.reach)} accent="#2563eb" change={delta(ig.cur.reach, ig.prev?.reach)} />
              <Card label="Visualizaciones" value={fmt(ig.cur.views)} change={delta(ig.cur.views, ig.prev?.views)} />
              <Card label="Interacciones" value={fmt(ig.cur.interactions)} change={delta(ig.cur.interactions, ig.prev?.interactions)} />
              <Card label="Visitas al perfil" value={fmt(ig.cur.profileViews)} accent="#16a34a" change={delta(ig.cur.profileViews, ig.prev?.profileViews)} />
              <Card label="Engagement" value={fmtPct(ig.cur.engagement)} change={delta(ig.cur.engagement, ig.prev?.engagement)} />
            </div>
            {igSeries.length > 1 && (
              <div style={{ ...grid(320), marginTop: 16 }}>
                <ChartBox title="Evolución de alcance">
                  <LineChart data={igSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Legend />
                    <Line type="monotone" dataKey="Alcance" stroke="#E52522" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartBox>
                <ChartBox title="Evolución de interacciones">
                  <BarChart data={igSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                    <Bar dataKey="Interacciones" fill="#E52522" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartBox>
              </div>
            )}
            {ig.best?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🏆 Mejores publicaciones del mes (por alcance)</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead><tr><th style={th}>#</th><th style={th}>Publicación</th><th style={th}>Tipo</th><th style={th}>Fecha</th><th style={th}>Alcance</th><th style={th}>Likes</th><th style={th}>Coment.</th></tr></thead>
                    <tbody>
                      {ig.best.map((p, i) => (
                        <tr key={p.id}>
                          <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{i + 1}</td>
                          <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Thumb src={p.thumb} alt={p.caption} /><a href={p.permalink} target="_blank" rel="noreferrer" style={{ color: "#374151" }}>{p.caption || "(sin texto)"}</a></div></td>
                          <td style={td}>{p.type}</td>
                          <td style={td}>{fmtDate(p.date)}</td>
                          <td style={{ ...td, color: "#2563eb", fontWeight: 600 }}>{fmt(p.reach)}</td>
                          <td style={td}>{fmt(p.likes)}</td>
                          <td style={td}>{fmt(p.comments)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Conclusion id={`ig-${sel}`} text={igConclusion(sel, ig.cur, ig.prev, ig.followers)} />
          </>
        ) : !data?.errors?.instagram && <div style={{ color: "#6b7280", fontSize: 13 }}>Sin datos de Instagram para {monthLabel(sel)}.</div>}
      </Section>

      {/* LINKEDIN (API en vivo, o manual editado por el CM) */}
      {li && (
        <Section title={<span>💼 LinkedIn (Grupo IFB) <span style={li.connected ? autoBadge : chromeBadge}>{li.connected ? "AUTO · API" : (server.linkedin ? "MANUAL" : "DATOS DE EJEMPLO")} {editMode && !li.connected && <span style={chromeBadge}>EDITABLE</span>}</span></span>} subtitle={li.connected ? "Conectado por la API de LinkedIn (en vivo)." : "Datos cargados a mano por el CM (LinkedIn Analytics); los gráficos se generan solos."}>
          {data?.errors?.linkedin && <div style={{ color: "#b45309", fontSize: 13, marginBottom: 10 }}>LinkedIn: {data.errors.linkedin}</div>}
          {editMode && !li.connected && (
            <LinkedinEditor source={server.linkedin || data?.manual?.linkedin} monthKey={sel} onSave={saveLinkedin} />
          )}
          {!li.connected && !editMode && !server.linkedin && (
            <div style={{ ...alertBox, marginBottom: 12 }}>ℹ️ Datos de ejemplo. Carga los números del mes a mano en modo edición (<code>?edit</code>), o conecta la API con <code>LINKEDIN_ACCESS_TOKEN</code>.</div>
          )}
          {!li.hasMonth ? (
            <div style={alertBox}>⚠️ Sin datos de LinkedIn para {monthLabel(sel)} todavía.{editMode ? " Llena los campos de arriba y guarda." : ""}</div>
          ) : (
            <>
              <div style={grid(150)}>
                <Card label="Seguidores" value={fmt(li.followers)} accent="#7c3aed" change={delta(li.followers, li.fPrev)} />
                <Card label="Adquiridos" value={fmt(li.cur.acquired)} change={delta(li.cur.acquired, li.prev?.acquired)} />
                <Card label="Impresiones" value={fmt(li.cur.impressions)} accent="#2563eb" change={delta(li.cur.impressions, li.prev?.impressions)} />
                <Card label="Visualizaciones" value={fmt(li.cur.views)} change={delta(li.cur.views, li.prev?.views)} />
                <Card label="Reacciones" value={fmt(li.cur.reactions)} accent="#16a34a" change={delta(li.cur.reactions, li.prev?.reactions)} />
                <Card label="Engagement" value={fmtPct(li.cur.engagement)} change={delta(li.cur.engagement, li.prev?.engagement)} />
              </div>
              {liSeries.length > 1 && (
                <div style={{ ...grid(320), marginTop: 16 }}>
                  <ChartBox title="Evolución de impresiones">
                    <LineChart data={liSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                      <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Legend />
                      <Line type="monotone" dataKey="Impresiones" stroke="#E52522" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartBox>
                  <ChartBox title="Evolución de seguidores">
                    <LineChart data={liSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                      <XAxis dataKey="name" {...axis} /><YAxis {...axis} domain={["auto", "auto"]} /><Tooltip {...tip} />
                      <Line type="monotone" dataKey="Seguidores" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ChartBox>
                </div>
              )}
              {li.best?.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🏆 Mejores publicaciones del mes (por impresiones)</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead><tr><th style={th}>#</th><th style={th}>Publicación</th><th style={th}>Fecha</th><th style={th}>Impresiones</th><th style={th}>Reacciones</th><th style={th}>Clics</th><th style={th}>Nuevos seg.</th></tr></thead>
                      <tbody>
                        {li.best.map((p, i) => (
                          <tr key={i}>
                            <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{i + 1}</td>
                            <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Thumb src={p.image} alt={p.label} />{p.label}</div></td>
                            <td style={td}>{p.date}</td>
                            <td style={{ ...td, color: "#2563eb", fontWeight: 600 }}>{fmt(p.impressions)}</td>
                            <td style={td}>{fmt(p.reactions)}</td>
                            <td style={td}>{fmt(p.clicks)}</td>
                            <td style={td}>{fmt(p.newFollowers)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <Conclusion id={`li-${sel}`} text={linkedinConclusion(sel, li.cur, li.prev, li.followers, li.fPrev, li.best)} />
            </>
          )}
        </Section>
      )}

      {/* COMPETENCIA (editable por el CM; ER% Instagram) */}
      <Section title={<span>🥊 Competencia {editMode && <span style={chromeBadge}>EDITABLE</span>}</span>} subtitle="Engagement (ER%) de Más Center vs. la competencia en Instagram.">
        {editMode && (
          <CompetenciaEditor source={compSource} monthKey={sel} prevMonthKey={prevKey} onSave={saveCompetencia} />
        )}
        {!comp?.hasMonth ? (
          <div style={alertBox}>⚠️ Aún sin datos de competencia para {monthLabel(sel)}.{editMode ? " Llena la tabla de arriba y guarda." : " Se cargan en modo edición."}</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead><tr><th style={th}>Marca</th><th style={th}>Seguidores</th><th style={th}>ER% {monthName(sel)}</th></tr></thead>
                <tbody>
                  {comp.rows.map((r) => {
                    const mine = r.brand.toUpperCase().includes(RED_NAME);
                    return (
                      <tr key={r.brand} style={mine ? { background: "rgba(229,37,34,0.10)" } : undefined}>
                        <td style={{ ...td, fontWeight: mine ? 700 : 400, color: mine ? BRAND : "#1a1a1a" }}>{r.brand}</td>
                        <td style={td}>{fmt(r.followers)}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.er == null ? "—" : fmtPct(r.er)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Conclusion id={`comp-${sel}`} text={competenciaConclusion(comp.rows)} />
            <div style={{ color: "#9aa3af", fontSize: 12, marginTop: 14, fontStyle: "italic" }}>
              Fórmula ER: (Likes + Comentarios) / Seguidores × 100 · rango esperado 1–5%. Al no contar con las cifras exactas de seguidores e interacciones de la competencia, sus resultados son aproximados.
            </div>
          </>
        )}
      </Section>

      {/* META ADS (PAID) */}
      <Section title="🎯 Meta Ads (paid)" subtitle="Inversión por objetivo: Tráfico (visitas a la web), Formularios (leads) y Mensajes (conversaciones)">
        {data?.errors?.ads && <div style={{ color: "#b45309", fontSize: 13, marginBottom: 10 }}>Meta Ads: {data.errors.ads}</div>}
        {ads?.cur ? (
          <>
            <div style={grid(150)}>
              <Card label="Inversión total" value={fmtMoney(ads.cur.spend)} accent="#d97706" change={delta(ads.cur.spend, ads.prev?.spend)} />
              <Card label="Visitas a la web (LP)" value={fmt(ads.cur.landingViews)} accent="#2563eb" change={delta(ads.cur.landingViews, ads.prev?.landingViews)} />
              <Card label="Leads (formularios)" value={fmt(ads.cur.leads)} accent="#16a34a" change={delta(ads.cur.leads, ads.prev?.leads)} />
              <Card label="Costo / lead" value={fmtMoney(ads.cur.costPerLead)} change={delta(ads.cur.costPerLead, ads.prev?.costPerLead)} />
              <Card label="Conversaciones" value={fmt(ads.cur.conversations)} change={delta(ads.cur.conversations, ads.prev?.conversations)} />
              <Card label="Alcance" value={fmt(ads.cur.reach)} accent="#7c3aed" change={delta(ads.cur.reach, ads.prev?.reach)} />
            </div>

            {/* Bloques por objetivo */}
            {ads.cur.byObjective && (
              <div style={{ ...grid(260), marginTop: 16 }}>
                {[
                  { key: "trafico", label: "🌐 Tráfico", metric: "landingViews", metricLabel: "Visitas a LP", crLabel: "Costo / visita" },
                  { key: "formularios", label: "📝 Formularios", metric: "leads", metricLabel: "Leads", crLabel: "Costo / lead" },
                  { key: "mensajes", label: "💬 Mensajes", metric: "conversations", metricLabel: "Conversaciones", crLabel: "Costo / conv." },
                ].map((o) => {
                  const b = ads.cur.byObjective[o.key];
                  if (!b) return null;
                  return (
                    <div key={o.key} style={{ ...panel, borderTop: `3px solid ${BRAND}` }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{o.label}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: "#6b7280" }}><span>Inversión</span><b style={{ color: "#1a1a1a" }}>{fmtMoney(b.spend)}</b></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: "#6b7280" }}><span>{o.metricLabel}</span><b style={{ color: BRAND }}>{fmt(b[o.metric])}</b></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: "#6b7280" }}><span>{o.crLabel}</span><b style={{ color: "#1a1a1a" }}>{fmtMoney(b.costPerResult)}</b></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: "#6b7280" }}><span>Campañas</span><b style={{ color: "#1a1a1a" }}>{fmt(b.campaigns.length)}</b></div>
                    </div>
                  );
                })}
              </div>
            )}

            {adsSeries.length > 1 && (
              <div style={{ ...grid(320), marginTop: 16 }}>
                <ChartBox title="Visitas a la web (LP) por mes">
                  <BarChart data={adsSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                    <Bar dataKey="Visitas LP" fill="#E52522" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartBox>
                <ChartBox title="Leads por mes">
                  <BarChart data={adsSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                    <Bar dataKey="Leads" fill="#334155" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartBox>
              </div>
            )}
            {ads.cur.campaigns?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>📍 Resultados por campaña / sucursal · {monthLabel(sel)}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead><tr><th style={th}>Campaña</th><th style={th}>Objetivo</th><th style={th}>Inversión</th><th style={th}>Resultado</th><th style={th}>Costo/result.</th><th style={th}>Alcance</th><th style={th}>CTR</th></tr></thead>
                    <tbody>
                      {ads.cur.campaigns.map((c) => (
                        <tr key={c.id}>
                          <td style={td}>{c.name}</td>
                          <td style={{ ...td, textTransform: "capitalize" }}>{c.bucket === "otros" ? "—" : c.bucket}</td>
                          <td style={td}>{fmtMoney(c.spend)}</td>
                          <td style={{ ...td, color: "#16a34a", fontWeight: 600 }}>{fmt(c.result)}</td>
                          <td style={td}>{fmtMoney(c.costPerResult)}</td>
                          <td style={td}>{fmt(c.reach)}</td>
                          <td style={td}>{fmtPct(c.ctr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ color: "#9aa3af", fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                  "Resultado" = visitas a la web (Tráfico), leads (Formularios) o conversaciones (Mensajes), según el objetivo de cada campaña.
                </div>
              </div>
            )}
            <Conclusion id={`ads-${sel}`} text={adsConclusion(sel, ads.cur, ads.prev, ads.currency)} />
          </>
        ) : !data?.errors?.ads && <div style={{ color: "#6b7280", fontSize: 13 }}>Sin datos de Meta Ads para {monthLabel(sel)}.</div>}
      </Section>

      {/* GA4 */}
      <Section title="📊 Google Analytics (GA4)" subtitle="Rendimiento del sitio y fuentes de tráfico">
        {data?.errors?.ga4 && <div style={{ color: "#b45309", fontSize: 13, marginBottom: 10 }}>GA4: {data.errors.ga4}</div>}
        {ga4?.cur ? (
          <>
            <div style={grid(150)}>
              <Card label="Usuarios activos" value={fmt(ga4.cur.activeUsers)} accent="#7c3aed" change={delta(ga4.cur.activeUsers, ga4.prev?.activeUsers)} />
              <Card label="Sesiones" value={fmt(ga4.cur.sessions)} change={delta(ga4.cur.sessions, ga4.prev?.sessions)} />
              <Card label="Vistas" value={fmt(ga4.cur.views)} change={delta(ga4.cur.views, ga4.prev?.views)} />
              <Card label="Eventos clave" value={fmt(ga4.cur.keyEvents)} accent="#16a34a" change={delta(ga4.cur.keyEvents, ga4.prev?.keyEvents)} />
              <Card label="Eventos totales" value={fmt(ga4.cur.events)} change={delta(ga4.cur.events, ga4.prev?.events)} />
              <Card label="Duración media" value={fmtDuration(ga4.cur.avgEngagementSec)} change={delta(ga4.cur.avgEngagementSec, ga4.prev?.avgEngagementSec)} />
            </div>
            {ga4Series.length > 1 && (
              <div style={{ ...grid(320), marginTop: 16 }}>
                <ChartBox title="Usuarios activos por mes">
                  <LineChart data={ga4Series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Legend />
                    <Line type="monotone" dataKey="Usuarios" stroke="#E52522" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartBox>
                <ChartBox title="Eventos clave por mes">
                  <BarChart data={ga4Series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
                    <XAxis dataKey="name" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                    <Bar dataKey="Eventos clave" fill="#E52522" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartBox>
              </div>
            )}
            {ga4.channels?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🌐 Fuentes de tráfico · {monthLabel(sel)}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead><tr><th style={th}>Canal</th><th style={th}>Sesiones</th><th style={th}>Eventos clave</th><th style={th}>% conv.</th></tr></thead>
                    <tbody>
                      {ga4.channels.map((c, i) => (
                        <tr key={i}>
                          <td style={td}>{c.channel}</td>
                          <td style={td}>{fmt(c.sessions)}</td>
                          <td style={{ ...td, color: "#16a34a", fontWeight: 600 }}>{fmt(c.keyEvents)}</td>
                          <td style={td}>{fmtPct(c.sessions ? Math.round((c.keyEvents / c.sessions) * 1000) / 10 : 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {ga4.pages?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>📄 Páginas más vistas · {monthLabel(sel)}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead><tr><th style={th}>#</th><th style={th}>Página</th><th style={th}>Vistas</th><th style={th}>% del total</th></tr></thead>
                    <tbody>
                      {ga4.pages.map((p, i) => (
                        <tr key={i}>
                          <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{i + 1}</td>
                          <td style={td}>{p.title}</td>
                          <td style={{ ...td, color: "#2563eb", fontWeight: 600 }}>{fmt(p.views)}</td>
                          <td style={td}>{fmtPct(p.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Conclusion id={`ga4-${sel}`} text={ga4Conclusion(sel, ga4.cur, ga4.prev, ga4.channels?.[0])} />
          </>
        ) : !data?.errors?.ga4 && <div style={{ color: "#6b7280", fontSize: 13 }}>Sin datos de GA4 para {monthLabel(sel)}.</div>}
      </Section>

      {/* PUNTOS DE MEJORA (solo interno / modo edición) */}
      {editMode && improvements.length > 0 && (
        <Section title="🛠️ Puntos de mejora (interno)" subtitle="Solo visible en modo edición — no se muestra al cliente">
          <div style={grid(300)}>
            {improvements.map((it, i) => (
              <div key={i} style={{ ...panel, borderLeft: `3px solid ${toneColor[it.tone] || "#d97706"}` }}>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
                  <span style={{ marginRight: 6 }}>{it.emoji}</span>{it.title}
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>{it.text}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* PLAN DEL PRÓXIMO MES (predictivo) */}
      {plan.length > 0 && (
        <Section title="🔮 Plan del próximo mes" subtitle="Acciones priorizadas y sugerencias automáticas según los datos del mes — valida según el contexto del cliente">
          <div style={grid(300)}>
            {plan.map((it, i) => (
              <div key={i} style={{ ...panel, borderLeft: `3px solid ${toneColor[it.tone] || "#2563eb"}` }}>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
                  <span style={{ marginRight: 6 }}>{it.emoji}</span>{it.title}
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>{it.text}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <footer style={{ marginTop: 50, color: "#9aa3af", fontSize: 12, textAlign: "center" }}>
        Datos vía Meta Graph API (Instagram, Meta Ads), GA4 y LinkedIn · Competencia (ER) manual · Más Center / Grupo IFB · Copywriters
      </footer>
    </main>
   </EditCtx.Provider>
  );
}
