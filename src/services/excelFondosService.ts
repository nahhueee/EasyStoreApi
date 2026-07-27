import ExcelJS from 'exceljs';
import moment from 'moment';

interface MetaExcelFondos {
  // Puede faltar en el período "Todo" con cero movimientos (caso borde: fondo
  // recién creado sin uso todavía) - ver fallback más abajo.
  fechaDesde?: string | null;
  fechaHasta:  string;
  caja?:       string | null;
  fondo?:      string | null;
  usuario?:    string | null;
}

export async function crearExcelMovimientosFondos(data: any[], meta: MetaExcelFondos) {
  // 1. Crear nuevo libro de trabajo
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Movimientos de Fondos');

  const columnas = [
    "Fecha", "Caja", "Fondo", "Tipo", "Origen", "Descripción", "Monto", "Usuario", "Empresa"
  ];

  // 2. Encabezado informativo: período y filtros aplicados (fila 1 y 2), para que
  // el reporte quede autoexplicado si se comparte suelto (impreso, por mail, etc.)
  const tituloCell = worksheet.getCell(1, 1);
  tituloCell.value = 'Movimientos de Fondos';
  tituloCell.font = { bold: true, size: 14 };
  worksheet.mergeCells(1, 1, 1, columnas.length);

  const desdeTexto = meta.fechaDesde
    ? moment(meta.fechaDesde).format('DD/MM/YYYY')
    : 'Inicio (sin movimientos)';

  const partesPeriodo = [
    `Período: ${desdeTexto} - ${moment(meta.fechaHasta).format('DD/MM/YYYY')}`
  ];
  if (meta.caja)    partesPeriodo.push(`Caja: ${meta.caja}`);
  if (meta.fondo)   partesPeriodo.push(`Fondo: ${meta.fondo}`);
  if (meta.usuario) partesPeriodo.push(`Usuario: ${meta.usuario}`);

  const periodoCell = worksheet.getCell(2, 1);
  periodoCell.value = partesPeriodo.join('  |  ');
  periodoCell.font = { italic: true };
  worksheet.mergeCells(2, 1, 2, columnas.length);

  // 3. Estilo de encabezado (mismo celeste claro usado en excelClientesService/excelCuentasService)
  const estiloHeader = {
    font: { bold: true },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFDDEBF7' }
    }
  };

  // 4. Encabezados de columna (fila 4, dejando fila 3 en blanco como separador)
  const filaHeader = 4;
  columnas.forEach((titulo, colIndex) => {
    const cell = worksheet.getCell(filaHeader, colIndex + 1);
    cell.value = titulo;
    Object.assign(cell, estiloHeader);
  });

  // 5. Datos
  let totalIngresos = 0;
  let totalEgresos   = 0;

  data.forEach((mov, rowIndex) => {
    const monto = Number(mov.monto) || 0;
    if (mov.tipo === 'INGRESO') totalIngresos += monto;
    if (mov.tipo === 'EGRESO')  totalEgresos  += monto;

    const fila = [
      mov.fecha ? moment(mov.fecha).format('DD/MM/YYYY HH:mm') : "",
      mov.caja || "",
      mov.fondo || "",
      mov.tipo || "",
      mov.origen || "",
      mov.descripcion || "",
      monto,
      mov.usuario || "",
      mov.empresa || ""
    ];

    fila.forEach((valor, colIndex) => {
      const cell = worksheet.getCell(filaHeader + 1 + rowIndex, colIndex + 1);
      cell.value = valor;

      // Columna Monto (índice 7, "$"): formato moneda es-AR, mismo criterio
      // que excelVentasService.ts para mantener consistencia entre reportes.
      if (colIndex === 6) cell.numFmt = '$ #,##0.00';
    });
  });

  // 6. Fila de totales al pie
  const filaTotales = filaHeader + 1 + data.length + 1;
  const neto = totalIngresos - totalEgresos;
  const formatoMoneda = '$ #,##0.00';

  worksheet.getCell(filaTotales, 6).value = 'TOTALES';
  worksheet.getCell(filaTotales, 6).font = { bold: true };

  worksheet.getCell(filaTotales, 7).value = neto;
  worksheet.getCell(filaTotales, 7).font = { bold: true };
  worksheet.getCell(filaTotales, 7).numFmt = formatoMoneda;

  worksheet.getCell(filaTotales + 1, 6).value = 'Ingresos';
  worksheet.getCell(filaTotales + 1, 7).value = totalIngresos;
  worksheet.getCell(filaTotales + 1, 7).numFmt = formatoMoneda;

  worksheet.getCell(filaTotales + 2, 6).value = 'Egresos';
  worksheet.getCell(filaTotales + 2, 7).value = totalEgresos;
  worksheet.getCell(filaTotales + 2, 7).numFmt = formatoMoneda;

  // 7. Ajustar ancho de columnas automáticamente (a partir de la fila de headers,
  // para que el título/período largo no infle todas las columnas)
  for (let i = 1; i <= columnas.length; i++) {
    const column = worksheet.getColumn(i);
    let maxLength = 0;

    column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber < filaHeader) return;
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });

    column.width = maxLength < 10 ? 10 : maxLength + 2;
  }

  // 8. Convertir a buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
