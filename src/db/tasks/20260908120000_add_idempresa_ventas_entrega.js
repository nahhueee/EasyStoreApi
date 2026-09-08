// Persiste la empresa que efectivamente cobró una Entrega de Dinero, para que
// DarBajaRecibo() pueda leerla directo en vez de inferirla desde ventas.idEmpresa
// (empresa que FACTURÓ la venta, un concepto distinto). Sin esto, cuando la
// empresa que cobra != empresa de la/s venta/s canceladas (selector de empresa
// del formulario, ver HANDOFF-entrega-dinero-selector-empresa.md) o cuando una
// misma entrega mezcla ventas de más de una empresa, la reversión de la baja
// termina tageada con la empresa equivocada en el arqueo por empresa (caso real:
// recibos #429 y #265, análisis sep-2026).
//
// Columna nueva, nullable: las filas históricas quedan en NULL. DarBajaRecibo()
// hace fallback a la inferencia anterior (desde ventas.idEmpresa) cuando esta
// columna es NULL, así que los recibos viejos no se rompen - solo las Entregas
// de Dinero nuevas, de acá en adelante, quedan taggeadas de forma inequívoca.
exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas_entrega
      ADD COLUMN idEmpresa INT NULL DEFAULT NULL AFTER idCliente
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas_entrega
      DROP COLUMN idEmpresa
  `);
};
