import { getStore } from "@netlify/blobs";

// One-time bridge to pre-populate the recurring Hogar accounts for
// jul-dic 2026, since those bills repeat every month and the user
// shouldn't have to create months (or re-type arriendo/luz/etc.) by hand.
// Safe to call more than once: skips any month that already has items.
// Delete this file once the seed has been confirmed in production.

const STORE_NAME = "compra-lider";
const SCOPE = "hogar";
const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const DEFAULT_ITEMS = [
  { nombre: "Arriendo", categoria: "Vivienda" },
  { nombre: "Gastos comunes", categoria: "Vivienda" },
  { nombre: "Luz", categoria: "Servicios básicos" },
  { nombre: "Agua", categoria: "Servicios básicos" },
  { nombre: "Gas", categoria: "Servicios básicos" },
  { nombre: "Empleada doméstica", categoria: "Servicios básicos" },
];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] || month;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
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
    return json({ error: "Envía { confirm: true } para ejecutar el seed." }, 400);
  }

  const store = getStore(STORE_NAME);
  const created = [];
  const skipped = [];

  for (const month of MONTHS) {
    const existing = await store.get(`cuentas/${SCOPE}/${month}/items`, { type: "json" });
    if (existing) {
      skipped.push(month);
      continue;
    }

    const items = DEFAULT_ITEMS.map((it) => ({
      id: crypto.randomUUID(),
      nombre: it.nombre,
      categoria: it.categoria,
      monto: 0,
      fecha: `${month}-05`,
      pagado: false,
    }));

    await store.setJSON(`cuentas/${SCOPE}/${month}/items`, items);
    created.push(month);
  }

  const index = (await store.get(`cuentas/${SCOPE}/index`, { type: "json" })) || [];
  const nextIndex = [...index];
  for (const month of created) {
    const items = await store.get(`cuentas/${SCOPE}/${month}/items`, { type: "json" });
    const entry = {
      month,
      label: monthLabel(month),
      itemCount: items.length,
      total: 0,
      pagado: 0,
      pendiente: 0,
      vencido: 0,
      createdAt: new Date().toISOString(),
    };
    const idx = nextIndex.findIndex((e) => e.month === month);
    if (idx >= 0) nextIndex[idx] = entry;
    else nextIndex.push(entry);
  }
  await store.setJSON(`cuentas/${SCOPE}/index`, nextIndex);

  return json({ created, skipped });
};

export const config = { path: "/api/seed-cuentas" };
