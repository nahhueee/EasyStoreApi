export class Genero {
    id?:number;
    descripcion?:string;
    abreviatura?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
          this.abreviatura = data.abreviatura;
        }
    }
}