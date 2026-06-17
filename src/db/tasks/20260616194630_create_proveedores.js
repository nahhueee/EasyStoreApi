exports.up = function(knex) {
  return knex.schema
    .createTable('proveedores', function (table) {
      table.increments('id').unsigned().primary();
      table.string('razonSocial', 100);
      table.string('telefono', 20);
      table.string('celular', 20);
      table.string('contacto', 100);
      table.string('email', 100);
      table.integer('idCondIva');
      table.integer('idTipoDocumento');
      table.bigInteger('documento');
      table.timestamp('fechaAlta').defaultTo(knex.fn.now());
      table.date('fechaBaja').nullable();
    })
    .then(() => knex.schema.createTable('direcciones_proveedor', function (table) {
      table.increments('id').unsigned().primary();
      table.integer('idProveedor');
      table.string('resumen', 300);
      table.string('codPostal', 10);
      table.string('calle', 150);
      table.string('numero', 10);
      table.string('localidad', 100);
      table.string('provincia', 100);
      table.string('observaciones', 300);
    }));
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('direcciones_proveedor')
    .then(() => knex.schema.dropTableIfExists('proveedores'));
};
