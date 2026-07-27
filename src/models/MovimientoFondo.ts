export class MovimientoFondo {
    idCaja: number = 0;
    idFondo: number = 0;
    tipo: 'INGRESO' | 'EGRESO' = 'INGRESO';
    origen:
        | 'VENTA'
        | 'COBRO_CC'
        | 'PAGO_PROVEEDOR'
        | 'RETIRO'
        | 'AJUSTE'
        | 'TRANSFERENCIA'
        | 'INGRESO_MANUAL'
        | 'NOTA_CREDITO'
        | 'EGRESO_MANUAL'
        | 'ACREDITACION_VALOR'
        | 'PAGO_CC_PROVEEDOR' = 'VENTA';
    idEmpresa?: number | null;
    idReferencia?: number | null;
    // Solo se completa para AJUSTE/PAGO_CC_PROVEEDOR: son los únicos orígenes
    // donde idReferencia puede apuntar a más de una tabla según el caso (ver
    // migración 20260727120000_add_tiporeferencia_movimientos_fondos.js). Para
    // el resto de los orígenes, `origen` solo ya alcanza para saber a qué tabla
    // corresponde idReferencia.
    tipoReferencia?: 'VENTA' | 'VENTA_ENTREGA' | 'COMPRA' | 'COMPRA_PAGO_PROVEEDOR' | null;
    monto: number = 0;
    descripcion?: string | null;
    usuario?: string | null;
    observaciones?: string;
}
