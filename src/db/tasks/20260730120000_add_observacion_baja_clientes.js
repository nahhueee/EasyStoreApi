// Ver HANDOFF-dar-de-baja-cliente.md para el diseño completo de DarBajaCliente.
//
// Columna nueva para guardar el motivo de la baja lógica de un cliente
// (clientes.fechaBaja ya existía). Se llama `observacionBaja` y no
// `observaciones` a propósito: `clientes` hoy no tiene ningún campo de notas
// general, y llamarlo `observaciones` invitaría a reusarlo como nota del
// cliente y que después la baja lo pise (mismo antipatrón que
// `recibos.observaciones`, que es dual-propósito).
exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE clientes
      ADD COLUMN observacionBaja varchar(250) DEFAULT NULL AFTER fechaBaja
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE clientes
      DROP COLUMN observacionBaja
  `);
};
