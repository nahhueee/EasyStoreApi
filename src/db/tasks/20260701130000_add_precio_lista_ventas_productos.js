// Precio de lista en Pedidos (decisión 01-jul-2026).
//
// Habilita editar el precio unitario de un producto al cargar un Pedido (para acordar
// un precio puntual con el cliente antes de facturar), reusando el mismo mecanismo que
// ya existía para Presupuesto. Ver esPresupuesto/permiteEditarPrecio en
// addmod-ventas.component.ts.
//
// ventas_productos.precio guarda el precio final cobrado (equivalente a producto.unitario
// del front). Hasta ahora no había forma de recuperar el precio de lista original una vez
// guardada la venta: producto.precio (el que alimenta calcularPrecioCliente) se calculaba
// en el front pero nunca viajaba a la base. Esta columna lo persiste para poder auditar
// después cuánto se desvió el precio cobrado del de lista.
//
// Nullable y sin backfill: las ventas históricas no tienen forma de reconstruir cuál era
// el precio de lista vigente en su momento, así que quedan en NULL en vez de inventar un
// valor.

exports.up = function (knex) {
    return knex.schema.table('ventas_productos', function (table) {
        table.decimal('precioLista', 10, 2).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.table('ventas_productos', function (table) {
        table.dropColumn('precioLista');
    });
};
