import ExcelJS from 'exceljs';
import moment from 'moment';

export async function crearExcelCuentas(data: any[]) {
  // 1. Crear nuevo libro de trabajo
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cuentas Corrientes');

  // 2. Estilo de encabezado (mismo celeste claro usado en excelClientesService)
  const estiloHeader = {
    font: { bold: true },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFDDEBF7' }
    }
  };

  // 3. Encabezados (fila 1)
  const columnas = [
    "Cod. Cliente", "Cliente", "Debe", "Haber", "Saldo", "Estado", "Ult. Movimiento"
  ];

  columnas.forEach((titulo, colIndex) => {
    const cell = worksheet.getCell(1, colIndex + 1);
    cell.value = titulo;
    Object.assign(cell, estiloHeader);
  });

  // 4. Datos (fila 2 en adelante)
  data.forEach((c, rowIndex) => {
    const fila = [
      c.CodCliente || "",
      c.Cliente || "",
      c.Debe ?? 0,
      c.Haber ?? 0,
      c.Saldo ?? 0,
      c.Estado || "",
      c.UltimoMovimiento ? moment(c.UltimoMovimiento).format('DD/MM/YYYY HH:mm') : ""
    ];

    fila.forEach((valor, colIndex) => {
      worksheet.getCell(rowIndex + 2, colIndex + 1).value = valor;
    });
  });

  // 5. Ajustar ancho de columnas automáticamente
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

  // 6. Convertir a buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
