import { Cliente } from "./Cliente";
import { FacturaVenta } from "./FacturaVenta";
import { Color, TallesProducto } from "./Producto";

  
  export class Venta{
    id?:number;
    idCaja?:number;
    idProceso?:number;
    nroProceso?:number;
    proceso?:string;
    idPunto?:number;
    punto?:string;
    fecha?:Date;
    hora?:string;
    // Fecha de entrega prometida al cliente. Opcional, solo tiene sentido para
    // Presupuesto/Pedido/Nota de Empaque. Ver migración
    // 20260725120000_add_fecha_entrega_ventas.
    fechaEntrega?:Date;
    // idCliente?:number;
    // cliente?:string;
    // clienteRazonSocial?:string;
    // condCliente?:string;
    cliente?:Cliente;
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
    notas?:NotaCreditoVenta[];

    nroRelacionado?:number;
    tipoRelacionado?:string;
    // Texto libre a nivel de venta (ej. motivo de una Nota de Crédito sin
    // productos: "Adelanto de producción"/"Saldo orden de compra"). Ver
    // migración 20260719120000_add_observacion_ventas.
    observacion?:string;
    estado:string = "";
    impaga:number = 0;
    entregado:number = 0;
    deuda:number = 0;
    ajuste:number = 0;
}

  export class ProductosVenta{
    idVenta?:number;
    idProducto? : number;
    // Origen de idProducto: 'CATALOGO' -> tabla productos, 'PRESUPUESTO' ->
    // productos_presupuesto. Ver TipoItemVenta en ventaEstados.ts y la migración
    // 20260801120000_add_tipoitem_ventas_productos. Un ítem PRESUPUESTO no mueve
    // stock, no tiene talles/color y no entra en el descuento general.
    tipoItem?: string;
    // Snapshot del nombre al momento de la venta, solo para ítems no catalogados.
    // Congela lo que se imprimió en el comprobante aunque después renombren el ítem.
    descripcion?: string;
    codProducto?: string;
    nomProducto?: string;
    // Tope de descuento (%) del catálogo. NO se persiste en ventas_productos: se lee de
    // `productos` al armar la respuesta, para que el front pueda aplicar el descuento
    // general respetando el límite del ítem al facturar un Presupuesto/Pedido.
    topeDescuento?: number;
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
    precio?:number;
    precioLista?: number;
    unitario?: number;
    total?: number;
    // Importe de descuento ($) realmente aplicado a esta línea al momento de la
    // venta (respeta el topeDescuento del producto en ese momento, que no se
    // persiste). Se guarda tal cual para que listado-ventas/vista-previa no
    // tengan que reconstruirlo después sin esa información. Ver migración
    // 20260707120000_add_importe_descuento_ventas_items.
    importeDescuento?: number;
    tallesSeleccionados:string = "";
    talles:TallesProducto[] = [];

    constructor(data?: any) {
      if (data) {
        this.idProducto = data.idProducto;
        this.tipoItem = data.tipoItem;
        this.descripcion = data.descripcion;
        this.codProducto = data.codProducto;
        this.topeDescuento = data.topeDescuento;
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
        this.precio = data.precio;
        this.precioLista = data.precioLista;
        this.unitario = data.unitario;
        this.nomProducto = data.nomProducto;
        this.total = data.total;
        this.importeDescuento = data.importeDescuento;
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
    // Ver comentario equivalente en ProductosVenta.topeDescuento. Se lee de `servicios`.
    topeDescuento?: number;
    cantidad?: number;
    unitario?: number;
    total?: number;
    // Ver comentario equivalente en ProductosVenta.importeDescuento.
    importeDescuento?: number;

    constructor(data?: any) {
      if (data) {
        this.idServicio = data.idServicio;
        this.codServicio = data.codServicio;
        this.topeDescuento = data.topeDescuento;
        this.cantidad = data.cantidad;
        this.unitario = data.unitario;
        this.nomServicio = data.nomServicio;
        this.total = data.total;
        this.importeDescuento = data.importeDescuento;
      }
    }
  }

  export class PagosVenta{
    id:number = 0;
    idVenta?:number;
    idMetodo? : number;
    metodo?: string;
    tipo?: string;
    monto?: number;
    idRecibo?:number;
    idVentaPago?: number;  // id del INSERT en ventas_pagos, usado para valores_acreditar
    cheque?: any;          // datos del cheque cuando tipo === 'CHEQUE'

    constructor(data?: any) {
      if (data) {
        this.idMetodo = data.idMetodo;
        this.monto = data.monto;
        this.idRecibo = data.idRecibo;
        this.metodo = data.metodo;
        this.tipo = data.tipo;
        this.cheque = data.cheque;
      }
    }
  }
  
  
  export class NotaCreditoVenta{
    idNotaVenta:number = 0;
    nroProceso:number = 0;
    total:number = 0;
    // Tipo de comprobante de la NC (3/8/13 = fiscal NC A/B/C, 100 = interna/X).
    // Ver TipoComprobante en el front (ObjFacturar.ts) - permite distinguir qué
    // tipo de NC ya se emitió sobre una venta, para bloquear solo la repetida
    // (ago-2026, ver ObtenerNotasVenta).
    idTipoComprobante:number = 0;
  }
  
  
  