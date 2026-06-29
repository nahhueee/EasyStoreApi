exports.up = function(knex) {
  return knex.schema
    .createTable('alicuotas_iva', function (table) {
      table.integer('id').unsigned().primary();
      table.string('descripcion', 20).notNullable();
      table.decimal('tasa', 5, 4).notNullable();
      table.tinyint('activa').defaultTo(1);
    })
    .then(() => knex('alicuotas_iva').insert([
      { id: 1, descripcion: '21%',    tasa: 0.2100, activa: 1 },
      { id: 2, descripcion: '10,5%',  tasa: 0.1050, activa: 1 },
      { id: 3, descripcion: '27%',    tasa: 0.2700, activa: 1 },
      { id: 4, descripcion: '5%',     tasa: 0.0500, activa: 0 },
      { id: 5, descripcion: '2,5%',   tasa: 0.0250, activa: 0 },
      { id: 6, descripcion: 'Exento', tasa: 0.0000, activa: 0 }
    ]))
    .then(() => knex.schema.createTable('compras', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.integer('idEmpresa').unsigned().notNullable();
      table.integer('idProveedor').unsigned().notNullable();
      table.integer('idCaja').unsigned().notNullable();
      table.integer('idMetodoPago').unsigned().nullable();
      table.date('fecha').notNullable();
      table.integer('idTipoComprobante').unsigned().notNullable();
      table.string('nroComprobante', 20);
      table.decimal('totalNeto', 12, 2).notNullable().defaultTo(0);
      table.decimal('totalIva', 12, 2).notNullable().defaultTo(0);
      table.decimal('totalIibb', 12, 2).notNullable().defaultTo(0);
      table.decimal('tasaMunicipal', 12, 2).notNullable().defaultTo(0);
      table.decimal('percepcionIva', 12, 2).notNullable().defaultTo(0);
      table.decimal('retencionGanancia', 12, 2).notNullable().defaultTo(0);
      table.decimal('total', 12, 2).notNullable().defaultTo(0);
      table.string('estado', 15).notNullable().defaultTo('Aprobada');
      table.string('usuario', 15);
      table.timestamp('alta').defaultTo(knex.fn.now());
      table.datetime('baja').nullable();
    }))
    .then(() => knex.schema.createTable('detalle_compras', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('idCompra').unsigned().notNullable();
      table.decimal('cantidad', 10, 2).notNullable();
      table.string('concepto', 150).notNullable();
      table.decimal('importe', 12, 2).notNullable();
    }))
    .then(() => knex.schema.createTable('compras_iva', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('idCompra').unsigned().notNullable();
      table.integer('idAlicuota').unsigned().notNullable();
      table.decimal('importe', 12, 2).notNullable();
    }))
    .then(() => knex.schema.createTable('compras_percepciones_iibb', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('idCompra').unsigned().notNullable();
      table.string('provincia', 100).notNullable();
      table.decimal('importe', 12, 2).notNullable();
    }));
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('compras_percepciones_iibb')
    .then(() => knex.schema.dropTableIfExists('compras_iva'))
    .then(() => knex.schema.dropTableIfExists('detalle_compras'))
    .then(() => knex.schema.dropTableIfExists('compras'))
    .then(() => knex.schema.dropTableIfExists('alicuotas_iva'));
};
