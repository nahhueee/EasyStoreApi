export class Cliente {
    id?:number;
    nombre?:string;
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
}