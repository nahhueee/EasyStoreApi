export class SubtipoProducto {
    id?:number;
    descripcion?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
        }
    }
}