// FASE 2.1 — Multi-método de pago en Compras (decisión 24-jun-2026).
//
// Reemplaza compras.idMetodoPago (FK única, todo-o-nada) por una tabla hija
// compras_metodos_pago (idCompra, idMetodoPago, monto): una compra puede combinar
// N métodos (ej: parte efectivo + parte cuenta corriente + parte saldo a favor).
//
// No confundir con compras_pagos_proveedor_metodos (esa es del circuito de PAGO de
// deuda ya generada, ver PagarProveedor en comprasCuentasRepository.ts). Esta tabla
// nueva es del circuito de ALTA de la compra (comprasRepository.Agregar).
//
// Backfill: hasta esta migración cada compra tenía un único idMetodoPago cubriendo el
// 100% de su total, así que se migra 1:1 (1 fila por compra) ANTES de dropear la
// columna vieja, para no perder esa información.

exports.up = function (knex) {
    return knex.schema
        .createTable('compras_metodos_pago', function (table) {
            table.bigIncrements('id').unsigned().primary();
            table.bigInteger('idCompra').unsigned().notNullable();
            table.integer('idMetodoPago').unsigned().notNullable();
            table.decimal('monto', 12, 2).notNullable();
        })
        // Backfill: una fila por cada compra que ya tenía un método asignado.
        // Compras con idMetodoPago NULL (no debería haber ninguna - Agregar() lo exige
        // desde F1 - pero por si hay datos de prueba sueltos) no generan fila.
        .then(() => knex.raw(`
            INSERT INTO compras_metodos_pago (idCompra, idMetodoPago, monto)
            SELECT id, idMetodoPago, total
            FROM compras
            WHERE idMetodoPago IS NOT NULL
        `))
        .then(() => knex.schema.table('compras', function (table) {
            table.dropColumn('idMetodoPago');
        }));
};

exports.down = function (knex) {
    return knex.schema
        .table('compras', function (table) {
            table.integer('idMetodoPago').unsigned().nullable();
        })
        // Solo reconstruye 1:1 de forma exacta si cada compra tiene una única fila en
        // compras_metodos_pago (el caso histórico, anterior a esta migración). Si para
        // el momento del rollback ya existen compras multi-método reales, este UPDATE
        // les asigna el método de la PRIMERA fila (MIN(id)) y se pierde el desglose del
        // resto - el down() de esta migración deja de ser lossless en cuanto el feature
        // esté en uso real. Está pensado para revertir antes de eso, no después.
        .then(() => knex.raw(`
            UPDATE compras c
            INNER JOIN (
                SELECT idCompra, idMetodoPago
                FROM compras_metodos_pago
                WHERE id IN (SELECT MIN(id) FROM compras_metodos_pago GROUP BY idCompra)
            ) cmp ON cmp.idCompra = c.id
            SET c.idMetodoPago = cmp.idMetodoPago
        `))
        .then(() => knex.schema.dropTableIfExists('compras_metodos_pago'));
};
