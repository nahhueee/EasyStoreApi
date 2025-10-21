export class Cliente {
    id?:number;
    nombre?:string;
<<<<<<< HEAD
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
=======
    email?:string;
    telefono?:string

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.nombre = data.nombre;
          this.email = data.email;
          this.telefono = data.telefono;
        }
    }
>>>>>>> 7fa8955031b96a6a37f42603020dbffc90e5b23e
}