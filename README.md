# Compra Líder - División de gastos

Página de una sola vista para dividir el detalle de una compra de Líder entre 3
personas (Sebastián, Ignacio, Diego). Cada producto se puede marcar para una o
más personas y el costo se reparte en partes iguales entre los marcados. El
estado (qué casillas están marcadas) se guarda en el servidor y se sincroniza
entre los tres cada pocos segundos, así que cualquiera puede abrir el link y
ver/editar la misma selección en tiempo real.

## Estructura

- `index.html` — toda la UI y lógica de cliente. El detalle de productos
  (`ITEMS`) está hardcodeado en el `<script>`.
- `netlify/functions/state.mjs` — función serverless que guarda/lee el estado
  compartido en [Netlify Blobs](https://docs.netlify.com/blobs/overview/),
  expuesta en `/api/state` (ver `netlify.toml`).

## Cómo funciona la sincronización

- El cliente hace `POST /api/state` cada vez que cambia una casilla.
- Cada 5s (`POLL_MS`), el cliente hace `GET /api/state` y, si el servidor
  tiene una versión distinta a la última que guardó, actualiza la vista.
- Si un `POST` falla (por ejemplo, sin conexión), se reintenta automáticamente
  en el siguiente ciclo de polling.
- **Limitación conocida:** no hay resolución de conflictos. Si dos personas
  marcan casillas distintas casi al mismo tiempo, gana el último `POST` que
  llegue al servidor (last-write-wins). Para el uso previsto (3 personas
  coordinando una compra puntual) no debería ser un problema real.

## Desarrollo local

Requiere [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install
npx netlify dev
```

Esto sirve `index.html` y ejecuta la función de `/api/state` localmente.

## Deploy

El repo está pensado para desplegarse directo en Netlify (ver `netlify.toml`:
publica la raíz del repo y las funciones desde `netlify/functions`). Conectar
el repo en Netlify y cada push a `main` se despliega solo.

## Editar el detalle de la compra

Los productos, cantidades y precios viven en el arreglo `ITEMS` dentro del
`<script>` de `index.html`. Para una compra nueva, hay que reemplazar ese
arreglo a mano (no hay UI para editar productos todavía).
