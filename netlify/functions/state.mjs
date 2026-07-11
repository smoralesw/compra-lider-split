import { getStore } from "@netlify/blobs";

const STORE_NAME = "compra-lider";
const KEY = "state";
const PEOPLE = ["sebastian", "ignacio", "diego"];
const MAX_ITEMS = 500; // sanity bound, well above any real grocery order

function isValidState(body) {
  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_ITEMS) return false;
  return body.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      Object.keys(row).every((k) => PEOPLE.includes(k)) &&
      PEOPLE.every((p) => typeof row[p] === "boolean")
  );
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" });
    return json(data ?? null, 200);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!isValidState(body)) {
      return json({ error: "Invalid state shape" }, 400);
    }
    await store.setJSON(KEY, body);
    return json({ ok: true }, 200);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/state" };
