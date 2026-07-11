const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_BASE64_CHARS = 8_000_000; // rough safety cap, not an exact byte limit
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const EXTRACTION_PROMPT = `Esta imagen muestra un carrito de compra o una boleta de supermercado. Extrae cada producto como un objeto con "name" (nombre del producto tal como aparece), "qty" (cantidad, número) y "unitPrice" (precio unitario en pesos chilenos, número, sin símbolos). Si solo ves el precio total de la línea y la cantidad, calculá el precio unitario dividiendo. Responde ÚNICAMENTE con un array JSON válido, sin texto adicional, sin markdown, sin explicaciones. Ejemplo de formato: [{"name":"Leche Entera 1L","qty":2,"unitPrice":990}]`;

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
    typeof body.image === "string" &&
    body.image.length > 0 &&
    typeof body.mediaType === "string" &&
    ALLOWED_MEDIA_TYPES.has(body.mediaType)
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
          "Falta configurar ANTHROPIC_API_KEY en Netlify (Site settings → Environment variables) para poder leer fotos de pedidos.",
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
    return json(
      { error: "Se espera { image: <base64>, mediaType: 'image/jpeg'|'image/png'|'image/webp'|'image/gif' }" },
      400
    );
  }

  if (body.image.length > MAX_BASE64_CHARS) {
    return json({ error: "La imagen es muy grande. Probá con una foto más chica o comprimida." }, 413);
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
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: body.mediaType, data: body.image },
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
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
  const text = (data?.content || []).map((b) => b.text || "").join("").trim();

  let items;
  try {
    items = JSON.parse(text);
  } catch (e) {
    return json({ error: "Claude no devolvió un JSON válido. Probá de nuevo con otra foto.", raw: text }, 502);
  }

  if (!isValidExtractedItems(items)) {
    return json({ error: "El formato de productos extraídos no es válido.", raw: items }, 502);
  }

  return json({ items });
};

export const config = { path: "/api/parse-receipt" };
