export class StockMovimiento {
    id?: number;
    idProducto: number = 0;
    talle: string = '';
    idTalle?: number | null;
    cantidadAnterior: number = 0;
    cantidadNueva: number = 0;
    diferencia: number = 0;
    motivo: string = '';
    usuario?: string;
    alta?: Date;
    baja?: Date | null;
    motivoBaja?: string | null;
    usuarioBaja?: string | null;

    // Campos calculados (JOIN), solo presentes en el listado - no existen como columnas propias.
    producto?: string;
    codigoProducto?: string;
    colorProducto?: string;
    hexaProducto?: string;
}
