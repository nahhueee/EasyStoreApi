export class Empresa {
    id?:number;
    razonSocial?:string;
    condicion?:string;
    puntoVta?:number;
    cuil?:number;
    direccion?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.razonSocial = data.razonSocial;
          this.condicion = data.condicion;
          this.puntoVta = data.puntoVta;
          this.cuil = data.cuil;
          this.direccion = data.direccion;
        }
    }
}