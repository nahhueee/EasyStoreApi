const path = require('path');
const fs = require('fs');
require('dotenv').config();
const env = process.env.NODE_ENV || 'pc';
const configPath = path.resolve(__dirname, `./config.${env}.json`);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
// La clave tiene que coincidir con NODE_ENV: el CLI de knex también usa esa
// variable (por su cuenta) para elegir qué entrada de este objeto tomar.
module.exports = {
  [env]: {
      client: 'mysql2',
      connection: {
        host: config.db.host,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database
      },
      migrations: {
        directory: path.resolve(__dirname, './src/db/tasks')
      },
      seeds: {
        directory: path.resolve(__dirname, './src/db/seeds')
      }
    }
};