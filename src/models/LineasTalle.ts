export class LineasTalle {
    id?:number;
    descripcion?:string;
    mostrar?:number;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
          this.mostrar = data.mostrar;
        }
    }
}