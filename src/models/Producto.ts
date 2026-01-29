export class Producto {
    id : number = 0;
    codigo? : string;
    nombre? : string;
    empresa?: string;
    cliente?: number;
    proceso?: number;
    tipo?: TipoProducto;
    subtipo?: SubtipoProducto;
    genero?: Genero;
    temporada?: Temporada;
    material?: Material;
    color?: Color;
    moldeleria?: number;
    topeDescuento?: number;
    imagen: string = "";
    talles?: TallesProducto[];
    relacionados?: Relacionado[];

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.codigo = data.codigo;
          this.nombre = data.nombre;
          this.empresa = data.empresa;
          this.cliente = data.cliente;
          this.proceso = data.proceso;
          this.tipo = data.tipo;
          this.subtipo = data.subtipo;
          this.genero = data.genero;
          this.material = data.material;
          this.color = data.color;
          this.moldeleria = data.moldeleria;
          this.topeDescuento = data.topeDescuento;
          this.temporada = data.temporada;
          this.talles = Array.isArray(data.talles) ? data.talles.map((talleData: any) => new TallesProducto(talleData)) : [];
          this.relacionados = Array.isArray(data.relacionados) ? data.relacionados.map((relacionadoData: any) => new Relacionado(relacionadoData)) : [];
        } 
    }
}
export class TablaProducto {
    id : number = 0;
    codigo? : string;
    nombre? : string;
    proceso?: string;
    abrevProceso?: string;
    tipo?: string;
    subtipo?: string;
    genero?: string;
    abrevGenero?: string;
    temporada?: string;
    abrevTemporada?: string;
    material?: string;
    color?: string;
    hexa?:string;
    moldeleria?: number;
    imagen?: string;

    constructor(data?: any) {
        if (data) {
            this.id = data.id;
            this.codigo = data.codigo;
            this.nombre = data.nombre;
            this.proceso = data.proceso;
            this.abrevProceso = data.abrevProceso;
            this.tipo = data.tipo;
            this.subtipo = data.subtipo;
            this.genero = data.genero;
            this.abrevGenero = data.abrevGenero;
            this.temporada = data.temporada;
            this.abrevTemporada = data.abrevTemporada;
            this.material = data.material;
            this.color = data.color;
            this.hexa = data.hexa;
            this.moldeleria = data.moldeleria;
            this.imagen = data.imagen;

            const factor = this.proceso === "PEDIDOS APROBADOS" ? -1 : 1;
            const columnasTalles = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
            
            columnasTalles.forEach((talle, index) => {
                this[`t${index + 1}`] = parseInt(data[talle] || '0') * factor;
            });

            this.total = columnasTalles.reduce((acc, col) => {
                const valor = parseInt(data[col] || '0');
                return acc + (valor * factor);
            }, 0);
        }
    }

    t1:number = 0;
    t2:number = 0;
    t3:number = 0;
    t4:number = 0;
    t5:number = 0;
    t6:number = 0;
    t7:number = 0;
    t8:number = 0;
    t9:number = 0;
    t10:number = 0;

    total:number = 0;
}

export class ExcelProducto {
    Proceso?: string;
    Codigo? : string;
    Nombre? : string;
    Producto?: string;
    Tipo?: string;
    Genero?: string;
    Material?: string;
    Color?: string;

    XS:number = 0;
    S:number = 0;
    M:number = 0;
    L:number = 0;
    XL:number = 0;
    XXL:number = 0;
    ["3XL"]:number = 0;
    ["4XL"]:number = 0;
    ["5XL"]:number = 0;
    ["6XL"]:number = 0;

    Total:number = 0;
}

export class TipoProducto {
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
export class SubtipoProducto {
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
export class Temporada {
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
export class LineasTalle {
    id?:number;
    talles?:string[] = [];

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.talles = data.talles;
        }
    }
}
export class Material {
    id?:number;
    descripcion?:string;
    colores?:Color[] = []

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.descripcion = data.descripcion;
        }
    }
}
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

export class TallesProducto {
    id:number = 0;
    idProducto:number = 0;
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

export class Relacionado {
    idProducto?:number;
    color?:Color;
    
    constructor(data?: any) {
        if (data) {
          this.idProducto = data.idProducto;
          this.color = data.color;
        }
    }
}