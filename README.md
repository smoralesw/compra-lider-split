# Carmencita Finance Manager

App para manejar varios "pedidos" (compras de supermercado) y dividir el
costo de cada uno entre Sebastián, Ignacio y Diego. Cada pedido tiene su
propia lista de productos; cada producto se puede marcar para una o más
personas y el costo se reparte en partes iguales entre los marcados. La
selección se guarda en el servidor y se sincroniza entre los tres cada pocos
segundos, así que cualquiera puede abrir el link de un pedido y ver/editar la
misma selección en tiempo real.

## Estructura

- `index.html` — **landing**: hero con el logo, un sidebar a la izquierda
  (se puede abrir/cerrar) para navegar entre **Cuentas** (gastos mensuales,
  con pestañas Hogar/Personal, ver más abajo) y **Pedidos** (wishlist
  compartida + lista de pedidos con nombre/fecha/total, crear uno nuevo a
  mano, subiendo una foto o pegando texto — todo interpretado con IA, ver
  más abajo — y eliminar pedidos existentes).
- `pedido.html` — vista de detalle de un pedido puntual, parametrizada por
  `?id=<id>` (ej. `pedido.html?id=lider-2026-07-10`). Aquí vive la tabla de
  productos con checkboxes, los totales por persona, la edición de
  productos, el botón de copiar resumen y el de eliminar el pedido.
- `assets/logo-hero.jpg` / `assets/logo-icon.png` — el banner y el ícono del
  logo (favicon + marca en `pedido.html`). Si el logo cambia, basta con
  reemplazar estos dos archivos manteniendo el nombre.
- `netlify/functions/orders.mjs` — CRUD de pedidos sobre
  [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (ver esquema de
  datos y endpoints abajo).
- `netlify/functions/parse-receipt.mjs` — recibe una foto y usa la API de
  Anthropic (Claude, con visión) para extraer los productos automáticamente.
- `netlify/functions/parse-text.mjs` — recibe un texto pegado (lista, correo
  de confirmación, carrito copiado, etc.) y usa Claude para extraer los
  productos, mismo patrón que `parse-receipt.mjs` pero sin imagen.
- `netlify/functions/wishlist.mjs` — CRUD simple de la wishlist compartida
  (ver esquema y endpoints abajo).
- `netlify/functions/cuentas.mjs` — CRUD de cuentas mensuales (Hogar y
  Personal) sobre Blobs, con historial real por mes (ver esquema y
  endpoints abajo).
- `netlify/functions/seed-cuentas.mjs` — función temporal de una sola
  ejecución para precargar las cuentas recurrentes de Hogar de julio a
  diciembre 2026. Se puede borrar una vez confirmado el seed (ver sección
  "Cuentas" más abajo).

## Esquema de datos (Netlify Blobs, store `compra-lider`)

- `orders/index` — lista liviana para la landing:
  `[{id, name, date, itemCount, total, createdAt}]`.
- `orders/<id>/meta` — `{id, name, date, createdAt}`.
- `orders/<id>/items` — `[{id, name, qty, unitPrice, total}]`. Cada producto
  tiene un `id` propio (no depende de su posición en el array), para que
  agregar/editar/borrar filas no desalinee los checkboxes de nadie.
- `orders/<id>/state` — objeto keyeado por ese mismo `id` de producto:
  `{[itemId]: {sebastian, ignacio, diego}}`.
- `wishlist` — array compartido: `[{id, text, addedBy, createdAt}]`.
- `cuentas/<scope>/index` — meses con datos para ese scope:
  `[{month:"2026-07", label:"Julio 2026", itemCount, total, pagado,
  pendiente, vencido, createdAt}]`. `scope` es uno de `hogar`,
  `personal-sebastian`, `personal-ignacio`, `personal-diego`.
- `cuentas/<scope>/<month>/items` — `[{id, nombre, categoria, monto, fecha,
  pagado}]`. El estado "vencido" no se guarda — se calcula al vuelo
  (`!pagado && fecha < hoy`). No tiene método de pago (se sacó, no
  agregaba valor).

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
- `POST /api/parse-text` — body `{text: "<pedido pegado>"}`, devuelve
  `{items: [{name, qty, unitPrice}]}` extraídos por Claude. Misma
  dependencia de `ANTHROPIC_API_KEY` que `/api/parse-receipt`.
- `GET /api/wishlist` — lista completa de la wishlist.
- `POST /api/wishlist` — agrega un item. Body: `{text, addedBy}` (`addedBy`
  debe ser `sebastian`, `ignacio` o `diego`).
- `DELETE /api/wishlist/:id` — quita un item (a mano, o automático al
  importarlo a un pedido nuevo).
- `GET /api/cuentas/:scope` — meses disponibles para ese scope.
- `POST /api/cuentas/:scope` — crea un mes. Body `{month: "YYYY-MM",
  copyFrom?: "YYYY-MM"}`. Si `copyFrom` viene, copia las cuentas de ese mes
  (nombre/categoría/monto), corre la fecha al mes nuevo y resetea `pagado`
  a `false`. No hay botón en la UI para esto (ver sección "Cuentas" más
  abajo), pero el endpoint queda disponible para uso futuro.
- `GET /api/cuentas/:scope/:month` — cuentas de ese mes.
- `PUT /api/cuentas/:scope/:month/items` — reemplaza el array completo
  (agregar/editar/borrar/marcar pagada = mandar el array nuevo entero).
- `DELETE /api/cuentas/:scope/:month` — borra un mes (sin botón en la UI
  todavía).

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

## Cargar un pedido por foto o pegando texto

Ambas vías requieren una variable de entorno `ANTHROPIC_API_KEY` configurada
en Netlify (Site settings → Environment variables). Sin esa key, todo el
resto de la app funciona igual — solo falla, con un mensaje claro, la
extracción automática de productos.

La imagen se reduce y comprime en el navegador (`<canvas>`, máx ~1600px,
JPEG calidad 0.8) antes de subirla, para no pegar contra límites de tamaño
de las funciones de Netlify y para bajar costo/latencia de la llamada a la
API. En ambos casos (foto o texto pegado), los productos que devuelve Claude
se muestran en una tabla editable antes de guardar el pedido, así se pueden
corregir errores de lectura.

## Wishlist

Lista compartida (dentro de la pestaña Pedidos) donde cualquiera anota cosas
para la próxima compra, indicando quién lo pidió. Al crear un pedido manual,
se pueden tildar items de la wishlist para agregarlos directo como productos
del pedido nuevo (con cantidad 1 y precio $0, a completar después); al
guardar el pedido, esos items se sacan automáticamente de la wishlist.

## Cuentas (Hogar y Personal)

Dentro de Cuentas hay dos pestañas:

- **Hogar**: gastos grupales del hogar. Categorías: Vivienda, Salud y
  bienestar, Servicios básicos, Otros. Sin split entre personas — solo se
  trackea pagado/pendiente/vencido.
- **Personal**: cada persona (Sebastián, Ignacio, Diego, elegibles con los
  pills de arriba) lleva sus propios gastos (gimnasio, comida,
  suscripciones, seguros, TAG, dividendo de departamentos, cuenta de
  teléfono, etc.), independientes entre sí. Todavía no tiene cuentas
  recurrentes precargadas (pendiente).

Ambas comparten el mismo componente de dashboard (KPIs de total/pagado/
pendiente/vencido, barra de progreso, próximos vencimientos, gasto por
categoría, tabla filtrable con alta/edición/borrado/marcar pagada) —
internamente son 4 "scopes" (`hogar` + un `personal-<nombre>` por persona)
manejados por el mismo backend genérico en `netlify/functions/cuentas.mjs`.
No tienen método de pago (se sacó ese campo, no aportaba nada al análisis).

**Los meses no se crean desde la UI.** Hogar viene con los 6 meses de
julio a diciembre 2026 precargados (ver siguiente sección), cada uno con
las cuentas recurrentes en monto $0 — el usuario solo tiene que editar el
monto real de cada mes (botón ✏️ en la tabla) y marcar como pagada cuando
corresponda. Al abrir Cuentas se selecciona automáticamente el mes actual
si existe. Se puede además agregar cualquier cuenta adicional que se
necesite con "+ Nueva cuenta".

Cuentas recurrentes precargadas en Hogar:

- Arriendo (Vivienda)
- Gastos comunes (Vivienda)
- Luz, Agua, Gas, Empleada doméstica (Servicios básicos)

### Precargar las cuentas de Hogar (una sola vez)

```bash
curl -X POST https://<sitio>.netlify.app/api/seed-cuentas \
  -H 'Content-Type: application/json' \
  -d '{"confirm": true}'
```

Es no destructivo (nunca sobreescribe un mes que ya tenga datos) e
idempotente (se puede correr de nuevo sin duplicar nada). Una vez
confirmado que los 6 meses aparecen bien en Hogar, se puede borrar
`netlify/functions/seed-cuentas.mjs`.

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
pedido, key `state` en Blobs) ya se migró al esquema nuevo como
`orders/lider-2026-07-10/*`, preservando los checkboxes que ya estaban
marcados. La función que hizo esa migración (`migrate.mjs`) se borró una vez
confirmado que el pedido aparece bien en la landing; la key legacy `state`
quedó sin usar en Blobs (no se borró, por las dudas).
