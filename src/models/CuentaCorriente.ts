export class CuentaCorriente{
  idCliente: number = 0;
  cliente: string = "";
  debe: number = 0;
  haber: number = 0;
  saldo: number = 0;
  estado: string = "";
  ultimoMovimiento: Date = new Date();
}

export class VentasClienteCuenta{
  id: number = 0;
  nroProceso: number = 0;
  proceso: string = "";
  fecha: Date = new Date();
  comprobante: string = "";
  tipo: string = "";
  debe: number = 0;
  haber: number = 0;
  saldo: number = 0;
  estado: string = "";
  referencia: string = "";
  observaciones: string = "";
}

