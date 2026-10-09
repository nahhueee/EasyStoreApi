// Auditoría de la Nota de Empaque como paso de control previo a facturar (pedido del
// cliente, oct-2026 - ver fase 2 del plan "NE como previo a la facturación").
//
// El cliente carga TODO como Nota de Empaque (NE), la controla/aprueba y recién después
// factura. No hay roles de aprobación (decisión de negocio, por ahora cualquier usuario
// puede cargar, modificar y aprobar), así que el control depende de poder reconstruir
// después QUIÉN aprobó y QUIÉN tocó cada NE:
//
//  - usuarioAprobacion / fechaAprobacion: quién y cuándo pasó la NE de Pendiente a
//    Aprobada (PUT /ventas/aprobar). Se limpian a NULL cuando la NE se vuelve a modificar
//    (vuelve a Pendiente y hay que re-aprobarla, ver ModificarBody).
//  - usuarioModificacion / fechaModificacion: último usuario que modificó la NE y cuándo.
//    A diferencia de usuarioAlta (quién la creó, nunca se pisa) esto es "quién la tocó
//    último". Solo se completa para Notas de Empaque; queda NULL para el resto de los
//    procesos y para NE nunca modificadas.
//
// Todas NULL por defecto y sin backfill: lo anterior a esta migración no se puede
// reconstruir de forma honesta (mismo criterio que usuarioAlta). La query de listado
// (ObtenerQuery) ya hace `SELECT v.*`, así que solo hace falta mapearlas en
// CompletarObjeto(). Sin impacto sobre el resto de las lecturas/escrituras de ventas.

exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas
      ADD COLUMN usuarioAprobacion VARCHAR(30) NULL DEFAULT NULL
        COMMENT 'Nota de Empaque: usuario que la aprobo; NULL si esta Pendiente o es otro proceso',
      ADD COLUMN fechaAprobacion DATETIME NULL DEFAULT NULL
        COMMENT 'Nota de Empaque: fecha/hora de la aprobacion vigente',
      ADD COLUMN usuarioModificacion VARCHAR(30) NULL DEFAULT NULL
        COMMENT 'Nota de Empaque: ultimo usuario que la modifico',
      ADD COLUMN fechaModificacion DATETIME NULL DEFAULT NULL
        COMMENT 'Nota de Empaque: fecha/hora de la ultima modificacion'
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas
      DROP COLUMN fechaModificacion,
      DROP COLUMN usuarioModificacion,
      DROP COLUMN fechaAprobacion,
      DROP COLUMN usuarioAprobacion
  `);
};
