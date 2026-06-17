export class Proveedor {
    id?:number;
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
    fechaAlta?:Date;
    direcciones?:DireccionesProveedor[];
}

export class DireccionesProveedor {
    id?:number;
    idProveedor?:number;
    resumen?:string;
    codPostal?:string;
    calle?:string;
    numero?:string;
    localidad?:string;
    provincia?:string;
    observaciones?:string;
}