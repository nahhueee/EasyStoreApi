import ExcelJS from 'exceljs';

export async function crearExcelVentas(res1: any[], res2: any[], res3: any[]) {
  const workbook = new ExcelJS.Workbook();

  // =========================
  // HOJA 1: ACUMULADO
  // =========================
  const sheet1 = workbook.addWorksheet('Acumulado');

  sheet1.columns = [
    { header: 'Método de pago', key: 'metodo_pago', width: 25 },
    { header: 'Total acumulado', key: 'total_acumulado', width: 20 }
  ];

  res1.forEach(r => {
    sheet1.addRow({
      metodo_pago: r.metodo_pago,
      total_acumulado: Number(r.total_acumulado)
    });
  });

  sheet1.autoFilter = {
    from: 'A1',
    to: 'B1'
  };

  // Guardar última fila con datos (ANTES del total)
  const lastDataRow = sheet1.rowCount;

  // Crear fila total
  const totalRowIndex = lastDataRow + 1;

  // Texto
  sheet1.getCell(`A${totalRowIndex}`).value = 'TOTAL';

  // Fórmula correcta (sin incluirse a sí misma)
  sheet1.getCell(`B${totalRowIndex}`).value = {
    formula: `SUM(B2:B${lastDataRow})`
  };

  // Estilo
  sheet1.getRow(totalRowIndex).font = { bold: true };
  sheet1.getCell(`B${totalRowIndex}`).numFmt = '$ #,##0.00';

  // =========================
  // HOJA 2: VENTAS
  // =========================
  const sheet2 = workbook.addWorksheet('Ventas');

  sheet2.columns = [
    { header: 'Proceso', key: 'proceso', width: 15 },
    { header: 'N° Proceso', key: 'nroProceso', width: 15 },
    { header: 'Punto de venta', key: 'punto_venta', width: 20 },
    { header: 'Fecha / Hora', key: 'fecha_hora', width: 20 },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Venta', key: 'venta', width: 15 },
    { header: 'Servicio', key: 'servicio', width: 15 },
    { header: 'Descuento $', key: 'des', width: 15 },
    { header: 'Cobrado', key: 'cobrado', width: 15 },
    { header: 'Descuento %', key: 'descuento', width: 15 },
    { header: 'Comprobante', key: 'comprobante', width: 20 },
    { header: 'N° Comprobante', key: 'nro_comprobante', width: 20 },
    { header: 'Métodos de pago', key: 'metodos', width: 40 },
    { header: 'Montos de pago', key: 'montos', width: 40 },
    { header: 'Cant. prendas', key: 'cantidad_prendas', width: 15 },
    { header: 'Facturante', key: 'facturante', width: 25 }
  ];

  res2.forEach(r => {
    sheet2.addRow({
      ...r,
      cobrado: Number(r.cobrado),
      venta: Number(r.venta),
      servicio: Number(r.servicio),
      des: Number(r.des),
      cantidad_prendas: Number(r.cantidad_prendas)
    });
  });

  sheet2.autoFilter = {
    from: 'A1',
    to: 'P1'
  };


  // =========================
  // HOJA 3: DETALLE
  // =========================
  const sheet3 = workbook.addWorksheet('Detalle');

  sheet3.columns = [
    { header: 'Fecha / Hora', key: 'fecha_hora', width: 20 },
    { header: 'Punto de venta', key: 'punto_venta', width: 20 },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Facturante', key: 'facturante', width: 25 },
    { header: 'Remito', key: 'remito', width: 20 },
    { header: 'Comprobante', key: 'comprobante', width: 20 },
    { header: 'Producto', key: 'producto', width: 20 },
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Género', key: 'genero', width: 15 },
    { header: 'Código', key: 'codigo', width: 15 },
    { header: 'Artículo', key: 'articulo', width: 25 },
    { header: 'Material', key: 'material', width: 20 },
    { header: 'Color', key: 'color', width: 15 },

    { header: 'XS', key: 'XS', width: 8 },
    { header: 'S', key: 'S', width: 8 },
    { header: 'M', key: 'M', width: 8 },
    { header: 'L', key: 'L', width: 8 },
    { header: 'XL', key: 'XL', width: 8 },
    { header: 'XXL', key: 'XXL', width: 8 },
    { header: '3XL', key: '3XL', width: 8 },
    { header: '4XL', key: '4XL', width: 8 },
    { header: '5XL', key: '5XL', width: 8 },
    { header: '6XL', key: '6XL', width: 8 },

    { header: 'Total', key: 'total', width: 10 }
  ];

  res3.forEach(r => {
    sheet3.addRow({
      ...r,
      XS: r.XS ?? 0,
      S: r.S ?? 0,
      M: r.M ?? 0,
      L: r.L ?? 0,
      XL: r.XL ?? 0,
      XXL: r.XXL ?? 0,
      '3XL': r['3XL'] ?? 0,
      '4XL': r['4XL'] ?? 0,
      '5XL': r['5XL'] ?? 0,
      '6XL': r['6XL'] ?? 0,
      total: Number(r.total)
    });
  });

  sheet3.autoFilter = {
    from: 'A1',
    to: 'X1'
  };


  // =========================
  // ESTILO GENERAL
  // =========================
  [sheet1, sheet2, sheet3].forEach(sheet => {
    const headerRow = sheet.getRow(1);

    headerRow.eachCell(cell => {
      cell.font = { bold: true };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDDEBF7' }
      };

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };

      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  });


  // Auto width
  autoFitColumns(sheet1);
  autoFitColumns(sheet2);
  autoFitColumns(sheet3);

  // Formato talles
  aplicarFormatoTalles(sheet3);
  sheet3.getColumn('total').numFmt = '#,##0';

  //Formato pesos ARG
  sheet1.getColumn('total_acumulado').numFmt = '$ #,##0.00';
  sheet2.getColumn('venta').numFmt = '$ #,##0.00';
  sheet2.getColumn('servicio').numFmt = '$ #,##0.00';
  sheet2.getColumn('des').numFmt = '$ #,##0.00';
  sheet2.getColumn('cobrado').numFmt = '$ #,##0.00';

  // =========================
  // EXPORTAR
  // =========================
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}


function autoFitColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach(column => {
    let maxLength = 10;

    column.eachCell?.({ includeEmpty: true }, cell => {
      const value = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, value.length);
    });

    column.width = maxLength + 2;
  });
}
function aplicarFormatoTalles(sheet: ExcelJS.Worksheet) {
  const headers = sheet.getRow(1);

  headers.eachCell((cell, colIndex) => {
    const header = cell.value?.toString();

    const talles = ['XS','S','M','L','XL','XXL','3XL','4XL','5XL','6XL'];

    if (talles.includes(header || '')) {
      sheet.getColumn(colIndex).eachCell((c, rowIndex) => {
        if (rowIndex === 1) return;

        c.numFmt = '#,##0;-#,##0;"–"';
        c.alignment = { horizontal: 'center' };
      });
    }
  });
}