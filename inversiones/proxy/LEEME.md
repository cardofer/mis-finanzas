# Proxy de precios (opcional)

Yahoo Finance tiene precios de la **Bolsa Mexicana** (AMXL.MX, NAFTRAC.MX…),
acciones y ETFs de casi cualquier bolsa, pero no permite que una página web los pida directamente.
Este pequeño intermediario lo resuelve. Es gratis en el plan Free de Supabase.

## Instalarlo en Supabase (≈5 minutos)

Puedes usar el mismo proyecto de Supabase de "Mis Finanzas": esta función **no toca tus datos**,
solo consulta precios públicos.

1. Instala la herramienta: `npm install -g supabase` (o `brew install supabase/tap/supabase`).
2. En una carpeta vacía:
   ```bash
   supabase login
   supabase init
   supabase functions new cotizaciones
   ```
3. Reemplaza el contenido de `supabase/functions/cotizaciones/index.ts` con el de `cotizaciones.ts`.
4. Publícala (sin exigir sesión, porque solo da precios públicos):
   ```bash
   supabase functions deploy cotizaciones --no-verify-jwt --project-ref TU_REF
   ```
   `TU_REF` es lo que va antes de `.supabase.co` en la URL de tu proyecto.
5. Prueba en el navegador: `https://TU_REF.supabase.co/functions/v1/cotizaciones?s=AMXL.MX,AAPL`
6. Pega esa URL (sin `?s=...`) en **Mis Inversiones → Ajustes → URL de tu proxy**.

> Alternativa sin terminal: en el panel de Supabase → Edge Functions → *Deploy a new function* →
> *Via Editor*, pega el código, nómbrala `cotizaciones` y desactiva **Verify JWT**.
