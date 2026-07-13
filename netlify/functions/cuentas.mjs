import { getStore } from "@netlify/blobs";

const STORE_NAME = "compra-lider";
const ALLOWED_SCOPES = new Set(["hogar", "personal-sebastian", "personal-ignacio", "personal-diego"]);
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function methodNotAllowed() {
  return new Response("Method not allowed", { status: 405 });
}

function parsePath(req, context) {
  const { pathname } = new URL(req.url);
  const parts = pathname.split("/").filter(Boolean); // ["api","cuentas",scope,month?,sub?]
  const scope = context?.params?.scope || parts[2] || null;
  const month = context?.params?.month || parts[3] || null;
  const sub = parts[4] || null;
  return { scope, month, sub };
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] || month;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

// Shifts a "YYYY-MM-DD" date to the same day-of-month in a new "YYYY-MM",
// clamping to the last valid day if the target month is shorter.
function shiftMonth(fecha, targetMonth) {
  const day = Number(fecha.slice(8, 10)) || 1;
  const [y, m] = targetMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${targetMonth}-${String(clampedDay).padStart(2, "0")}`;
}

function computeTotals(items) {
  const today = todayISODate();
  let total = 0, pagado = 0, pendiente = 0, vencido = 0;
  items.forEach((it) => {
    total += it.monto;
    if (it.pagado) pagado += it.monto;
    else if (it.fecha < today) vencido += it.monto;
    else pendiente += it.monto;
  });
  return { total, pagado, pendiente, vencido };
}

function isValidItemsInput(items) {
  return (
    Array.isArray(items) &&
    items.every(
      (it) =>
        it &&
        typeof it === "object" &&
        typeof it.id === "string" &&
        it.id.length > 0 &&
        typeof it.nombre === "string" &&
        it.nombre.trim().length > 0 &&
        typeof it.categoria === "string" &&
        it.categoria.trim().length > 0 &&
        typeof it.monto === "number" &&
        Number.isFinite(it.monto) &&
        it.monto >= 0 &&
        typeof it.fecha === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(it.fecha) &&
        typeof it.pagado === "boolean"
    )
  );
}

async function readJsonBody(req) {
  try {
    return { body: await req.json() };
  } catch (e) {
    return { error: json({ error: "Invalid JSON" }, 400) };
  }
}

async function upsertIndexEntry(store, scope, month, items) {
  const index = (await store.get(`cuentas/${scope}/index`, { type: "json" })) || [];
  const existing = index.find((e) => e.month === month);
  const totals = computeTotals(items);
  const entry = {
    month,
    label: monthLabel(month),
    itemCount: items.length,
    ...totals,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
  };
  const next = [...index.filter((e) => e.month !== month), entry];
  await store.setJSON(`cuentas/${scope}/index`, next);
}

async function listMonths(store, scope) {
  const index = (await store.get(`cuentas/${scope}/index`, { type: "json" })) || [];
  const sorted = [...index].sort((a, b) => b.month.localeCompare(a.month));
  return json(sorted);
}

async function createMonth(store, scope, req) {
  const { body, error } = await readJsonBody(req);
  if (error) return error;

  if (!body || typeof body.month !== "string" || !/^\d{4}-\d{2}$/.test(body.month)) {
    return json({ error: "Se espera { month: 'YYYY-MM', copyFrom?: 'YYYY-MM' }" }, 400);
  }

  const alreadyExists = await store.get(`cuentas/${scope}/${body.month}/items`, { type: "json" });
  if (alreadyExists) {
    return json({ error: `Ya existe el mes ${body.month} para esta sección.` }, 409);
  }

  let items = [];
  if (typeof body.copyFrom === "string") {
    const source = await store.get(`cuentas/${scope}/${body.copyFrom}/items`, { type: "json" });
    if (Array.isArray(source)) {
      items = source.map((it) => ({
        id: crypto.randomUUID(),
        nombre: it.nombre,
        categoria: it.categoria,
        monto: it.monto,
        fecha: shiftMonth(it.fecha, body.month),
        pagado: false,
      }));
    }
  }

  await store.setJSON(`cuentas/${scope}/${body.month}/items`, items);
  await upsertIndexEntry(store, scope, body.month, items);
  return json({ month: body.month }, 201);
}

async function getMonth(store, scope, month) {
  const items = await store.get(`cuentas/${scope}/${month}/items`, { type: "json" });
  if (!items) return json({ error: "Mes no encontrado" }, 404);
  return json({ month, items });
}

async function updateItems(store, scope, month, req) {
  const existing = await store.get(`cuentas/${scope}/${month}/items`, { type: "json" });
  if (!existing) return json({ error: "Mes no encontrado" }, 404);

  const { body, error } = await readJsonBody(req);
  if (error) return error;
  if (!isValidItemsInput(body?.items)) {
    return json({ error: "Formato de items inválido" }, 400);
  }

  await store.setJSON(`cuentas/${scope}/${month}/items`, body.items);
  await upsertIndexEntry(store, scope, month, body.items);
  return json({ ok: true, items: body.items });
}

async function deleteMonth(store, scope, month) {
  const existing = await store.get(`cuentas/${scope}/${month}/items`, { type: "json" });
  if (!existing) return json({ error: "Mes no encontrado" }, 404);

  await store.delete(`cuentas/${scope}/${month}/items`);
  const index = (await store.get(`cuentas/${scope}/index`, { type: "json" })) || [];
  await store.setJSON(
    `cuentas/${scope}/index`,
    index.filter((e) => e.month !== month)
  );
  return json({ ok: true });
}

export default async (req, context) => {
  try {
    const store = getStore(STORE_NAME);
    const { scope, month, sub } = parsePath(req, context);

    if (!scope || !ALLOWED_SCOPES.has(scope)) {
      return json({ error: "Scope inválido" }, 400);
    }

    if (!month) {
      if (req.method === "GET") return await listMonths(store, scope);
      if (req.method === "POST") return await createMonth(store, scope, req);
      return methodNotAllowed();
    }

    if (sub === "items") {
      if (req.method === "PUT") return await updateItems(store, scope, month, req);
      return methodNotAllowed();
    }

    if (req.method === "GET") return await getMonth(store, scope, month);
    if (req.method === "DELETE") return await deleteMonth(store, scope, month);
    return methodNotAllowed();
  } catch (e) {
    return json({ error: "Internal error", detail: String((e && e.message) || e) }, 500);
  }
};

export const config = {
  path: ["/api/cuentas/:scope", "/api/cuentas/:scope/:month", "/api/cuentas/:scope/:month/items"],
};
