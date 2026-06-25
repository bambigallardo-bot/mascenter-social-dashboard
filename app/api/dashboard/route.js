import { getMetaDashboard } from "../../../lib/meta";
import { getGA4 } from "../../../lib/ga4";
import { getLinkedin } from "../../../lib/linkedin";
import manual from "../../../data/manual.json";

// Más tiempo de ejecución (muchas APIs externas). Hobby admite hasta 60s.
export const maxDuration = 60;

// Devuelve los últimos N meses (incluido el actual) como { key, since, until }.
function lastMonths(n) {
  const out = [];
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const p = (x) => String(x).padStart(2, "0");
  const ymd = (d) => `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(y, m - i, 1));
    const end = new Date(Date.UTC(y, m - i + 1, 1));
    out.push({ key: `${start.getUTCFullYear()}-${p(start.getUTCMonth() + 1)}`, since: ymd(start), until: ymd(end) });
  }
  return out;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Caché en memoria para no golpear las APIs en cada visita.
let _cache = { at: 0, data: null };
const CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS || 600000); // 10 min

export async function GET() {
  const now = Date.now();
  if (_cache.data && now - _cache.at < CACHE_MS) {
    return Response.json(_cache.data, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const months = lastMonths(Number(process.env.SOCIAL_MONTHS || 12));

    const settle = async (fn) => {
      try { return { value: await fn() }; }
      catch (e) { return { error: String(e && e.message ? e.message : e) }; }
    };

    // En paralelo: cada fuente pega a una API distinta, así el tiempo total = la más lenta.
    const [meta, ga4, linkedin] = await Promise.all([
      getMetaDashboard(),
      settle(() => getGA4(months)),
      settle(() => getLinkedin(months)),
    ]);

    const result = {
      updatedAt: new Date().toISOString(),
      months: meta.months,
      instagram: meta.instagram,
      facebook: meta.facebook,
      ads: meta.ads,
      ga4: ga4.value || null,
      linkedin: linkedin.value || null,
      manual: manual || null,
      errors: {
        ...meta.errors,
        ga4: ga4.error || null,
        linkedin: linkedin.error || null,
      },
    };

    // Solo cachea si al menos una fuente vino bien (no cachear fallos totales/transitorios).
    const anyOk = meta.instagram || meta.facebook || meta.ads || result.ga4 || result.linkedin;
    if (anyOk) {
      _cache = { at: Date.now(), data: result };
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (_cache.data) {
      return Response.json({ ..._cache.data, stale: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (_cache.data) {
      return Response.json({ ..._cache.data, stale: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      { error: String(err && err.message ? err.message : err) },
      { status: 500 }
    );
  }
}
