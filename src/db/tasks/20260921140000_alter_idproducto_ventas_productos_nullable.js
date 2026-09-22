// idProducto en ventas_productos era NOT NULL desde el schema original, aunque el
// diseño de tipoItem (migración 20260801120000) ya documentaba que un ítem no
// catalogado no necesariamente tiene una fila real detrás - hasta ahora todo ítem
// PRESUPUESTO seguía apuntando a una fila real de productos_presupuesto, así que
// nunca se probó con NULL.
//
// HANDOFF-recargo-transferencia-10.md: la línea de "Recargo transferencia 10%" es
// un concepto, no un producto ni un ítem de presupuesto real (no tiene código,
// no tiene fila en ningún catálogo) - ver §5.e del handoff. Forzarla a apuntar a
// una fila ficticia en productos_presupuesto solo para satisfacer el NOT NULL
// agrega una tabla de mentira a mantener y un id mágico que hay que conocer desde
// el front. idProducto NULL + tipoItem=PRESUPUESTO ya es exactamente lo que
// ObtenerProductosVenta (ventasRepository.ts) espera para una línea sin catálogo:
// los dos LEFT JOIN (cat/pre) simplemente no matchean y el nombre sale de
// `descripcion` (fallback ya implementado, sin cambios necesarios ahí).
//
// Sin FOREIGN KEY declarada sobre esta columna (ver CREATE TABLE en script.sql) -
// relajar a nullable no rompe integridad referencial en ningún otro lado.
//
// Bug real que motiva esto: guardar una venta con el recargo tildado rompía con
// "Column 'idProducto' cannot be null" DESPUÉS de haber pedido el CAE a AFIP
// (facturar y agregar son dos pasos HTTP separados) - comprobante fiscal emitido
// sin venta guardada localmente. 21/09/2026.
exports.up = function (knex) {
  return knex.schema.alterTable('ventas_productos', function (table) {
    table.integer('idProducto').nullable().alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('ventas_productos', function (table) {
    table.integer('idProducto').notNullable().alter();
  });
};
