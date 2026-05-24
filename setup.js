const fs = require("fs-extra");
const path = require("path");
require('dotenv').config();

async function setup() {
  try {
    console.log("📂 Creando carpetas...");

    // Definir las carpetas necesarias
    const directories = [
      "out/src/upload",
      "out/src/db/seeds",
      "out/src/db/tasks",
      "out/src/certs",
      "out/src/json"
    ];

    // Crear todas las carpetas
    for (const dir of directories) {
      await fs.ensureDir(dir);
    }

    console.log("✅ Carpetas creadas correctamente.");

    console.log("📂 Copiando archivos...");

    
    // Definir archivos individuales
    const filesToCopy = [
      "package.json",
      ".env",
      "knexfile.js",
      "nodemon.json",
      "src/db/script.sql",
      "src/db/script.sql",
      "src/json/calles.json",
      "src/json/localidades.json",
      "src/json/provincias.json"
    ];

    //Archivo de configuracion dependiendo el entorno
    const env = process.env.NODE_ENV || 'pc';  
    const configFile = `config.${env}.json`;  
    filesToCopy.push(configFile);

    // Copiar archivos individuales
    for (const file of filesToCopy) {
      await fs.copy(file, path.join("out", file));
    }

    // Copiar toda la carpeta tasks
    await fs.copy("src/db/tasks", "out/src/db/tasks");

    //#region Cambiar la propiedad 'produccion' a true en el archivo de configuración
    const configFilePath = path.resolve(__dirname, `out/${configFile}`);
    
    const rawConfig = await fs.readFile(configFilePath, 'utf-8');
    const config = JSON.parse(rawConfig);

    config.produccion = true;

    // Guardar los cambios en el archivo de configuración
    await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
    //#endregion

    console.log("✅ Archivos copiados correctamente.");
  } catch (error) {
    console.error("❌ Error en la configuración:", error);
  }
}


setup();
