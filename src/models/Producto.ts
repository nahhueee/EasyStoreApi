import { TallesProducto } from "./TallesProducto";
export class Producto {
    id : number = 0;
    codigo? : string;
    nombre? : string;
    empresa?: string;
    cliente?: number;
    proceso?: number;
    tipo?: number;
    subtipo?: number;
    genero?: number;
    temporada?: number;
    material?: number;
    color?: number;
    moldeleria?: number;
    imagen: string = "";
    talles?: TallesProducto[];
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

    t1:string = "";
    t2:string = "";
    t3:string = "";
    t4:string = "";
    t5:string = "";
    t6:string = "";
    t7:string = "";
    t8:string = "";
    t9:string = "";
    t10:string = "";

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

    XS:string = "";
    S:string = "";
    M:string = "";
    L:string = "";
    XL:string = "";
    XXL:string = "";
    ["3XL"]:string = "";
    ["4XL"]:string = "";
    ["5XL"]:string = "";
    ["6XL"]:string = "";

    Total:number = 0;
}