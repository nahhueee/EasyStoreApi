export class ProductoPresupuesto{
  id?: number = 0;
  codigo?: string = "";
  nombre?: string = "";
  sugerido?: number = 0;

  constructor(data?: any) {
    if (data) {
        this.id = data.id;
        this.codigo = data.codigo;  
        this.nombre = data.nombre;
        this.sugerido = data.sugerido;
    }
  }
}

