# TPV LevaDigital

TPV de hostelería de LevaDigital. El servidor se instala en el TPV Windows principal de cada local, y los demás puestos (otros TPV, PDA de camarero y pantallas de cocina) lo usan desde el navegador, en Windows o Android.

Estado: **prototipo v0.1** (paso 2 del plan). La especificación está en el documento *TPV LevaDigital: especificación v1*.

## Qué hace ya

- Venta en barra y en mesas, con plano de mesas por zona (comedor, terraza...).
- Familias, subfamilias, artículos y departamentos.
- Calculadora: unidades antes de tocar el artículo, cambio de unidades (`Un`) y de precio (`€`), detalle para cocina (`Det`) y borrar línea.
- Guardar cuentas, panel de cuentas abiertas y pre-ticket.
- Cobro en efectivo con cálculo del cambio, con tarjeta o pendiente de cobro. Emite una factura simplificada imprimible.
- Tickets numerados seguidos y encadenados con una huella. No se pueden borrar: se anulan con un ticket en negativo.
- Resumen de caja por forma de cobro y por familia, y cierre de caja.
- Mantenimiento de artículos, familias, departamentos, zonas, mesas, formas de cobro, operarios y datos de la empresa.
- Todos los puestos se actualizan solos cuando otro hace un cambio.
- Pantalla adaptada a PDA o móvil.

Queda para los siguientes pasos: CashDro, impresoras de red y KDS (paso 3); TicketBAI/Verifactu y sincronización con la nube (paso 4).

## Requisitos

- [Node.js](https://nodejs.org) 22.18 o posterior (recomendado el 24 LTS). No hace falta instalar nada más: la base de datos es SQLite y viene con Node.

## Arrancar

```bash
npm start
```

Abre `http://localhost:8080` en el propio PC. La consola muestra también la dirección para las PDA y tablets del local, por ejemplo `http://192.168.1.20:8080`.

Opciones (variables de entorno):

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `PUERTO` | `8080` | Puerto del servidor |
| `DATOS` | `./datos` | Carpeta donde se guarda `tpv.db` |

En Windows (PowerShell): `$env:PUERTO=9000; npm start`.

La primera vez se crea un bar de ejemplo con artículos, zonas y mesas para poder probar.

## Pruebas

```bash
npm test
```

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `server/` | Servidor: base de datos (`db.ts`), ventas y caja (`ventas.ts`), mantenimiento (`gestion.ts`), API (`app.ts`) y arranque (`main.ts`) |
| `public/` | Aplicación web: `index.html`, `app.js`, `styles.css` |
| `test/` | Pruebas automáticas |

Los importes se guardan siempre en céntimos y con IVA incluido.
