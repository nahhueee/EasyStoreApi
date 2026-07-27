export class ObjFacturar {
    total?:number;
    tipoComprobante?: TipoComprobante;    
    docNro?:number;
    docTipo?:number;
    condReceptor?:number;
    idEmpresa?:number;

    // SOLO para Notas
    comprobanteAsociado?: {
        tipo: TipoComprobante;
        puntoVenta: number;
        numero: number;
    };
}

export enum TipoComprobante {
  FACTURA_A = 1,
  ND_A = 2,
  NC_A = 3,

  FACTURA_B = 6,
  ND_B = 7,
  NC_B = 8,

  FACTURA_C = 11,
  ND_C = 12,
  NC_C = 13,

  COTIZACION = 99,
  NC_X = 100,
  // Nota de Débito interna (no fiscal, no pasa por AFIP/ARCA) - análoga a NC_X
  // pero genera saldo deudor en vez de saldo a favor (nota-debito-x.component.ts
  // en el front). Mismo id que TIPO_COMPROBANTE.ND_X en venta.constants.ts - no
  // cambiar sin migración.
  ND_X = 101
}