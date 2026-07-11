import { getStore } from "@netlify/blobs";

const STORE_NAME = "compra-lider";
const KEY = "wishlist";
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

function isValidNewItem(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.text === "string" &&
    body.text.trim().length > 0 &&
    typeof body.addedBy === "string" &&
    PEOPLE.includes(body.addedBy)
  );
}

async function listItems(store) {
  const items = (await store.get(KEY, { type: "json" })) || [];
  return json(items);
}

async function addItem(store, req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!isValidNewItem(body)) {
    return json({ error: "Se espera { text: '<algo>', addedBy: 'sebastian'|'ignacio'|'diego' }" }, 400);
  }

  const items = (await store.get(KEY, { type: "json" })) || [];
  const item = {
    id: crypto.randomUUID(),
    text: body.text.trim().slice(0, 200),
    addedBy: body.addedBy,
    createdAt: new Date().toISOString(),
  };
  const next = [...items, item];
  await store.setJSON(KEY, next);
  return json(item, 201);
}

async function deleteItem(store, id) {
  const items = (await store.get(KEY, { type: "json" })) || [];
  const next = items.filter((it) => it.id !== id);
  await store.setJSON(KEY, next);
  return json({ ok: true });
}

export default async (req, context) => {
  try {
    const store = getStore(STORE_NAME);
    const { pathname } = new URL(req.url);
    const parts = pathname.split("/").filter(Boolean); // ["api","wishlist", id?]
    const id = context?.params?.id || parts[2] || null;

    if (!id) {
      if (req.method === "GET") return await listItems(store);
      if (req.method === "POST") return await addItem(store, req);
      return methodNotAllowed();
    }

    if (req.method === "DELETE") return await deleteItem(store, id);
    return methodNotAllowed();
  } catch (e) {
    return json({ error: "Internal error", detail: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: ["/api/wishlist", "/api/wishlist/:id"] };
