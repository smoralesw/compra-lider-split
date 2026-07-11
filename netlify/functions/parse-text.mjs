const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_TEXT_CHARS = 20_000;

const EXTRACTION_PROMPT = `El siguiente texto es un pedido de supermercado pegado por el usuario (puede ser una lista, un correo de confirmación, un carrito copiado de una web, etc., en cualquier formato). Extrae cada producto como un objeto con "name" (nombre del producto), "qty" (cantidad, número) y "unitPrice" (precio unitario en pesos chilenos, número, sin símbolos ni puntos de miles). Si el texto trae precio total de la línea y cantidad pero no precio unitario, calculalo dividiendo. Si una línea no trae cantidad, asumí 1. Ignorá líneas que no sean productos (totales, direcciones, encabezados, etc.). Responde ÚNICAMENTE con un array JSON válido, sin texto adicional, sin markdown, sin explicaciones. Ejemplo de formato: [{"name":"Leche Entera 1L","qty":2,"unitPrice":990}]

Texto del pedido:
"""
{{TEXT}}
"""`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidRequestBody(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.text === "string" &&
    body.text.trim().length > 0
  );
}

function isValidExtractedItems(items) {
  return (
    Array.isArray(items) &&
    items.every(
      (it) =>
        it &&
        typeof it === "object" &&
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

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(
      {
        error:
          "Falta configurar ANTHROPIC_API_KEY en Netlify (Site settings → Environment variables) para poder leer pedidos pegados como texto.",
      },
      500
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!isValidRequestBody(body)) {
    return json({ error: "Se espera { text: '<pedido pegado>' }" }, 400);
  }

  const text = body.text.trim();
  if (text.length > MAX_TEXT_CHARS) {
    return json({ error: "El texto es muy largo. Probá pegando una parte más chica del pedido." }, 413);
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: EXTRACTION_PROMPT.replace("{{TEXT}}", text) }],
          },
        ],
      }),
    });
  } catch (e) {
    return json({ error: "No se pudo contactar a la API de Anthropic." }, 502);
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => "");
    return json({ error: `Anthropic API error (${anthropicRes.status})`, detail }, 502);
  }

  const data = await anthropicRes.json();
  const responseText = (data?.content || []).map((b) => b.text || "").join("").trim();

  let items;
  try {
    items = JSON.parse(responseText);
  } catch (e) {
    return json({ error: "Claude no devolvió un JSON válido. Probá de nuevo, o revisá el texto pegado.", raw: responseText }, 502);
  }

  if (!isValidExtractedItems(items)) {
    return json({ error: "El formato de productos extraídos no es válido.", raw: items }, 502);
  }

  return json({ items });
};

export const config = { path: "/api/parse-text" };
