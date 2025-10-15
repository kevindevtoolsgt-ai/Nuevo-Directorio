/**
 * script.js (v5.0 - Refactor)
 *
 * Maneja la interactividad de la página pública, con paginación del lado del servidor,
 * y animaciones fluidas.
 */

// Importar las funciones para el efecto de nieve
import { startSnowEffect, stopSnowEffect } from './snow.js';

document.addEventListener('DOMContentLoaded', () => {

    // Helper para escapar HTML
    const escapeHTML = (str) => {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    };

    // --- CONSTANTES Y ELEMENTOS DEL DOM ---
    const BASE_URL = '';
    const directoryGrid = document.getElementById('directory-grid');
    const searchInput = document.getElementById('searchInput');
    const gridViewBtn = document.getElementById('grid-view-btn');
    const listViewBtn = document.getElementById('list-view-btn');
    const paginationControls = document.getElementById('pagination-controls');
    const birthdaySection = document.getElementById('birthday-section');
    const newHiresContainer = document.getElementById('new-hires-container');
    const birthdayList = document.getElementById('birthday-list');
    const staffDetailsModal = document.getElementById('staffDetailsModal');
    const publicImportantInfoGrid = document.getElementById('public-important-info-grid');

    // --- ESTADO DE LA APLICACIÓN ---
    let staffData = [];
    let filteredStaffData = []; // This will now hold the currently displayed page data
    let birthdayStaff = [];
    let currentPage = 1;
    const ITEMS_PER_PAGE = 12; // Number of items per page
    let totalStaffCount = 0; // Total number of staff records from the server

    // --- FUNCIONES DE API ---
    const fetchData = async (url, errorMessage) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(errorMessage);
            return await response.json();
        } catch (error) {
            console.error(error.message, error);
            return [];
        }
    };

    const fetchStaff = async (page = 1, limit = ITEMS_PER_PAGE, searchTerm = '') => {
        try {
            let staffResponse;
            let countResponse;

            if (searchTerm) {
                // Fetch all matching staff for the search term, no pagination
                staffResponse = await fetchData(`${BASE_URL}/api/public/personal/search?q=${encodeURIComponent(searchTerm)}`, 'Error buscando personal');
                totalStaffCount = staffResponse.length; // Total count is the length of search results
                currentPage = 1; // Reset to first page for search results
                // Hide pagination controls during search
                paginationControls.style.display = 'none';
            } else {
                // Original paginated fetch
                const [paginatedStaff, totalCount] = await Promise.all([
                    fetchData(`${BASE_URL}/api/public/personal?page=${page}&limit=${limit}`, 'Error obteniendo datos del personal'),
                    fetchData(`${BASE_URL}/api/public/personal/count`, 'Error obteniendo el conteo total del personal')
                ]);
                staffResponse = paginatedStaff;
                totalStaffCount = totalCount.total;
                currentPage = page;
                // Show pagination controls
                paginationControls.style.display = 'flex'; // Assuming flex for centering
            }

            staffData = staffResponse;
            renderPaginatedDirectory();
            renderPaginationControls(); // This will render based on totalStaffCount and currentPage
        } catch (error) {
            console.error('Error en la carga inicial/búsqueda de personal:', error);
            directoryGrid.innerHTML = '<p class="col-12 text-center">Error al cargar los datos. Asegúrese de que el servidor backend esté funcionando.</p>';
        }
    };

    const fetchCarouselStaff = async () => {
        if (!newHiresContainer) return;
        const newHires = await fetchData(`${BASE_URL}/api/public/personal/carousel`, 'Error obteniendo datos para el carrusel');
        renderNewHires(newHires);
    };

    const fetchBirthdayStaff = async () => {
        if (!birthdaySection) return;
        birthdayStaff = await fetchData(`${BASE_URL}/api/public/personal/cumpleaneros`, 'Error obteniendo datos de cumpleaños');
        renderBirthdayList(birthdayStaff);
    };

    const fetchTheme = async () => {
        const { theme } = await fetchData(`${BASE_URL}/api/theme`, 'Error obteniendo el tema');
        if (theme) applyTheme(theme);
    };

    const fetchAndRenderImportantInfo = async () => {
        if (!publicImportantInfoGrid) return;
        const infoList = await fetchData(`${BASE_URL}/api/public/important-info`, 'Error obteniendo info importante');
        publicImportantInfoGrid.innerHTML = '';
        if (infoList.length === 0) {
            publicImportantInfoGrid.innerHTML = '<p class="text-muted text-center w-100">No hay información para mostrar.</p>';
            return;
        }
        infoList.forEach(info => {
            const card = document.createElement('div');
            card.className = 'info-item-card';
            
            // Icono genérico de teléfono
            const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-phone-call"><path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;

            card.innerHTML = `
                <div class="icon">
                    ${iconSvg}
                </div>
                <h6>${escapeHTML(info.title)}</h6>
                <p>${escapeHTML(info.extension || info.content || 'N/A')}</p>
            `;
            publicImportantInfoGrid.appendChild(card);
        });
    };

    // --- FUNCIONES DE RENDERIZADO Y ANIMACIÓN ---

    const renderDirectory = (staffList) => {
        directoryGrid.innerHTML = '';
        const isListView = directoryGrid.classList.contains('list-view');
        if (isListView) {
            renderListView(staffList, birthdayStaff);
        } else {
            renderGridView(staffList, birthdayStaff);
        }
    };

    const renderListView = (staffList, birthdayList = []) => {
        const placeholderIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="feather feather-user"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        const birthdayNames = new Set(birthdayList.map(p => p.nombre));

        if (staffList.length === 0) {
            directoryGrid.innerHTML = '<div class="col-12 text-center"><p>No se encontraron resultados.</p></div>';
            return;
        }

        const tableRows = staffList.map(person => {
            const isBirthday = birthdayNames.has(person.nombre);
            const safeFotoUrl = person.fotoUrl ? `${BASE_URL}${person.fotoUrl}` : '';
            const photoHtml = safeFotoUrl
                ? `<img src="${safeFotoUrl}" alt="Foto de ${escapeHTML(person.nombre)}" class="list-view-img rounded-circle">`
                : `<div class="list-view-img-placeholder d-flex align-items-center justify-content-center bg-light rounded-circle">${placeholderIconSvg}</div>`;

            return `
                <tr class="anime-hidden ${isBirthday ? 'birthday-person' : ''}" data-id="${person.id}">
                    <td>${photoHtml}</td>
                    <td><strong>${escapeHTML(person.nombre)}</strong> ${isBirthday ? '🎂' : ''}</td>
                    <td>${escapeHTML(person.puesto)}</td>
                    <td>${escapeHTML(person.departamento)}</td>
                    <td>${escapeHTML(person.extension)}</td>
                    <td><a href="mailto:${escapeHTML(person.correo)}">${escapeHTML(person.correo)}</a></td>
                    <td><button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#staffDetailsModal" data-id="${person.id}">Detalles</button></td>
                </tr>
            `;
        }).join('');

        directoryGrid.innerHTML = `
            <div class="table-responsive shadow-sm">
                <table class="table table-hover align-middle custom-table">
                    <thead class="table-light">
                        <tr>
                            <th></th>
                            <th>Nombre</th>
                            <th>Puesto</th>
                            <th>Departamento</th>
                            <th>Extensión </th>
                            <th>Correo</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;

        const animateListItems = () => {
            anime({
                targets: '#directory-grid tbody tr',
                translateX: [-30, 0],
                opacity: [0, 1],
                delay: anime.stagger(50, { start: 50 }),
                duration: 600,
                easing: 'easeOutCubic',
                begin: (anim) => {
                    anim.animatables.forEach(({ target }) => {
                        target.style.willChange = 'transform, opacity';
                    });
                },
                complete: (anim) => {
                    anim.animatables.forEach(({ target }) => {
                        target.style.willChange = 'auto';
                    });
                }
            });
        };
        animateListItems();
    };

    const renderGridView = (staffList, birthdayList = []) => {
        const placeholderIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="feather feather-user"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        const birthdayNames = new Set(birthdayList.map(p => p.nombre));

        if (staffList.length === 0) {
            directoryGrid.innerHTML = '<p class="col-12 text-center">No se encontraron resultados.</p>';
            return;
        }

        const gridHtml = staffList.map((person) => {
            const isBirthday = birthdayNames.has(person.nombre);
            const safeFotoUrl = person.fotoUrl ? `${BASE_URL}${person.fotoUrl}` : '';
            const photoHtml = safeFotoUrl
                ? `<img src="${safeFotoUrl}" alt="Foto de ${escapeHTML(person.nombre)}" class="card-img-top">`
                : `<div class="staff-photo-placeholder d-flex align-items-center justify-content-center bg-light rounded-circle" style="width: 150px; height: 150px; object-fit: cover; margin: 1rem auto 0.5rem auto; border: 3px solid var(--primary-color); box-shadow: var(--shadow-sm);"></div>`;

            return `
                <div class="col anime-hidden">
                    <div class="card h-100 text-center ${isBirthday ? 'birthday-person' : ''}" data-id="${person.id}">
                        
                        ${photoHtml}
                        <div class="card-body">
                            <h5 class="card-title">${escapeHTML(person.nombre)} ${isBirthday ? '🎂' : ''}</h5>
                            <p class="card-text text-muted">${escapeHTML(person.puesto) || 'Sin puesto asignado'}</p>
                            <p class="card-text"><strong>Ext:</strong> ${escapeHTML(person.extension) || 'N/A'}</p>
                        </div>
                        <div class="card-footer">
                            <button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#staffDetailsModal" data-id="${person.id}">Ver Detalles</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        directoryGrid.innerHTML = gridHtml;

        setupGridItemAnimationsAndInteractions();

        const animateGridItems = () => {
            anime({
                targets: '#directory-grid .col',
                translateY: [30, 0],
                opacity: [0, 1],
                scale: [0.95, 1],
                delay: anime.stagger(50, { start: 50 }),
                duration: 600,
                easing: 'easeOutCubic',
                begin: (anim) => {
                    anim.animatables.forEach(({ target }) => {
                        target.style.willChange = 'transform, opacity';
                    });
                },
                complete: function(anim) {
                    anim.animatables.forEach(function(animatable) {
                        animatable.target.style.transform = 'scale(1)';
                        animatable.target.style.willChange = 'auto';
                    });
                }
            });
        };
        animateGridItems(); // La animación ahora se llama desde la función contenedora
    };

    const setupGridItemAnimationsAndInteractions = () => {

        // --- Confetti and Hover Effects ---
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const throttle = (func, limit) => {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            }
        };

        const triggerConfetti = (card) => {
            if (prefersReducedMotion) return;

            const rect = card.getBoundingClientRect();
            const originY = (rect.top + rect.height / 2) / window.innerHeight;
            const originXLeft = rect.left / window.innerWidth;
            const originXRight = rect.right / window.innerWidth;

            const particleCount = 30;
            const spread = 40;

            // Left jet
            confetti({
                particleCount,
                spread,
                origin: { x: originXLeft, y: originY },
                angle: 60, // up-left
                scalar: 1,
            });
           /* confetti({
                particleCount,
                spread,
                origin: { x: originXLeft, y: originY },
                angle: 360, // down-left
                scalar: 1,
            });*/

            // Right jet
            confetti({
                particleCount,
                spread,
                origin: { x: originXRight, y: originY },
                angle: 120, // up-right
                scalar: 1,
            });
            /*confetti({
                particleCount,
                spread,
                origin: { x: originXRight, y: originY },
                angle: 180, // down-right
                scalar: 1,
            });*/
        };

        const throttledConfetti = throttle(triggerConfetti, 500);

        document.querySelectorAll('#directory-grid .card').forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (card.classList.contains('birthday-person')) {
                    card.classList.add('animate__animated', 'animate__headShake');
                    throttledConfetti(card);
                }

                anime({
                    targets: card,
                    scale: 1.03,
                    duration: 200,
                    easing: 'easeOutQuad',
                    begin: () => {
                        card.style.willChange = 'transform';
                    }
                });
            });
            card.addEventListener('mouseleave', () => {
                if (card.classList.contains('birthday-person')) {
                    card.classList.remove('animate__animated', 'animate__headShake');
                }
                anime({
                    targets: card,
                    scale: 1,
                    duration: 200,
                    easing: 'easeOutQuad',
                    complete: () => {
                        card.style.willChange = 'auto';
                    }
                });
            });
        });
    }

    const renderNewHires = (newHires) => {
        if (!newHiresContainer) return;
        newHiresContainer.innerHTML = '';
    
        const newHiresSection = document.getElementById('new-hires-section');
        const importantInfoColumn = document.getElementById('importantInfoColumn');
    
        if (newHires.length === 0) {
            // Si no hay datos, ocultamos la columna del carrusel
            if (newHiresSection) newHiresSection.style.display = 'none';
            // Y hacemos que la columna de info importante ocupe todo el espacio y se centre
            if (importantInfoColumn) importantInfoColumn.className = 'col-lg-12 mx-auto animate__animated animate__fadeInRight animate__delay-1.5s';
            return;
        }
    
        // Si hay datos, nos aseguramos de que las columnas tengan su clase original
        if (newHiresSection) newHiresSection.style.display = 'block';
        if (importantInfoColumn) importantInfoColumn.className = 'col-lg-5 animate__animated animate__fadeInRight animate__delay-1.5s';
    
        newHires.forEach(person => {
            const card = document.createElement('div');
            card.className = 'new-hire-card';
            const safeFotoUrl = person.fotoUrl ? `${BASE_URL}${person.fotoUrl}` : '';
            const photoHtml = safeFotoUrl
                ? `<img src="${safeFotoUrl}" alt="${escapeHTML(person.nombre)}">`
                : `<div class="staff-photo-placeholder d-flex align-items-center justify-content-center bg-light rounded-circle" style="width: 100px; height: 100px; margin: 0 auto 0.5rem auto;"></div>`;

            card.innerHTML = `
                ${photoHtml}
                <h6 class="card-title mb-1">${escapeHTML(person.nombre)}</h6>
                <p class="card-text text-muted small">${escapeHTML(person.puesto || 'Puesto por asignar')}</p>
            `;
            newHiresContainer.appendChild(card);
        });

        // --- Lógica para los botones de scroll ---
        const scrollContainer = document.getElementById('new-hires-container');
        const scrollLeftBtn = document.getElementById('scroll-left-btn');
        const scrollRightBtn = document.getElementById('scroll-right-btn');

        const updateScrollButtons = () => {
            const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
            
            // Si no hay scroll, ocultar ambos botones
            if (maxScrollLeft <= 0) {
                scrollLeftBtn.style.display = 'none';
                scrollRightBtn.style.display = 'none';
                return;
            }

            // Mostrar/ocultar botón izquierdo
            scrollLeftBtn.style.display = scrollContainer.scrollLeft > 0 ? 'block' : 'none';
            
            // Mostrar/ocultar botón derecho
            scrollRightBtn.style.display = scrollContainer.scrollLeft < maxScrollLeft - 1 ? 'block' : 'none';
        };

        scrollLeftBtn.addEventListener('click', () => {
            scrollContainer.scrollLeft -= 300; // Ajusta este valor según necesites
        });

        scrollRightBtn.addEventListener('click', () => {
            scrollContainer.scrollLeft += 300; // Ajusta este valor según necesites
        });

        // Actualizar los botones cuando se hace scroll y al cambiar el tamaño de la ventana
        scrollContainer.addEventListener('scroll', updateScrollButtons);
        window.addEventListener('resize', updateScrollButtons);
        
        updateScrollButtons(); // Llamada inicial para establecer el estado correcto
    };

    const renderBirthdayList = (birthdayStaff) => {
        if (!birthdaySection || !birthdayList) return;
        if (birthdayStaff.length === 0) {
            birthdaySection.style.display = 'none';
            return;
        }
        birthdaySection.style.display = 'block';
        const container = birthdaySection.querySelector('.birthday-list-container');
        const listContent = birthdayStaff.map(p => `<li class="birthday-item">🙌 ${escapeHTML(p.nombre)} 🎊</li>`).join('');
        birthdayList.innerHTML = listContent;

        // Defer animation setup to prevent forced layout warning
        setTimeout(() => {
            const containerWidth = container.offsetWidth;
            const listWidth = birthdayList.scrollWidth;

            // Si la lista de nombres es más corta que el contenedor, la centramos.
            if (listWidth < containerWidth) {
                container.classList.add('centered');
                birthdayList.style.animation = 'none'; // Sin animación
            } else {
                // Si es más larga, aplicamos la animación de scroll.
                container.classList.remove('centered');
                // Duplicamos la lista para un efecto de scroll infinito y fluido
                birthdayList.innerHTML += listContent; 

                // Calcular duración de la animación basada en el ancho del contenido
                const totalWidth = birthdayList.scrollWidth / 2; // Usamos la mitad porque duplicamos
                const duration = totalWidth / 50; // Ajusta el divisor para cambiar la velocidad (menor = más rápido)
                birthdayList.style.animation = `scroll-left ${duration}s linear infinite`;
            }

            // Animate the birthday section to fade in
            anime({
                targets: birthdaySection,
                opacity: [0, 1],
                duration: 800,
                easing: 'easeOutQuad',
                begin: () => {
                    birthdaySection.style.willChange = 'opacity';
                },
                complete: () => {
                    birthdaySection.style.willChange = 'auto';
                }
            });
        }, 100); // A small delay to allow the browser to paint first
    };

    // --- FILTRADO Y PAGINACIÓN ---

    const filterAndRender = () => {
        const searchTerm = searchInput.value.trim(); // Get raw value, trim whitespace
        if (searchTerm) {
            fetchStaff(1, ITEMS_PER_PAGE, searchTerm); // Search from page 1
        } else {
            fetchStaff(1, ITEMS_PER_PAGE); // If search term is empty, revert to normal pagination
        }
    };

    const renderPaginatedDirectory = () => {
        // This function now just renders the staffData (which is already paginated from fetchStaff)
        renderDirectory(staffData);
    };

    const renderPaginationControls = () => {
        paginationControls.innerHTML = '';
        const totalPages = Math.ceil(totalStaffCount / ITEMS_PER_PAGE);
        if (totalPages <= 1) return;

        const createPageItem = (content, page, isDisabled = false, isActive = false) => {
            const li = document.createElement('li');
            li.className = `page-item ${isDisabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`;
            li.innerHTML = `<a class="page-link" href="#" data-page="${page}">${content}</a>`;
            return li;
        };

        paginationControls.appendChild(createPageItem('&laquo;', currentPage - 1, currentPage === 1));
        for (let i = 1; i <= totalPages; i++) {
            paginationControls.appendChild(createPageItem(i, i, false, i === currentPage));
        }
        paginationControls.appendChild(createPageItem('&raquo;', currentPage + 1, currentPage === totalPages));
    };

    // --- MANEJO DE VISTAS Y TEMA ---

    const setView = (view) => {
        localStorage.setItem('directoryView', view);
        const isListView = view === 'list';
        directoryGrid.classList.toggle('list-view', isListView);

        // Toggle Bootstrap grid classes on directoryGrid
        if (isListView) {
            directoryGrid.classList.remove('row', 'row-cols-1', 'row-cols-md-2', 'row-cols-lg-3', 'g-4');
        } else {
            directoryGrid.classList.add('row', 'row-cols-1', 'row-cols-md-2', 'row-cols-lg-3', 'g-4');
        }

        document.getElementById('list-view-btn').classList.toggle('btn-primary', isListView);
        document.getElementById('list-view-btn').classList.toggle('btn-outline-primary', !isListView);
        document.getElementById('grid-view-btn').classList.toggle('btn-primary', !isListView);
        document.getElementById('grid-view-btn').classList.toggle('btn-outline-primary', isListView);
        renderPaginatedDirectory(); // Re-render with current page data
    };

    const applyTheme = (theme) => {
        // Lógica para tema oscuro
        document.body.classList.toggle('dark-theme', theme === 'dark');

        // Lógica para el tema navideño (efecto de nieve)
        if (theme === 'christmas') {
            startSnowEffect();
        } else {
            stopSnowEffect();
        }
    };

    const normalizeText = (text) => {
        if (text == null) return '';
        return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    };

    // --- SOCKET.IO --- 

    const setupSocketIO = () => {
        try {
            const socket = io(BASE_URL);
            socket.on('staffUpdate', () => {
                console.log('Actualización de datos recibida. Refrescando...');
                // When staff updates, re-fetch the current page to reflect changes
                fetchStaff(currentPage, ITEMS_PER_PAGE);
                fetchCarouselStaff();
                fetchBirthdayStaff();
            });
            socket.on('themeChange', applyTheme);
            socket.on('importantInfoUpdate', fetchAndRenderImportantInfo);
        } catch (error) {
            console.error("Error de conexión con Socket.IO.", error);
        }
    };

    // --- INICIALIZACIÓN Y EVENT LISTENERS ---

    const initializeEventListeners = () => {
        searchInput.addEventListener('input', filterAndRender);
        document.getElementById('grid-view-btn').addEventListener('click', () => setView('grid'));
        document.getElementById('list-view-btn').addEventListener('click', () => setView('list'));

        paginationControls.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.target.closest('a[data-page]');
            if (!target || target.parentElement.classList.contains('disabled')) return;
            const page = parseInt(target.dataset.page, 10);
            if (page !== currentPage) {
                fetchStaff(page, ITEMS_PER_PAGE); // Fetch new page from server
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });

        staffDetailsModal.addEventListener('show.bs.modal', (event) => {
            const personId = event.relatedTarget.getAttribute('data-id');
            // Find person in the currently loaded staffData. Use 'id' (lowercase)
            const person = staffData.find(p => p.id == personId);
            if (person) {
                const modalTitle = staffDetailsModal.querySelector('.modal-title');
                const modalBody = staffDetailsModal.querySelector('.modal-body');
                const placeholderIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="feather feather-user"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
                modalTitle.textContent = escapeHTML(person.nombre);
                const safeFotoUrl = person.fotoUrl ? `${BASE_URL}${person.fotoUrl}` : '';
                const photoHtml = safeFotoUrl ? `<img src="${safeFotoUrl}" class="img-fluid rounded-circle mb-3" style="width: 150px; height: 150px; object-fit: cover;" alt="Foto de ${escapeHTML(person.nombre)}">`
                                              : `<div class="d-flex align-items-center justify-content-center bg-light rounded-circle mb-3" style="width: 150px; height: 150px;">${placeholderIconSvg}</div>`;
                modalBody.innerHTML = `
                    <div class="text-center anime-hidden">
                        ${photoHtml}
                    </div>
                    <div class="anime-hidden">
                        <p class="text-center text-muted"> ${escapeHTML(person.puesto || 'Sin puesto asignado')}</p>
                        <p><strong>Departamento:</strong> ${escapeHTML(person.departamento || 'N/A')}</p>
                        <p><strong>Extensión:</strong> ${escapeHTML(person.extension || 'N/A')}</p>
                        <p><strong>Correo:</strong> <a href="mailto:${escapeHTML(person.correo)}">${escapeHTML(person.correo)}</a></p>
                        <hr>
                        <p>${escapeHTML(person.descripcion || 'No hay descripción disponible.')}</p>
                    </div>
                `;

                const modalTimeline = anime.timeline({
                    easing: 'easeOutCubic',
                    begin: () => {
                        const targets = staffDetailsModal.querySelectorAll('.modal-content, .modal-body > *');
                        targets.forEach(target => {
                            target.style.willChange = 'transform, opacity';
                        });
                    },
                    complete: () => {
                        const targets = staffDetailsModal.querySelectorAll('.modal-content, .modal-body > *');
                        targets.forEach(target => {
                            target.style.willChange = 'auto';
                        });
                    }
                });

                modalTimeline.add({
                        targets: staffDetailsModal.querySelector('.modal-content'),
                        scale: [0.9, 1],
                        opacity: [0, 1],
                        duration: 400
                    })
                    .add({
                        targets: modalBody.children,
                        translateY: [20, 0],
                        opacity: [0, 1],
                        delay: anime.stagger(100),
                        duration: 600
                    }, '-=200');
            }
        });
    };

    const main = async () => {
        initializeEventListeners();
        setView(localStorage.getItem('directoryView') || 'grid');
        // Initial fetch now only gets the first page
        await Promise.all([
            fetchBirthdayStaff(),
            fetchStaff(currentPage, ITEMS_PER_PAGE), // Fetch first page of staff
            fetchCarouselStaff(),
            fetchTheme(),
            fetchAndRenderImportantInfo()
        ]);
        setupSocketIO();
    };

    main(); // Iniciar la aplicación principal inmediatamente

});