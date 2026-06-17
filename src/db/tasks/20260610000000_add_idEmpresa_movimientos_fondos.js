exports.up = function(knex) {
  return knex.schema.table('movimientos_fondos', function (table) {
    table.integer('idEmpresa').unsigned().nullable().after('idFondo')
      .references('id').inTable('empresas').withKeyName('fk_mf_empresa');
  });
};

exports.down = function(knex) {
  return knex.schema.table('movimientos_fondos', function (table) {
    table.dropForeign(['idEmpresa'], 'fk_mf_empresa');
    table.dropColumn('idEmpresa');
  });
};
