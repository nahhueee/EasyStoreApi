const fs = require('fs');
const path = require('path');


class DireccionesService{
    provincias: any[];
    localidades: any[];
    calles: any[];

    constructor() {
        // Cargo JSON de provincias
        this.provincias = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../json/provincias.json'), 'utf8')
        ).provincias;

        // Cargo JSON de localidades
        this.localidades = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../json/localidades.json'), 'utf8')
        ).localidades;

        // Cargo JSON de calles
        this.calles = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../json/calles.json'), 'utf8')
        ).calles;
    }

    ObtenerProvincias() {
        return this.provincias
            .slice() // para no modificar el array original
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
            .map(p => ({
            id: p.id,
            nombre: p.nombre
            }));
    }


    ObtenerLocalidades(provincia, filtro = '') {
        if (!provincia) {
            throw new Error('Falta el parámetro provincia');
        }
        
        //Filtramos por provincia
        let filtradas = this.localidades
        .filter(l => l.provincia.nombre.toLowerCase() === provincia.toLowerCase());

        //filtro por nombre si tiene 3 o mas caracteres
        if (filtro.length >= 3) 
            filtradas = filtradas.filter(l => l.nombre.toLowerCase().includes(filtro.toLowerCase()));
        else
            filtradas = [];

        return filtradas.slice(0, 20).map(l => ({
            id: l.id,
            nombre: l.nombre,
            lat: l.centroide.lat,
            lon: l.centroide.lon
        }));
    }

    ObtenerCalles(localidad, filtro = '') {
        if (!localidad) {
            throw new Error('Falta el parámetro localidad');
        }

        //Filtramos por provincia
        let filtradas = this.calles
        .filter(l => l.localidad_censal.nombre.toLowerCase() === localidad.toLowerCase());

        //filtro por nombre si tiene 3 o mas caracteres
        if (filtro.length >= 3) 
            filtradas = filtradas.filter(l => l.nombre.toLowerCase().includes(filtro.toLowerCase()));
        else
            filtradas = [];

        return filtradas.slice(0, 30).map(l => ({
            id: l.id,
            nombre: l.nombre
        }));
    }
}
export const DireccionesServ = new DireccionesService();