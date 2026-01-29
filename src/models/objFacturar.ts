export class ObjFacturar {
    total?:number;
    neto?:number;
    iva?:number;
    tipoFactura?:number;
    docNro?:number;
    docTipo?:number;
    condReceptor?:number;
    idEmpresa?:number;

    constructor(data?: any) {
        if (data) {
          this.total = data.total;
          this.neto = data.neto;
          this.iva = data.iva;
          this.tipoFactura = data.tipoFactura;
          this.docNro = data.docNro;
          this.docTipo = data.docTipo;
          this.condReceptor = data.condReceptor;
          this.idEmpresa = data.idEmpresa;
        }
    }
}