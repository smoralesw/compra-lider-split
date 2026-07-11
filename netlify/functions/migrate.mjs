import { getStore } from "@netlify/blobs";

// One-time bridge from the old single-order schema (key "state" + the
// hardcoded ITEMS array that used to live in index.html) to the new
// multi-order schema (orders/index + orders/<id>/{meta,items,state}).
// Safe to call more than once: uses a fixed id and deterministic per-row
// ids, and never touches/deletes the legacy "state" key.
// Delete this file once the migration has been confirmed in production.

const STORE_NAME = "compra-lider";
const LEGACY_KEY = "state";
const DEFAULT_ID = "lider-2026-07-10";
const DEFAULT_DATE = "2026-07-10";
const DEFAULT_NAME = "Compra Líder";

const LEGACY_ITEMS = [
  { n: "Papel Aluminio 7,5 Metros Sin Corte", q: 1, unit: 1850, total: 1850 },
  { n: "Acondicionador Pantene Pro-V Restauración", q: 1, unit: 5990, total: 5990 },
  { n: "Pan Precocido O Hallulla Atm 9 Un", q: 1, unit: 2490, total: 2490 },
  { n: "Arroz Grado 2 Largo Ancho", q: 1, unit: 2000, total: 2000 },
  { n: "Puré de Papas Instantáneo con Leche", q: 1, unit: 6390, total: 6390 },
  { n: "Sazonador Garam Masala", q: 1, unit: 1090, total: 1090 },
  { n: "Nuez Moscada Molida Aderezos", q: 1, unit: 550, total: 550 },
  { n: "Curry en Polvo Bolsa", q: 1, unit: 440, total: 440 },
  { n: "Sésamo Tostado", q: 1, unit: 1750, total: 1750 },
  { n: "Jabón Líquido Ballerina Yoghurt y Berries Vainilla", q: 2, unit: 1590, total: 3180 },
  { n: "Pasta Dental Colgate ultra blanco", q: 1, unit: 2750, total: 2750 },
  { n: "Nuggets de Pollo", q: 2, unit: 1000, total: 2000 },
  { n: "Choclo en Granos Congelado", q: 1, unit: 1590, total: 1590 },
  { n: "Huevos Tradicionales Grande Color", q: 1, unit: 9990, total: 9990 },
  { n: "Tabla de Planchar 114cm con malla metálica, producto surtido", q: 1, unit: 19990, total: 19990 },
  { n: "Plancha Antiadherente ES2350 1200 w", q: 1, unit: 7990, total: 7990 },
  { n: "Suavizante Líquido Concentrado Puro Cuidado Botella", q: 1, unit: 2000, total: 2000 },
  { n: "Detergente Líquido Floral Matic Botella", q: 1, unit: 7790, total: 7790 },
  { n: "Salame ahumado", q: 1, unit: 1000, total: 1000 },
  { n: "Crema de Leche Natural Espesa Larga Vida", q: 6, unit: 1000, total: 6000 },
  { n: "Huevos Tradicionales Extra Grande Blanco", q: 1, unit: 3690, total: 3690 },
  { n: "Leche Natural Entera caja", q: 2, unit: 1090, total: 2180 },
  { n: "Contenedor 600ML Vidrio Rectangular 1 Pieza Transparente", q: 1, unit: 2490, total: 2490 },
  { n: "Salsa Barbecue Original Botella", q: 1, unit: 3990, total: 3990 },
  { n: "Aderezo Mostaza Miel Botella", q: 1, unit: 3590, total: 3590 },
  { n: "Salsa de Tomate Italiana Pack 6 Un Bolsa", q: 1, unit: 3890, total: 3890 },
  { n: "Aceto Balsámico Botella", q: 1, unit: 2950, total: 2950 },
  { n: "Salsa De Soya Tradicional", q: 1, unit: 2590, total: 2590 },
  { n: "Mayonesa Regular Frasco", q: 1, unit: 6990, total: 6990 },
  { n: "Ketchup Regular Doypack", q: 1, unit: 2750, total: 2750 },
  { n: "Cuchillo Santoku 5.5\" 1 Pieza Acero Inoxidable - Madera Café - Negro", q: 1, unit: 4790, total: 4790 },
  { n: "Papel Film Plástico 30 Metros Corte Sierra", q: 1, unit: 1500, total: 1500 },
  { n: "Chuleta de Cerdo Centro", q: 2, unit: 3990, total: 7980 },
  { n: "Lomo de Cerdo Centro Medallón", q: 2, unit: 6690, total: 13380 },
];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    body = {};
  }

  if (!body || body.confirm !== true) {
    return json({ error: "Enviá { confirm: true } para ejecutar la migración." }, 400);
  }

  const store = getStore(STORE_NAME);
  const legacyState = await store.get(LEGACY_KEY, { type: "json" });

  if (!legacyState) {
    return json({ migrated: false, reason: "No hay estado legacy que migrar." });
  }

  if (!Array.isArray(legacyState) || legacyState.length !== LEGACY_ITEMS.length) {
    return json(
      {
        migrated: false,
        reason: `El estado legacy tiene ${Array.isArray(legacyState) ? legacyState.length : "?"} filas, se esperaban ${LEGACY_ITEMS.length}. Abortando para no migrar mal.`,
      },
      409
    );
  }

  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : DEFAULT_ID;
  const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : DEFAULT_DATE;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : DEFAULT_NAME;

  const items = LEGACY_ITEMS.map((it, idx) => ({
    id: `item-${idx + 1}`,
    name: it.n,
    qty: it.q,
    unitPrice: it.unit,
    total: it.total,
  }));

  const state = {};
  legacyState.forEach((row, idx) => {
    state[`item-${idx + 1}`] = {
      sebastian: !!row.sebastian,
      ignacio: !!row.ignacio,
      diego: !!row.diego,
    };
  });

  const createdAt = new Date().toISOString();
  const meta = { id, name, date, createdAt };
  const total = items.reduce((acc, it) => acc + it.total, 0);

  await Promise.all([
    store.setJSON(`orders/${id}/meta`, meta),
    store.setJSON(`orders/${id}/items`, items),
    store.setJSON(`orders/${id}/state`, state),
  ]);

  const index = (await store.get("orders/index", { type: "json" })) || [];
  const nextIndex = [
    ...index.filter((e) => e.id !== id),
    { id, name, date, itemCount: items.length, total, createdAt },
  ];
  await store.setJSON("orders/index", nextIndex);

  return json({ migrated: true, id, itemCount: items.length, total });
};

export const config = { path: "/api/migrate" };
