export class TallesProducto {
    id?:number;
    talle?:string;
    idLineaTalle?:number;
    cantidad?:number;
    costo?:number;
    precio?:number;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.talle = data.talle;
          this.cantidad = data.cantidad;
          this.costo = data.costo;
          this.precio = data.precio;
          this.idLineaTalle = data.idLineaTalle;
        }
    }
}