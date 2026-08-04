// Discriminador de origen para cada línea de ventas_productos + snapshot del
// nombre del ítem al momento de la venta.
//
// Motivo: `ventas_productos.idProducto` es una FK polimórfica SIN discriminador.
// Puede apuntar a `productos` (catálogo real) o a `productos_presupuesto` (ítems
// libres), y la única desambiguación era mirar `ventas.idProceso`:
//
//     ObtenerProductosVenta (ventasRepository.ts):
//       if (idProceso == 5) INNER JOIN productos_presupuesto
//       else                INNER JOIN productos
//
// Esa heurística se rompe justo cuando un Presupuesto se factura:
// ConfirmarFacturacionRelacionado (addmod-ventas.component.ts) copia las líneas
// tal cual a una venta nueva con idProceso 1/2, la venta deja de ser presupuesto,
// pero las líneas siguen apuntando a productos_presupuesto. Dos fallas distintas:
//
//   A) Con comprobante fiscal: al guardar corre ActualizarInventario, que busca la
//      línea de talle del producto. Un ítem de presupuesto no tiene talles ->
//      ObtenerLineaDeTalle devuelve undefined -> TypeError -> rollback. El CAE ya
//      se pidió a AFIP ANTES de guardar (ver comentario en Guardar(), addmod-ventas)
//      => comprobante fiscal emitido y sin registro en el sistema.
//   B) Sin comprobante fiscal (Cotización/Ticket X): guarda bien y la línea queda
//      mal grabada en silencio. El nombre se lee del JOIN contra `productos`, así
//      que se imprime OTRO producto (o la línea desaparece si el id no existe).
//
// Diagnóstico contra la base real (ago-2026, ver "Diagnostico items presupuesto en
// ventas facturadas - ago-2026.sql"): NINGUNA venta afectada todavía - nunca se
// facturó un presupuesto. Pero los 2 ítems de productos_presupuesto que existen
// colisionan LOS DOS con ids de `productos` (catálogo de 1186 filas), así que la
// primera vez que se use el circuito falla con probabilidad 1. Esta migración es
// preventiva: no hay datos que reparar.
//
// `descripcion` es un snapshot del nombre al momento de facturar. Arregla además
// algo colateral que ya existía en el catálogo real: si se renombra un producto,
// hoy cambia retroactivamente lo que muestra una factura ya emitida.
//
// Backfill: marca como PRESUPUESTO las líneas de las ventas con idProceso=5.
// Seguro según la query 6 del diagnóstico (sanity check inverso), que confirmó que
// no hay ventas idProceso=5 con líneas apuntando al catálogo real - o sea, no hay
// contaminación en la dirección contraria que el UPDATE pudiera etiquetar mal.

const TIPO_ITEM_CATALOGO = 'CATALOGO';
const TIPO_ITEM_PRESUPUESTO = 'PRESUPUESTO';
const ID_PROCESO_PRESUPUESTO = 5;

exports.up = function (knex) {
  return knex.schema
    .table('ventas_productos', function (table) {
      // NOT NULL con default: toda línea existente y toda línea nueva que no lo
      // setee explícitamente queda como CATALOGO, que es el comportamiento actual.
      table.string('tipoItem', 12).notNullable().defaultTo(TIPO_ITEM_CATALOGO);
      // Nullable a propósito: solo se llena para líneas no catalogadas. Para las de
      // catálogo el nombre sigue saliendo del JOIN, para no tocar el flujo que ya
      // funciona ni migrar 1186 productos de historia.
      table.string('descripcion', 150).nullable();
    })
    .then(() =>
      knex('ventas_productos')
        .update({ tipoItem: TIPO_ITEM_PRESUPUESTO })
        .whereIn(
          'idVenta',
          knex('ventas').select('id').where('idProceso', ID_PROCESO_PRESUPUESTO)
        )
    );
};

exports.down = function (knex) {
  return knex.schema.table('ventas_productos', function (table) {
    table.dropColumn('tipoItem');
    table.dropColumn('descripcion');
  });
};
