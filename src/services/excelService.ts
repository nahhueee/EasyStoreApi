import * as XLSX from 'xlsx';
import fs from 'fs';

interface FilaExcel {
  codigo: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio: number;
  costo: number;
  porcentaje: number;
  redondeo: number;
  [key: string]: any;
}

interface ResultadoImportacion {
  errores: { fila: number; mensaje: string }[];
  datosValidos: FilaExcel[]
}

export async function procesarExcel(filePath: string, tipoPrecio:string): Promise<ResultadoImportacion> {
  const errores: { fila: number; mensaje: string }[] = [];
  const datosValidos: FilaExcel[] = [];

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const datos: FilaExcel[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const unidadesPermitidas = ['UNI', 'KG', 'LIT'];
    const redondeosPermitidos = [0, 5, 10];

    for (let i = 0; i < datos.length; i++) {
      const fila = datos[i];
      const filaNum = i + 2; // +2 porque los encabezados están en la fila 1

      if (!fila.codigo || !fila.nombre || fila.cantidad == null || !fila.unidad || fila.costo == null ) {
        errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios' });
        continue;
      }

      //Validacion Campos para precio fijo
      if(tipoPrecio=="$"){
        if(fila.precio == null){
          errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios: precio' });
          continue;
        }
        if (isNaN(Number(fila.cantidad)) || isNaN(Number(fila.precio)) || isNaN(Number(fila.costo))) {
          errores.push({ fila: filaNum, mensaje: 'Cantidad, precio o costo no son números válidos' });
          continue;
        }
      }
      
      //Validacion Campos para precio porcentaje
      if(tipoPrecio=="%"){
        if (fila.porcentaje == null || fila.redondeo == null) {
          errores.push({ fila: filaNum, mensaje: 'Faltan campos obligatorios: porcentaje o redondeo' });
          continue;
        }

        if (isNaN(Number(fila.cantidad)) || isNaN(Number(fila.porcentaje)) || isNaN(Number(fila.costo)) || isNaN(Number(fila.redondeo))) {
          errores.push({ fila: filaNum, mensaje: 'Cantidad, costo, porcentaje o redondeo no son números válidos' });
          continue;
        }

        if (!redondeosPermitidos.includes(fila.redondeo)) {
          errores.push({ fila: filaNum, mensaje: 'Redondeo inválido (solo se permiten 0, 5 o 10)' });
          continue;
        }
      }
            

      if (!unidadesPermitidas.includes(fila.unidad.toUpperCase())) {
        errores.push({ fila: filaNum, mensaje: 'Unidad inválida (solo se permiten UNI, KG o LIT)' });
        continue;
      }

      datosValidos.push(fila); 
    }
  } finally {
    // Elimina archivo temporal
    fs.unlinkSync(filePath);
  }

  return { errores, datosValidos };
}
export async function crearExcelResultados(data: any[]) {
  // 1. Configurar el libro y la hoja de trabajo
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([]);

  // 2. Encabezados de tallas (filas 1-4, columnas I-R)
  const encabezadosTallas = [
    ["XXP", "PE", "ME", "GR", "XXG", "", "", "", "", ""],
    [4, 6, 8, 10, 12, 14, 16, 18, "", ""],
    [28, 30, 32, 34, 36, 38, 40, 42, 44, 46],
  ];

  // Añadir encabezados de tallas empezando en I1
  encabezadosTallas.forEach((fila, index) => {
    XLSX.utils.sheet_add_aoa(worksheet, [fila], { origin: { r: index, c: 8 } });
  });

  // 3. Encabezados informativos (fila 4, columnas A-H)
  const columnasInfo = ["Proceso", "Codigo", "Nombre", "Producto", "Tipo", "Genero", "Material", "Color"];
  XLSX.utils.sheet_add_aoa(worksheet, [columnasInfo], { origin: { r: 3, c: 0 } });

  // 4. Encabezados de tallas y total (fila 5, columnas I-S)
  const columnasTallas = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];
  const columnasTotales = ["Total"];
  XLSX.utils.sheet_add_aoa(worksheet, [columnasTallas], { origin: { r: 3, c: 8 } });
  XLSX.utils.sheet_add_aoa(worksheet, [columnasTotales], { origin: { r: 3, c: 18 } });

  // 5. Aplicar formato negrita a todos los encabezados
  aplicarNegritaEncabezados(worksheet);

  // 6. Añadir datos de productos (filas 6 en adelante)
  data.forEach((p, index) => {
    const fila = [
      p.Proceso || "",
      p.Codigo || "",
      p.Nombre || "",
      p.Producto || "",
      p.Tipo || "",
      p.Genero || "",
      p.Material || "",
      p.Color || "",
      p.XS || 0,
      p.S || 0,
      p.M || 0,
      p.L || 0,
      p.XL || 0,
      p.XXL || 0,
      p["3XL"] || 0,
      p["4XL"] || 0,
      p["5XL"] || 0,
      p["6XL"] || 0,
      p.Total || 0
    ];
    XLSX.utils.sheet_add_aoa(worksheet, [fila], { origin: { r: 4 + index, c: 0 } });
  });

  // 7. Finalizar el libro
  XLSX.utils.book_append_sheet(workbook, worksheet, "Resultados");

  // Convertir a buffer CON la opción cellStyles habilitada
  const buffer = XLSX.write(workbook, { 
    type: 'buffer', 
    bookType: 'xlsx',
    cellStyles: true // Esta opción es crucial para que funcionen los estilos
  });
  return buffer;
}

// Función auxiliar para aplicar negrita a los encabezados
function aplicarNegritaEncabezados(worksheet: XLSX.WorkSheet) {
  // Definir el estilo de negrita
  const estiloNegrita = { font: { bold: true } };

  // Aplicar negrita a encabezados de tallas (filas 0-2, columnas I-R)
  for (let fila = 0; fila < 3; fila++) {
    for (let columna = 8; columna < 18; columna++) {
      const cellAddress = XLSX.utils.encode_cell({ r: fila, c: columna });
      if (!worksheet[cellAddress]) {
        // Si la celda no existe, la creamos con el valor vacío y estilo
        worksheet[cellAddress] = { v: "", t: "s", s: estiloNegrita };
      } else {
        // Si la celda existe, le añadimos el estilo
        worksheet[cellAddress].s = estiloNegrita;
      }
    }
  }

  // Aplicar negrita a encabezados informativos (fila 3, columnas A-H)
  for (let columna = 0; columna < 8; columna++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 3, c: columna });
    if (!worksheet[cellAddress]) {
      worksheet[cellAddress] = { v: "", t: "s", s: estiloNegrita };
    } else {
      worksheet[cellAddress].s = estiloNegrita;
    }
  }

  // Aplicar negrita a encabezados de tallas (fila 3, columnas I-R)
  for (let columna = 8; columna < 18; columna++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 3, c: columna });
    if (!worksheet[cellAddress]) {
      worksheet[cellAddress] = { v: "", t: "s", s: estiloNegrita };
    } else {
      worksheet[cellAddress].s = estiloNegrita;
    }
  }

  // Aplicar negrita a encabezado de Total (fila 3, columna S)
  const totalCellAddress = XLSX.utils.encode_cell({ r: 3, c: 18 });
  if (!worksheet[totalCellAddress]) {
    worksheet[totalCellAddress] = { v: "Total", t: "s", s: estiloNegrita };
  } else {
    worksheet[totalCellAddress].s = estiloNegrita;
  }
}