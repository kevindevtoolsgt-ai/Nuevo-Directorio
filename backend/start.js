/**
 * Punto de entrada principal de la aplicación.
 *
 * Este script tiene una única y muy importante responsabilidad:
 * Cargar las variables de entorno desde el archivo .env ANTES de que
 * cualquier otro código de la aplicación se ejecute.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
require('./server.js'); // Una vez cargadas las variables, inicia el servidor.