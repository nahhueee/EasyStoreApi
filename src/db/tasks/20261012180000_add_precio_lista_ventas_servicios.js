// Precio de catalogo ancla en servicios de ventas (12-oct-2026).
//
// Bug: al facturar una Nota de Empaque / Pedido / Presupuesto con servicios en Factura A/B para un
// cliente mayorista con lista propia, el servicio no recibia el +21% (ventas_servicios no guardaba el
// precio de catalogo, asi que el front no tenia ancla desde donde recalcular - ver
// RecalcularPreciosSegunComprobante en addmod-ventas.component.ts) y la factura salia corta.
//
// Espejo de 20260701130000_add_precio_lista_ventas_productos: nullable y SIN backfill. En listas
// fijas (4.0/4.5/5.0) ventas_servicios.precio ya trae el % horneado, por lo que no se puede
// reconstruir el catalogo sin riesgo de descontar dos veces. Las filas historicas quedan en NULL y
// se comportan como hasta ahora.

exports.up = function (knex) {
    return knex.schema.table('ventas_servicios', function (table) {
        table.decimal('precioLista', 10, 2).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.table('ventas_servicios', function (table) {
        table.dropColumn('precioLista');
    });
};
