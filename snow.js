/**
 * snow.js
 * Lógica para crear un efecto de nieve en la página.
 * Se activa o desactiva según los eventos de Socket.IO.
 */

const snowContainer = document.createElement('div');
snowContainer.id = 'snow-container';
document.body.appendChild(snowContainer);

let isSnowing = false;
let lastSnowflakeTime = 0;

function createSnowflake() {
    const snowflake = document.createElement('div');
    snowflake.classList.add('snowflake');

    // Posición inicial y tamaño aleatorios
    snowflake.style.left = `${Math.random() * 100}vw`;
    snowflake.style.animationDuration = `${Math.random() * 5 + 5}s`; // Duración entre 5 y 10 segundos
    const size = `${Math.random() * 4 + 2}px`; // Tamaño entre 2px y 6px
    snowflake.style.width = size;
    snowflake.style.height = size;
    snowflake.style.opacity = Math.random();

    snowContainer.appendChild(snowflake);

    // Eliminar el copo de nieve después de que termine la animación para no sobrecargar el DOM
    setTimeout(() => {
        snowflake.remove();
    }, 10000); // 10 segundos, que es la duración máxima de la animación
}

/**
 * Bucle de animación para crear copos de nieve.
 */
function snowLoop(timestamp) {
    if (!isSnowing) return;

    if (timestamp - lastSnowflakeTime > 250) { // Crear un copo cada 250ms
        createSnowflake();
        lastSnowflakeTime = timestamp;
    }

    requestAnimationFrame(snowLoop);
}

/**
 * Inicia el efecto de nieve, creando copos a intervalos regulares.
 */
function startSnowEffect() {
    if (isSnowing) return;
    console.log('Activando efecto de nieve...');
    snowContainer.style.display = 'block';
    isSnowing = true;
    requestAnimationFrame(snowLoop);
}

/**
 * Detiene el efecto de nieve y limpia los copos existentes.
 */
function stopSnowEffect() {
    if (!isSnowing) return;
    console.log('Desactivando efecto de nieve...');
    isSnowing = false;
    snowContainer.innerHTML = ''; // Limpiar todos los copos
    snowContainer.style.display = 'none';
}

// Exportar las funciones para que puedan ser usadas en el script principal (script.js)
// Si estás usando módulos ES6 en tu script público, esta es la forma.
// Si no, puedes simplemente incluir este script antes de tu script principal y las funciones estarán disponibles globalmente.
export { startSnowEffect, stopSnowEffect };