export class Compra {
    id?:number;
    idEmpresa?:number;
    idProveedor?:number;
    proveedor?:string;
    condicionIvaProveedor?:string;
    idCaja?:number;
    metodoPago?:string; // resumen para listado/detalle, ver ObtenerQuery (GROUP_CONCAT sobre compras_metodos_pago)
    fecha?:Date;
    idTipoComprobante?:number;
    tipoComprobante?:string;
    nroComprobante?:string;
    totalNeto?:number;
    totalIva?:number;
    totalIibb?:number;
    tasaMunicipal?:number;
    percepcionIva?:number;
    retencionGanancia?:number;
    total?:number;
    estado?:string;
    usuario?:string;
    alta?:Date;
    baja?:Date;
    detalle?:DetalleCompra[];
    iva?:CompraIva[];
    percepcionesIibb?:CompraPercepcionIibb[];
    pagos?:PagoCompra[]; // multi-método (decisión 24-jun-2026); reemplaza la antigua FK única idMetodoPago
}

export class PagoCompra {
    idMetodo?:number;
    metodo?:string; // solo en lectura (ObtenerUna); no se usa al guardar
    monto?:number;
}

export class DetalleCompra {
    id?:number;
    idCompra?:number;
    cantidad?:number;
    concepto?:string;
    importe?:number;
}

export class CompraIva {
    id?:number;
    idCompra?:number;
    idAlicuota?:number;
    alicuota?:string;
    importe?:number;
}

export class CompraPercepcionIibb {
    id?:number;
    idCompra?:number;
    provincia?:string;
    importe?:number;
}
