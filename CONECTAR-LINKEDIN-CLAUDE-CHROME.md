# Conectar LinkedIn (Grupo IFB) con Claude para Chrome

El dashboard de Más Center trae LinkedIn **automático por API** (`lib/linkedin.js`). Necesita 2 datos en Vercel:

- `LINKEDIN_ORG_ID` → **ya resuelto: `69230307`** (Grupo IFB, de `linkedin.com/company/grupoifb`). No hay que buscarlo.
- `LINKEDIN_ACCESS_TOKEN` → **esto es lo único que falta.** Deja que **Claude para Chrome** lo genere por ti.

Abre Chrome con la extensión de Claude, logueada con la cuenta que **administra la página de Grupo IFB**, y **pega este prompt**:

---

## PROMPT — Obtener SOLO el token (pégalo a Claude para Chrome)

```
Necesito conectar la página de empresa de GRUPO IFB en LinkedIn (org id 69230307,
linkedin.com/company/grupoifb) a un dashboard propio vía la Community Management API.
Soy admin de la página. Ayúdame paso a paso EN EL NAVEGADOR y, al final, entrégame
el ACCESS TOKEN en un bloque para copiar.

Haz esto:
1. Abre https://www.linkedin.com/developers/apps y crea una app nueva (o usa una
   existente). Asóciala a la PÁGINA DE EMPRESA de Grupo IFB y completa logo/privacy
   URL si los pide.
2. En la pestaña "Products" de la app, solicita/activa "Community Management API"
   (acceso self-serve para administradores de la propia página).
3. En la pestaña "Auth", usa el "OAuth 2.0 token generator" / "Token Inspector"
   para generar un ACCESS TOKEN de USUARIO con estos scopes marcados:
   r_organization_social y rw_organization_admin. Autorízate como admin de Grupo IFB.
   Copia el access token completo.
4. Devuélveme exactamente:

LINKEDIN_ACCESS_TOKEN=<el token>

Si algún paso te pide permisos que yo deba aprobar (login, 2FA, aceptar términos),
detente y dime qué hacer. No inventes valores: si no encuentras el token, avísame
en qué pantalla quedaste.
```

> El `LINKEDIN_ORG_ID` ya lo tienes (69230307); el prompt arriba solo pide el token.

---

## Dónde pegar el resultado

1. Vercel → proyecto `mascenter-social-dashboard` → **Settings → Environment Variables**.
2. Agrega `LINKEDIN_ACCESS_TOKEN` (el que te dio Claude) y `LINKEDIN_ORG_ID=69230307`.
3. **Redeploy**. La sección LinkedIn pasa de "DATOS DE EJEMPLO" a **"AUTO · API"** y trae
   métricas + mejores posts del mes en vivo.

> El token de usuario de LinkedIn dura ~60 días. Cuando caduque, vuelve a correr el
> PROMPT (paso 3) y reemplaza solo `LINKEDIN_ACCESS_TOKEN` en Vercel.

---

## PROMPT 2 — Plan B: si NO se puede activar la API

Si LinkedIn no te deja activar la Community Management API, usa Claude para Chrome para
llenar los datos a mano una vez al mes. Ve a **LinkedIn → página de Grupo IFB → Análisis**
(Seguidores, Visitantes, Contenido), elige el mes que cerró y pega:

```
Estás en LinkedIn Analytics de la página de GRUPO IFB como admin. Lee las métricas del
MES <MES> (Seguidores, Visitantes y Contenido) y dame SOLO este JSON para pegar en
data/manual.json del repo, bajo "linkedin":

"<AAAA-MM>": {
  "followers": <seguidores totales>,
  "monthly": { "acquired": <nuevos>, "impressions": <impresiones>, "views": <visitantes únicos>, "reactions": <reacciones>, "engagement": <engagement %> },
  "best": [ { "label": "POST: <tema>", "date": "<dd mes>", "impressions": <n>, "reactions": <n>, "clicks": <n>, "newFollowers": <n> } ]
}

Luego abre github.com → repo mascenter-social-dashboard → data/manual.json → editar,
pega el bloque dentro de "linkedin" con la key del mes, y haz commit.
```

(El dashboard usa estos datos solo si NO hay token de API; con token, manda la API.)
