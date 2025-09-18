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