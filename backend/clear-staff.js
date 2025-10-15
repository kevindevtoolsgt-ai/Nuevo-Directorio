/**
 * Script para limpiar la tabla de Personal y sus fotos asociadas.
 *
 * USO:
 * 1. Abre una terminal en la raíz del proyecto.
 * 2. Ejecuta el comando: node backend/clear-staff.js
 * 3. El script te pedirá confirmación antes de borrar nada.
 *
 * ADVERTENCIA: Esta acción es irreversible. Borrará a TODOS los miembros del personal.
 * Se recomienda hacer un backup de la base de datos antes de ejecutarlo.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { connect, getPool, close, sql } = require('./db');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const uploadsDir = path.join(__dirname, 'uploads');

const clearStaffData = async () => {
    const confirmation = await askConfirmation();
    if (confirmation.toLowerCase() !== 'borrar') {
        console.log('Operación cancelada.');
        return;
    }

    try {
        console.log('Conectando a la base de datos...');
        await connect();
        const pool = getPool();

        console.log('Obteniendo la lista de fotos para eliminar...');
        const photosResult = await pool.request().query('SELECT fotoUrl FROM Personal WHERE fotoUrl IS NOT NULL');
        const photosToDelete = photosResult.recordset.map(row => row.fotoUrl);

        console.log('Iniciando transacción para eliminar datos de la tabla Personal...');
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        // Usamos TRUNCATE TABLE porque es más rápido y resetea el contador de IDs.
        await transaction.request().query('TRUNCATE TABLE Personal');
        await transaction.commit();
        console.log('¡Éxito! Todos los registros de la tabla Personal han sido eliminados.');

        // Eliminar las fotos del sistema de archivos
        photosToDelete.forEach(fotoUrl => {
            const fileName = path.basename(fotoUrl);
            const filePath = path.join(uploadsDir, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Archivo de foto eliminado: ${fileName}`);
            }
        });

    } catch (error) {
        console.error('\nError durante el proceso de limpieza:', error.message);
    } finally {
        console.log('Cerrando conexión a la base de datos...');
        await close();
    }
};

function askConfirmation() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question('ADVERTENCIA: Estás a punto de borrar TODOS los registros de personal. Esta acción no se puede deshacer.\nEscribe "borrar" para confirmar: ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

clearStaffData();