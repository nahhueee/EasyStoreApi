import { FacturaVenta } from "./FacturaVenta";
import { Color, TallesProducto } from "./Producto";

  
  export class Venta{
    id?:number;
    idProceso?:number;
    proceso?:string;
    idPunto?:number;
    punto?:string;
    fecha?:Date;
    hora?:string;
    nroNota?:string;
    idCliente?:number;
    cliente?:string;
    idListaPrecio?:number;
    listaPrecio?:string;
    idEmpresa?:number;
    empresa?:string;
    idTipoComprobante?:number;
    tipoComprobante?:string;
    idTipoDescuento?:number;
    tipoDescuento?:string;
    descuento?:number;
    codPromocion?:string;
    redondeo?:number;
    total?:number;
    productos?:ProductosVenta[];
    servicios?:ServiciosVenta[];
    pagos?:PagosVenta[];
    factura?:FacturaVenta;
  }

  export class ProductosVenta{
    idVenta?:number;
    idProducto? : number;
    codProducto?: string;
    nomProducto?: string;
    color?:string;
    hexa?:string;
    cantidad?: number;
    idLineaTalle?:number;
    t1?: number;
    t2?: number;
    t3?: number;
    t4?: number;
    t5?: number;
    t6?: number;
    t7?: number;
    t8?: number;
    t9?: number;
    t10?: number;
    unitario?: number;
    total?: number;
    tallesSeleccionados:string = "";
    talles:TallesProducto[] = [];
  
    constructor(data?: any) {
      if (data) {
        this.idProducto = data.idProducto;
        this.codProducto = data.codProducto;
        this.cantidad = data.cantidad;
        this.idLineaTalle = data.idLineaTalle;
        this.color = data.color;
        this.hexa = data.hexa;
        this.t1 = data.t1;
        this.t2 = data.t2;
        this.t3 = data.t3;
        this.t4 = data.t4;
        this.t5 = data.t5;
        this.t6 = data.t6;
        this.t7 = data.t7;
        this.t8 = data.t8;
        this.t9 = data.t9;
        this.t10 = data.t10;
        this.unitario = data.unitario;
        this.nomProducto = data.nomProducto;
        this.total = data.total;
        this.tallesSeleccionados = data.tallesSeleccionados;
        this.talles = data.talles;
      }
    }
  }

  export class ServiciosVenta{
    idVenta?:number;
    idServicio? : number;
    codServicio?: string;
    nomServicio?: string;
    cantidad?: number;
    unitario?: number;
    total?: number;
  
    constructor(data?: any) {
      if (data) {
        this.idServicio = data.idServicio;
        this.codServicio = data.codServicio;
        this.cantidad = data.cantidad;
        this.unitario = data.unitario;
        this.nomServicio = data.nomServicio;
        this.total = data.total;
      }
    }
  }

  export class PagosVenta{
    idVenta?:number;
    idMetodo? : number;
    metodo?: string;
    monto?: number;
  
    constructor(data?: any) {
      if (data) {
        this.idMetodo = data.idMetodo;
        this.metodo = data.metodo;
        this.monto = data
      }
    }
  }
  
  
  