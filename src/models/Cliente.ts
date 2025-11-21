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
    idCondicionPago?:number;
    condicionPago?:string;
    idCategoria?:number;
    fechaAlta?:Date;
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

