// Agrega observacionBaja a proveedores para soportar DarBajaProveedor (ago-2026), mismo
// campo que ya tiene clientes.observacionBaja (ver migración de dar-de-baja-cliente) — permite
// guardar el motivo obligatorio que carga el usuario al dar de baja un proveedor duplicado/erróneo.
exports.up = function (knex) {
  return knex.schema.table('proveedores', function (table) {
    table.string('observacionBaja', 300).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table('proveedores', function (table) {
    table.dropColumn('observacionBaja');
  });
};
