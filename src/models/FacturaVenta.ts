import { TipoComprobante } from "./objFacturar";

export class FacturaVenta{
    idVenta?:number;
    // F3 - HANDOFF blindaje facturacion y logs. Id de la fila fe_emisiones creada por
    // FacturacionService.Facturar() para este comprobante. Agregar/Modificar la usan para
    // vincular fe_emisiones.idVenta dentro de su propia transaccion (ver VentasRepository).
    idEmision?: number;
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
        this.idEmision = data.idEmision;
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
  
  