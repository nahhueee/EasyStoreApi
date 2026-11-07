import { ChequePropioDTO } from './ChequePropio';

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
    observacionBaja?:string; // motivo obligatorio de la baja (nov-2026)
    usuarioBaja?:string;
    detalle?:DetalleCompra[];
    iva?:CompraIva[];
    percepcionesIibb?:CompraPercepcionIibb[];
    pagos?:PagoCompra[]; // multi-método (decisión 24-jun-2026); reemplaza la antigua FK única idMetodoPago
}

export class PagoCompra {
    idMetodo?:number;
    metodo?:string; // solo en lectura (ObtenerUna); no se usa al guardar
    monto?:number;
    cheque?:ChequePropioDTO; // solo con método CHEQUE_PROPIO: datos del cheque a emitir (importe = monto)
    idValorAcreditar?:number; // solo con método CHEQUE: cheque de terceros PENDIENTE a endosar (monto = su importe)
    detalleCheque?:string | null; // solo en lectura (ObtenerUna): descripción del cheque propio emitido / endosado
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
