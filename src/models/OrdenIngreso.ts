export class OrdenIngreso{
  id? : number;
  idProveedor? : number;
  fecha? : Date;
  observaciones: string = "";
  corte: number = 0;
  usuario: string = "";
  actualizacion: Date = new Date();
  alta: Date = new Date();
  estado: string = "";
  productos: ProductoOrden[] = [];
  recepcionesRevertir:any[]=[];

  constructor(data?: any) {
    if (data) {
      this.id = data.id;
      this.idProveedor = data.idProveedor;
      this.fecha = data.fecha;
      this.observaciones = data.observaciones;
      this.corte = data.corte;
      this.usuario = data.usuario;
      this.alta = data.alta;
      this.productos = data.productos;
      this.actualizacion = data.actualizacion;
    }
  }
}

export class ProductoOrden{
    id: number = 0;
    idOrden?: number;
    idProducto? : number;
    codProducto?: string;
    nomProducto?: string;
    topeDescuento?: number;
    idColor?: number;
    color?: string;
    hexa?: string;
    cantidad?: number;
    stockAplicado?: number = 0;
    idLineaTalle?:number;
    estado: "Pendiente" | "Ingresado" | "Incompleto" | "Parcial" = "Pendiente";
    t1?: number;
    t2?: number;
    t3?: number;
    t4?: number;
    t5?: number;
    t6?: number;
    t7?: number;
    t8?: number;
    t9?: number;
    t10?: number;
    tallesSeleccionados:string = "";
    codigosBarra:[] = [];
    recepciones: [] = [];
    baja?: {
        t1: number; t2: number; t3: number; t4: number; t5: number;
        t6: number; t7: number; t8: number; t9: number; t10: number;
        obs: string;
        usuarioBaja: string;
        fechaBaja: Date;
        total: number;
    } | null;
    
    constructor(data?: any) {
        if (data) {
        this.idProducto = data.idProducto;
        this.codProducto = data.codProducto;
        this.cantidad = data.cantidad;
        this.topeDescuento = data.topeDescuento;
        this.idColor = data.idColor;
        this.color = data.color;
        this.hexa = data.hexa;
        this.idLineaTalle = data.idLineaTalle;
        this.t1 = data.t1;
        this.t2 = data.t2;
        this.t3 = data.t3;
        this.t4 = data.t4;
        this.t5 = data.t5;
        this.t6 = data.t6;
        this.t7 = data.t7;
        this.t8 = data.t8;
        this.t9 = data.t9;
        this.t10 = data.t10;
        this.nomProducto = data.nomProducto;
        this.tallesSeleccionados = data.tallesSeleccionados;
        this.codigosBarra = data.codigosBarra;
        this.recepciones = data.recepciones;
        }
    }
    }