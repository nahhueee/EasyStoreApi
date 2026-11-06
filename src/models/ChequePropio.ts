// Datos del cheque propio (chequera física o eCheq) que viajan dentro de una pierna de pago de Compras.
// El importe NO va acá: es el monto de la pierna.
export class ChequePropioDTO {
    idFondoBanco: number = 0; // cuenta de la que se libra (fondo BANCARIO de la empresa)
    tipo: 'FISICO' | 'ECHEQ' = 'FISICO';
    numero: string = '';
    fechaEmision: string = ''; // YYYY-MM-DD
    fechaPago: string = '';    // YYYY-MM-DD
    observaciones?: string;
}
