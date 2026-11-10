import ExcelJS from 'exceljs';
import moment from 'moment';

// Excel de saldos de cuentas corrientes de proveedores. Espejo de excelCuentasService (clientes), con las columnas
// de la grilla de Cuentas Corrientes - Proveedores. Convención: Saldo > 0 = se le debe al proveedor ("Debemos").
export async function crearExcelCuentasProveedores(data: any[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cuentas Proveedores');

  // Mismo celeste claro que excelCuentasService / excelClientesService
  const estiloHeader = {
    font: { bold: true },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFDDEBF7' }
    }
  };

  const columnas = [
    "Cod. Proveedor", "Proveedor", "Saldo Inicial", "Deuda", "Saldo a Favor", "Saldo", "Estado", "Ult. Movimiento"
  ];

  columnas.forEach((titulo, colIndex) => {
    const cell = worksheet.getCell(1, colIndex + 1);
    cell.value = titulo;
    Object.assign(cell, estiloHeader);
  });

  data.forEach((c, rowIndex) => {
    const fila = [
      c.idProveedor ?? "",
      c.proveedor || "",
      c.saldoInicial ?? 0,
      c.deuda ?? 0,
      c.saldoAFavor ?? 0,
      c.saldo ?? 0,
      c.estado || "",
      c.ultimoMovimiento ? moment(c.ultimoMovimiento).format('DD/MM/YYYY') : ""
    ];

    fila.forEach((valor, colIndex) => {
      worksheet.getCell(rowIndex + 2, colIndex + 1).value = valor;
    });
  });

  for (let i = 1; i <= columnas.length; i++) {
    const column = worksheet.getColumn(i);
    let maxLength = 0;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });

    column.width = maxLength < 10 ? 10 : maxLength + 2;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
