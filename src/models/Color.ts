export class Color {
    id?:number;
    descripcion?:string;
    hexa?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
          this.hexa = data.hexa;
        }
    }
}