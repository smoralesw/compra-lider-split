import { getStore } from "@netlify/blobs";

const STORE_NAME = "compra-lider";
const PEOPLE = ["sebastian", "ignacio", "diego"];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function methodNotAllowed() {
  return new Response("Method not allowed", { status: 405 });
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pedido"
  );
}

// Netlify Functions V2 should populate context.params.id for the ":id"
// path patterns declared in config.path below, but we don't fully trust
// that in every runtime, so we also derive id/sub-resource from the raw
// pathname as a fallback.
function parsePath(req, context) {
  const { pathname } = new URL(req.url);
  const parts = pathname.split("/").filter(Boolean); // ["api","orders",id?,sub?]
  const id = context?.params?.id || parts[2] || null;
  const sub = parts[3] || null; // "items" | "state" | null
  return { id, sub };
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
        typeof it.name === "string" &&
        it.name.trim().length > 0 &&
        typeof it.qty === "number" &&
        Number.isFinite(it.qty) &&
        it.qty > 0 &&
        typeof it.unitPrice === "number" &&
        Number.isFinite(it.unitPrice) &&
        it.unitPrice >= 0
    )
  );
}

function withTotals(items) {
  return items.map((it) => ({
    id: it.id,
    name: it.name.trim(),
    qty: it.qty,
    unitPrice: it.unitPrice,
    total: Math.round(it.qty * it.unitPrice),
  }));
}

function sumTotal(items) {
  return items.reduce((acc, it) => acc + it.total, 0);
}

function emptyState(items) {
  const state = {};
  items.forEach((it) => {
    state[it.id] = { sebastian: false, ignacio: false, diego: false };
  });
  return state;
}

function isValidStatePatch(body, validIds) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.itemId === "string" &&
    validIds.has(body.itemId) &&
    PEOPLE.includes(body.person) &&
    typeof body.checked === "boolean"
  );
}

async function readJsonBody(req) {
  try {
    return { body: await req.json() };
  } catch (e) {
    return { error: json({ error: "Invalid JSON" }, 400) };
  }
}

async function appendToIndex(store, entry) {
  const index = (await store.get("orders/index", { type: "json" })) || [];
  const next = [...index.filter((e) => e.id !== entry.id), entry];
  await store.setJSON("orders/index", next);
}

async function generateId(store, name, date) {
  const base = slugify(`${name}-${date}`);
  let candidate = base;
  let n = 1;
  while (await store.get(`orders/${candidate}/meta`, { type: "json" })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

async function listOrders(store) {
  const index = (await store.get("orders/index", { type: "json" })) || [];
  return json(index);
}

async function createOrder(store, req) {
  const { body, error } = await readJsonBody(req);
  if (error) return error;

  if (
    !body ||
    typeof body !== "object" ||
    typeof body.name !== "string" ||
    body.name.trim().length === 0 ||
    typeof body.date !== "string" ||
    body.date.trim().length === 0 ||
    (body.items !== undefined && !isValidItemsInput(body.items))
  ) {
    return json({ error: "Invalid order shape" }, 400);
  }

  const items = withTotals(body.items || []);
  const id = await generateId(store, body.name, body.date);
  const createdAt = new Date().toISOString();
  const meta = { id, name: body.name.trim(), date: body.date, createdAt };
  const state = emptyState(items);

  await Promise.all([
    store.setJSON(`orders/${id}/meta`, meta),
    store.setJSON(`orders/${id}/items`, items),
    store.setJSON(`orders/${id}/state`, state),
  ]);

  await appendToIndex(store, {
    id,
    name: meta.name,
    date: meta.date,
    itemCount: items.length,
    total: sumTotal(items),
    createdAt,
  });

  return json({ id }, 201);
}

async function getOrder(store, id) {
  const [meta, items, state] = await Promise.all([
    store.get(`orders/${id}/meta`, { type: "json" }),
    store.get(`orders/${id}/items`, { type: "json" }),
    store.get(`orders/${id}/state`, { type: "json" }),
  ]);
  if (!meta) return json({ error: "Order not found" }, 404);
  return json({ ...meta, items: items || [], state: state || {} });
}

async function deleteOrder(store, id) {
  const meta = await store.get(`orders/${id}/meta`, { type: "json" });
  if (!meta) return json({ error: "Order not found" }, 404);

  await Promise.all([
    store.delete(`orders/${id}/meta`),
    store.delete(`orders/${id}/items`),
    store.delete(`orders/${id}/state`),
  ]);

  const index = (await store.get("orders/index", { type: "json" })) || [];
  await store.setJSON(
    "orders/index",
    index.filter((e) => e.id !== id)
  );

  return json({ ok: true });
}

async function updateItems(store, id, req) {
  const meta = await store.get(`orders/${id}/meta`, { type: "json" });
  if (!meta) return json({ error: "Order not found" }, 404);

  const { body, error } = await readJsonBody(req);
  if (error) return error;
  if (!isValidItemsInput(body?.items)) {
    return json({ error: "Invalid items shape" }, 400);
  }

  const items = withTotals(body.items);
  const prevState = (await store.get(`orders/${id}/state`, { type: "json" })) || {};
  const nextState = {};
  items.forEach((it) => {
    nextState[it.id] = prevState[it.id] || {
      sebastian: false,
      ignacio: false,
      diego: false,
    };
  });

  await Promise.all([
    store.setJSON(`orders/${id}/items`, items),
    store.setJSON(`orders/${id}/state`, nextState),
  ]);

  await appendToIndex(store, {
    id,
    name: meta.name,
    date: meta.date,
    itemCount: items.length,
    total: sumTotal(items),
    createdAt: meta.createdAt,
  });

  return json({ ok: true, items, state: nextState });
}

async function getState(store, id) {
  const meta = await store.get(`orders/${id}/meta`, { type: "json" });
  if (!meta) return json({ error: "Order not found" }, 404);
  const state = (await store.get(`orders/${id}/state`, { type: "json" })) || {};
  return json(state);
}

// Aplica el toggle de una sola celda (item x persona) en vez de recibir y
// pisar el objeto de estado completo, y lo hace con compare-and-swap sobre
// el etag del blob. Un simple read-modify-write no alcanza: cada POST corre
// en una invocación de función separada, así que varios clicks casi
// simultáneos (mismo usuario marcando varias filas rápido, o dos personas a
// la vez) generan lecturas concurrentes de `orders/<id>/state` que todavía
// no vieron el write de las otras — sin CAS, la última en escribir pisa
// todo lo que las demás acababan de guardar. Con `onlyIfMatch`, si otra
// request ya movió el etag, el write falla (`modified: false`) y se
// reintenta con los datos frescos, así que ningún cambio se pierde.
async function postState(store, id, req) {
  const items = await store.get(`orders/${id}/items`, { type: "json" });
  if (!items) return json({ error: "Order not found" }, 404);

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const validIds = new Set(items.map((it) => it.id));
  if (!isValidStatePatch(body, validIds)) {
    return json({ error: "Invalid state patch shape" }, 400);
  }

  const key = `orders/${id}/state`;
  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await store.getWithMetadata(key, { type: "json" });
    const state = (current && current.data) || {};
    const etag = current && current.etag;

    const row = { ...(state[body.itemId] || { sebastian: false, ignacio: false, diego: false }) };
    row[body.person] = body.checked;
    const nextState = { ...state, [body.itemId]: row };

    const writeOpts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, nextState, writeOpts);
    if (result && result.modified) {
      return json({ ok: true, state: nextState });
    }
    // Otra request ganó la carrera y escribió justo antes: reintenta con
    // el estado más fresco en vez de perder este cambio.
  }

  return json({ error: "No se pudo guardar por demasiada contención, reintenta." }, 409);
}

export default async (req, context) => {
  try {
    const store = getStore(STORE_NAME);
    const { id, sub } = parsePath(req, context);

    if (!id) {
      if (req.method === "GET") return await listOrders(store);
      if (req.method === "POST") return await createOrder(store, req);
      return methodNotAllowed();
    }

    if (sub === "items") {
      if (req.method === "PUT") return await updateItems(store, id, req);
      return methodNotAllowed();
    }

    if (sub === "state") {
      if (req.method === "GET") return await getState(store, id);
      if (req.method === "POST") return await postState(store, id, req);
      return methodNotAllowed();
    }

    if (req.method === "GET") return await getOrder(store, id);
    if (req.method === "DELETE") return await deleteOrder(store, id);
    return methodNotAllowed();
  } catch (e) {
    return json({ error: "Internal error", detail: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: ["/api/orders", "/api/orders/:id", "/api/orders/:id/items", "/api/orders/:id/state"],
};
