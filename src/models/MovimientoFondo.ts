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
        | 'ACREDITACION_VALOR' = 'VENTA';
    idEmpresa?: number | null;
    idReferencia?: number | null;
    monto: number = 0;
    descripcion?: string | null;
    usuario?: string | null;
    observaciones?: string;
}
