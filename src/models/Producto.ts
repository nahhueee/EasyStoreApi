import { Color } from "./Color";
import { Genero } from "./Genero";
import { Material } from "./Material";
import { Proceso } from "./Proceso";
import { SubtipoProducto } from "./SubtipoProducto";
import { TallesProducto } from "./TallesProducto";
import { TipoProducto } from "./TipoProducto";

export class Producto {
    id : number = 0;
    codigo? : string;
    nombre? : string;
    proceso?: Proceso;
    tipo?: TipoProducto;
    subtipo?: SubtipoProducto;
    genero?: Genero;
    material?: Material;
    color?: Color;
    moldeleria?: number;
    imagen?: string;
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