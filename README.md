# Compra Split - División de gastos por pedido

App para manejar varios "pedidos" (compras de supermercado) y dividir el
costo de cada uno entre Sebastián, Ignacio y Diego. Cada pedido tiene su
propia lista de productos; cada producto se puede marcar para una o más
personas y el costo se reparte en partes iguales entre los marcados. La
selección se guarda en el servidor y se sincroniza entre los tres cada pocos
segundos, así que cualquiera puede abrir el link de un pedido y ver/editar la
misma selección en tiempo real.

## Estructura

- `index.html` — **landing**: lista todos los pedidos (nombre, fecha, total)
  y permite crear uno nuevo, a mano o subiendo una foto del carrito/boleta
  (se interpreta con IA, ver más abajo).
- `pedido.html` — vista de detalle de un pedido puntual, parametrizada por
  `?id=<id>` (ej. `pedido.html?id=lider-2026-07-10`). Acá vive la tabla de
  productos con checkboxes, los totales por persona, la edición de productos
  y el botón de copiar resumen.
- `netlify/functions/orders.mjs` — CRUD de pedidos sobre
  [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (ver esquema de
  datos y endpoints abajo).
- `netlify/functions/parse-receipt.mjs` — recibe una foto y usa la API de
  Anthropic (Claude, con visión) para extraer los productos automáticamente.
- `netlify/functions/migrate.mjs` — función temporal de una sola ejecución
  para migrar el pedido de Líder original (schema viejo, un solo pedido) al
  schema nuevo. Se puede borrar una vez confirmada la migración.

## Esquema de datos (Netlify Blobs, store `compra-lider`)

- `orders/index` — lista liviana para la landing:
  `[{id, name, date, itemCount, total, createdAt}]`.
- `orders/<id>/meta` — `{id, name, date, createdAt}`.
- `orders/<id>/items` — `[{id, name, qty, unitPrice, total}]`. Cada producto
  tiene un `id` propio (no depende de su posición en el array), para que
  agregar/editar/borrar filas no desalinee los checkboxes de nadie.
- `orders/<id>/state` — objeto keyeado por ese mismo `id` de producto:
  `{[itemId]: {sebastian, ignacio, diego}}`.

## Endpoints

- `GET /api/orders` — lista de pedidos (para la landing).
- `POST /api/orders` — crea un pedido. Body: `{name, date, items?}`.
- `GET /api/orders/:id` — pedido completo (`meta` + `items` + `state`).
- `DELETE /api/orders/:id` — borra un pedido.
- `PUT /api/orders/:id/items` — reemplaza el array de productos completo
  (agregar/editar/borrar = mandar el array nuevo entero). El servidor
  recalcula `total = qty * unitPrice` y no confía en lo que mande el cliente.
- `GET/POST /api/orders/:id/state` — leer/guardar los checkboxes de un
  pedido.
- `POST /api/parse-receipt` — body `{image: <base64>, mediaType}`, devuelve
  `{items: [{name, qty, unitPrice}]}` extraídos de la foto por Claude.
  Requiere `ANTHROPIC_API_KEY` configurada (ver abajo); si falta, responde
  con un error explicando qué falta, sin afectar el resto de la app.

## Cómo funciona la sincronización de checkboxes

- El cliente hace `POST /api/orders/:id/state` cada vez que cambia una
  casilla.
- Cada 5s (`POLL_MS`), el cliente hace `GET /api/orders/:id/state` y, si el
  servidor tiene una versión distinta a la última que guardó, actualiza la
  vista.
- Si un `POST` falla (por ejemplo, sin conexión), se reintenta
  automáticamente en el siguiente ciclo de polling.
- **Limitación conocida:** no hay resolución de conflictos. Si dos personas
  marcan casillas distintas casi al mismo tiempo, gana el último `POST` que
  llegue al servidor (last-write-wins). Para el uso previsto (3 personas
  coordinando una compra puntual) no debería ser un problema real.

## Cargar un pedido por foto

Requiere una variable de entorno `ANTHROPIC_API_KEY` configurada en Netlify
(Site settings → Environment variables). Sin esa key, todo el resto de la
app funciona igual — solo falla, con un mensaje claro, la extracción
automática de productos desde una foto.

La imagen se reduce y comprime en el navegador (`<canvas>`, máx ~1600px,
JPEG calidad 0.8) antes de subirla, para no pegar contra límites de tamaño
de las funciones de Netlify y para bajar costo/latencia de la llamada a la
API. Los productos que devuelve Claude se muestran en una tabla editable
antes de guardar el pedido, así se pueden corregir errores de lectura.

## Desarrollo local

Requiere [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install
npx netlify dev
```

Esto sirve `index.html`/`pedido.html` y ejecuta las funciones de
`netlify/functions` localmente.

## Deploy

El repo está pensado para desplegarse directo en Netlify (ver `netlify.toml`:
publica la raíz del repo y las funciones desde `netlify/functions`). Conectar
el repo en Netlify y cada push a `main` se despliega solo.

## Migración del pedido original

El pedido de Líder que existía antes de este cambio (schema de un solo
pedido, key `state` en Blobs) se migra corriendo una vez, después del
deploy:

```bash
curl -X POST https://<sitio>.netlify.app/api/migrate \
  -H 'Content-Type: application/json' \
  -d '{"confirm": true}'
```

Es no destructivo (no borra la key vieja) e idempotente (usa ids fijos, así
que correrlo de nuevo no duplica nada). Una vez confirmado que el pedido
aparece bien en la landing, se puede borrar
`netlify/functions/migrate.mjs`.
