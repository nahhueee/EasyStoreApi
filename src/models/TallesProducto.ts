export class TallesProducto {
    id:number = 0;
    idProducto?:number;
    ubicacion?:number;
    talle?:string;
    idLineaTalle?:number;
    cantidad?:number;
    precio?:number;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.idProducto = data.idProducto;
          this.ubicacion = data.ubicacion;
          this.talle = data.talle;
          this.cantidad = data.cantidad;
          this.precio = data.precio;
          this.idLineaTalle = data.idLineaTalle;
        }
    }
}