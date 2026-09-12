export class Cliente {
    id?:number;
    nombre?:string;
    razonSocial?:string;
    telefono?:string;
    celular?:string;
    contacto?:string;
    email?:string;
    idCondicionIva?:number;
    condicionIva?:string;
    idTipoDocumento?:number;
    tipoDocumento?:string;
    documento?:number;
    idListaPrecio?:number;
    listaPrecio?:string;
    idCondicionPago?:number;
    condicionPago?:string;
    idCategoria?:number;
    inicial?:number;
    fechaAlta?:Date;
    // Plazo de pago habitual del cliente, en días. Se usa para calcular
    // ventas.fechaVencimiento al emitir Factura/Cotización (fecha emisión +
    // diasVencimiento). 0 = no configurado (sin vencimiento). Ver migración
    // 20260912120000_add_vencimiento_clientes_ventas.
    diasVencimiento?:number;
    direcciones?:DireccionesCliente[];
    ultimoDescuento?:UltimoDescuentoCliente;
}

export class DireccionesCliente {
    id?:number;
    idCliente?:number;
    resumen?:string;
    codPostal?:string;
    calle?:string;
    numero?:string;
    localidad?:string;
    provincia?:string;
    observaciones?:string;
}

export class UltimoDescuentoCliente {
    descuento?:number;
    idTipoDescuento?:number;
    tipoDescuento?:string;
}

