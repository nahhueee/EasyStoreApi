// Snapshot de costo por línea de venta (B4-209, Fase 2).
//
// costoUnitario: promedio ponderado del costo de talles_producto al momento de
// facturar (ver ResolverCostoUnitarioLinea en ventasRepository.ts) - NUNCA se
// recalcula contra el costo actual del maestro después. NULL, no 0: distingue
// "sin costo cargado en el momento de la venta" de "cuesta cero", tanto para
// las líneas históricas (todas NULL, sin backfill - no hay forma honesta de
// reconstruirlas) como para las nuevas cuyo talle todavía no tiene costo.
//
// Solo se completa en Agregar() (venta nueva). En Modificar() queda sin tocar
// a propósito: esa función borra y reinserta TODAS las líneas de
// ventas_productos en cada guardado, incluso para una venta ya facturada
// (no hay ningún guard que lo impida, y el front la usa así - ver
// this.modificando en addmod-ventas.component.ts). Recalcular ahí violaría la
// decisión de que el margen de una venta ya facturada no se mueve si después
// cambia el costo del maestro. Ver handoff B4-209 Fase 2 para la discusión
// completa y las opciones para cerrar esto correctamente (round-trip del
// valor ya cargado a través del front, no implementado todavía).

exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas_productos
      ADD COLUMN costoUnitario DECIMAL(10,2) NULL DEFAULT NULL
        COMMENT 'snapshot ponderado de talles_producto.costo al facturar - ver ResolverCostoUnitarioLinea'
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas_productos DROP COLUMN costoUnitario
  `);
};
