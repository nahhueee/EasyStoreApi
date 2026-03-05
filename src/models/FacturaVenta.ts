import { TipoComprobante } from "./objFacturar";

export class FacturaVenta{
    idVenta?:number;
    cae?: string;
    caeVto?: Date;
    ticket? : number;
    tipoComprobante? : number;
    desComprobante?: string;
    neto? : number;
    iva? : number;
    dni? : number;
    tipoDni? : number;
    ptoVenta? : number;
    condReceptor? : number;

    comprobanteAsociado?: {
      tipo: TipoComprobante;
      puntoVenta: number;
      numero: number;
    };

    constructor(data?: any) {
      if (data) {
        this.cae = data.cae;
        this.caeVto = data.caeVto;
        this.ticket = data.ticket;
        this.tipoComprobante = data.tipoComprobante;
        this.desComprobante = data.desComprobante;
        this.neto = data.neto;
        this.iva = data.iva;
        this.dni = data.dni;
        this.tipoDni = data.tipoDni;
        this.ptoVenta = data.ptoVenta;
        this.condReceptor = data.condReceptor;
        this.comprobanteAsociado = data.comprobanteAsociado;
      }
    }
}
  
  