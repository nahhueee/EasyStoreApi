import { Color } from "./Color";

export class Material {
    id?:number;
    descripcion?:string;
    colores?:Color[] = []

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
          this.colores = data.colores
        }
    }
}