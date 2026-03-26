(function () {
    'use strict';

    /* ========= IMAGE MANIFEST ========= */
    const SKIN_DISPLAY = {
        'Arabasque': 'Arabesque',
        'Calacattaluxe': 'Calacatta Luxe'
    };

    const DEFAULT_MANIFEST = {
        rooms: ['Bathroom', 'Kitchen', 'Facade'],
        skins: ['Arabasque', 'Calacattaluxe'],
        images: {
            'Bathroom_Arabasque_Day': 'Model Photos/Bathroom_Arabasque_Day.png',
            'Bathroom_Arabasque_Night': 'Model Photos/Bathroom_Arabasque_Night.png',
            'Bathroom_Calacattaluxe_Day': 'Model Photos/Bathroom_Calacattaluxe_Day.png',
            'Bathroom_Calacattaluxe_Night': 'Model Photos/Bathroom_Calacattaluxe_Night.png',
            'Facade_Arabasque_Day': 'Model Photos/Facade_Arabasque_Day.png',
            'Facade_Arabasque_Night': 'Model Photos/Facade_Arabasque_Night.png',
            'Facade_Calacattaluxe_Day': 'Model Photos/Facade_Calacattaluxe_Day.png',
            'Facade_Calacattaluxe_Night': 'Model Photos/Facade_Calacattaluxe_Night.png',
            'Kitchen_Arabasque_Day': 'Model Photos/Kitchen_Arabasque_Day.png',
            'Kitchen_Arabasque_Night': 'Model Photos/Kitchen_Arabasque_Night.png',
            'Kitchen_Calacattaluxe_Day': 'Model Photos/Kitchen_Calcattaluxe_Day.png',
            'Kitchen_Calacattaluxe_Night': 'Model Photos/Kitchen_Calacattaluxe_Night.png'
        },
        gallery: {
            'Arabesque': [
                'Gallery photos/Arabesque/Arabesque_furniture.jpg',
                'Gallery photos/Arabesque/arabesque_detail.jpg',
                'Gallery photos/Arabesque/arabesque_kitchen.jpg'
            ],
            'Calacatta Luxe': [
                'Gallery photos/calacatta luxe/calacatta luxe_1.jpg',
                'Gallery photos/calacatta luxe/calacatta luxe_3.jpg',
                'Gallery photos/calacatta luxe/calacatta_luxe_2.jpg'
            ]
        }
    };

    /* ========= STATE ========= */
    let manifest = DEFAULT_MANIFEST;
    let currentRoom = 'Bathroom';
    let currentSkin = 'Arabasque';
    let currentTime = 'Day';
    let isDay = true;
    let autoRotate = true;
    let isTransitioning = false;

    // Three.js
    let scene, camera, renderer;
    let currentSphere = null;
    let textureCache = {};

    // Camera look
    let lon = 0, lat = 0;
    let targetFov = 75;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let lonStart = 0, latStart = 0;
    const DRAG_SPEED = 0.2;

    // Touch pinch
    let lastPinchDist = 0;

    // Gyroscope
    let gyroEnabled = false;
    let gyroAlpha = 0, gyroBeta = 0, gyroGamma = 0;
    let gyroLonOffset = 0, gyroLatOffset = 0;

    // Gallery
    let currentGalleryTab = null;
    let lightboxImages = [];
    let lightboxIndex = 0;

    // Idle auto-rotate
    let idleTimeout = null;
    let autoRotatePaused = false;

    /* ========= INIT ========= */
    async function init() {
        try {
            const resp = await fetch('manifest.json');
            if (resp.ok) manifest = await resp.json();
        } catch (e) { /* use default */ }

        setupThreeJS();
        buildUI();
        setupEvents();
        await loadPanorama(currentRoom, currentSkin, currentTime, false);
        hideLoader();
        animate();
    }

    /* ========= THREE.JS ========= */
    function setupThreeJS() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1100);
        camera.position.set(0, 0, 0.1);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.getElementById('viewer-container').appendChild(renderer.domElement);
    }

    function getImageKey(room, skin, time) {
        return room + '_' + skin + '_' + time;
    }

    function getImagePath(room, skin, time) {
        const key = getImageKey(room, skin, time);
        return manifest.images[key] || null;
    }

    function loadTexture(url) {
        return new Promise((resolve, reject) => {
            if (textureCache[url]) { resolve(textureCache[url]); return; }
            new THREE.TextureLoader().load(
                url,
                tex => { textureCache[url] = tex; resolve(tex); },
                undefined,
                reject
            );
        });
    }

    async function loadPanorama(room, skin, time, withTransition = true) {
        const imgPath = getImagePath(room, skin, time);
        if (!imgPath || isTransitioning) return;

        isTransitioning = true;
        updateLoaderProgress(60);

        try {
            const texture = await loadTexture(imgPath);
            updateLoaderProgress(90);

            const geometry = new THREE.SphereGeometry(500, 60, 40);
            geometry.scale(-1, 1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: withTransition ? 0 : 1
            });
            const newSphere = new THREE.Mesh(geometry, material);
            scene.add(newSphere);

            if (withTransition && currentSphere) {
                await crossfade(currentSphere.material, material, 700);
                scene.remove(currentSphere);
                currentSphere.geometry.dispose();
                currentSphere.material.dispose();
            }

            currentSphere = newSphere;
            currentSphere.material.transparent = false;
            currentSphere.material.opacity = 1;
        } catch (e) {
            console.warn('Failed to load panorama:', imgPath, e);
        }

        isTransitioning = false;
        updateLoaderProgress(100);
    }

    function crossfade(oldMat, newMat, duration) {
        return new Promise(resolve => {
            const start = performance.now();
            function step(now) {
                const t = Math.min((now - start) / duration, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                newMat.opacity = ease;
                oldMat.opacity = 1 - ease;
                if (t < 1) requestAnimationFrame(step);
                else resolve();
            }
            requestAnimationFrame(step);
        });
    }

    /* ========= ANIMATION LOOP ========= */
    function animate() {
        requestAnimationFrame(animate);

        // Auto-rotate
        if (autoRotate && !autoRotatePaused && !isDragging) {
            lon += 0.03;
        }

        // Smooth FOV
        camera.fov += (targetFov - camera.fov) * 0.08;
        camera.updateProjectionMatrix();

        // Update camera direction
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon);
        const target = new THREE.Vector3(
            500 * Math.sin(phi) * Math.cos(theta),
            500 * Math.cos(phi),
            500 * Math.sin(phi) * Math.sin(theta)
        );
        camera.lookAt(target);

        renderer.render(scene, camera);
    }

    /* ========= UI BUILDING ========= */
    function buildUI() {
        buildModelSelector();
        buildSkinSelector();
        buildGalleryTabs();
    }

    function buildModelSelector() {
        const container = document.getElementById('model-selector');
        container.innerHTML = '';
        manifest.rooms.forEach(room => {
            const btn = document.createElement('button');
            btn.className = 'model-btn' + (room === currentRoom ? ' active' : '');
            btn.textContent = room;
            btn.dataset.room = room;
            btn.addEventListener('click', () => switchRoom(room));
            container.appendChild(btn);
        });
    }

    function buildSkinSelector() {
        const container = document.getElementById('skin-selector');
        container.innerHTML = '';
        manifest.skins.forEach(skin => {
            const btn = document.createElement('button');
            btn.className = 'skin-btn' + (skin === currentSkin ? ' active' : '');
            btn.textContent = SKIN_DISPLAY[skin] || skin;
            btn.dataset.skin = skin;
            btn.addEventListener('click', () => switchSkin(skin));
            container.appendChild(btn);
        });
    }

    function buildGalleryTabs() {
        const container = document.getElementById('gallery-tabs');
        container.innerHTML = '';
        const keys = Object.keys(manifest.gallery);

        keys.forEach((key, i) => {
            const btn = document.createElement('button');
            btn.className = 'gallery-tab' + (i === 0 ? ' active' : '');
            btn.textContent = key;
            btn.addEventListener('click', () => showGalleryTab(key, btn));
            container.appendChild(btn);
        });

        if (keys.length > 0) {
            currentGalleryTab = keys[0];
            buildGalleryGrid(keys[0]);
        }
    }

    function buildGalleryGrid(tabKey) {
        const container = document.getElementById('gallery-grid');
        container.innerHTML = '';
        const images = manifest.gallery[tabKey] || [];

        images.forEach((src, i) => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            const img = document.createElement('img');
            img.src = src;
            img.alt = tabKey + ' tile ' + (i + 1);
            img.loading = 'lazy';
            img.onload = () => img.classList.add('loaded');
            item.appendChild(img);
            item.addEventListener('click', () => openLightbox(images, i));
            container.appendChild(item);
        });
    }

    /* ========= CONTROLS ========= */
    function switchRoom(room) {
        if (room === currentRoom || isTransitioning) return;
        currentRoom = room;
        updateActiveClass('.model-btn', 'room', room);
        loadPanorama(currentRoom, currentSkin, currentTime);
    }

    function switchSkin(skin) {
        if (skin === currentSkin || isTransitioning) return;
        currentSkin = skin;
        updateActiveClass('.skin-btn', 'skin', skin);
        loadPanorama(currentRoom, currentSkin, currentTime);
    }

    function toggleDayNight() {
        if (isTransitioning) return;
        isDay = !isDay;
        currentTime = isDay ? 'Day' : 'Night';

        const thumb = document.getElementById('toggle-thumb');
        const track = document.getElementById('toggle-track');
        thumb.classList.toggle('night', !isDay);
        track.classList.toggle('night', !isDay);

        loadPanorama(currentRoom, currentSkin, currentTime);
    }

    function zoomIn() {
        targetFov = Math.max(30, targetFov - 8);
        resetIdle();
    }

    function zoomOut() {
        targetFov = Math.min(100, targetFov + 8);
        resetIdle();
    }

    function toggleAutoRotate() {
        autoRotate = !autoRotate;
        document.getElementById('btn-auto-rotate').classList.toggle('active', autoRotate);
    }

    function updateActiveClass(selector, dataAttr, value) {
        document.querySelectorAll(selector).forEach(btn => {
            btn.classList.toggle('active', btn.dataset[dataAttr] === value);
        });
    }

    /* ========= GALLERY ========= */
    function openGallery() {
        document.getElementById('gallery-overlay').classList.add('active');
    }

    function closeGallery() {
        document.getElementById('gallery-overlay').classList.remove('active');
    }

    function showGalleryTab(key, btn) {
        currentGalleryTab = key;
        document.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        buildGalleryGrid(key);
    }

    /* ========= LIGHTBOX ========= */
    function openLightbox(images, index) {
        lightboxImages = images;
        lightboxIndex = index;
        document.getElementById('lightbox-img').src = images[index];
        document.getElementById('lightbox').classList.add('active');
    }

    function closeLightbox() {
        document.getElementById('lightbox').classList.remove('active');
    }

    function lightboxPrev() {
        lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
        document.getElementById('lightbox-img').src = lightboxImages[lightboxIndex];
    }

    function lightboxNext() {
        lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
        document.getElementById('lightbox-img').src = lightboxImages[lightboxIndex];
    }

    /* ========= EVENTS ========= */
    function setupEvents() {
        // Zoom
        document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
        document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
        document.getElementById('btn-auto-rotate').addEventListener('click', toggleAutoRotate);

        // Day/Night
        document.getElementById('day-night-toggle').addEventListener('click', toggleDayNight);

        // Gallery
        document.getElementById('btn-gallery').addEventListener('click', openGallery);
        document.getElementById('btn-gallery-close').addEventListener('click', closeGallery);

        // Lightbox
        document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
        document.getElementById('lightbox-prev').addEventListener('click', lightboxPrev);
        document.getElementById('lightbox-next').addEventListener('click', lightboxNext);

        // Close lightbox on background click
        document.getElementById('lightbox').addEventListener('click', e => {
            if (e.target === document.getElementById('lightbox')) closeLightbox();
        });

        // Mouse drag on viewer
        const canvas = renderer.domElement;
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointerleave', onPointerUp);

        // Mouse wheel zoom
        canvas.addEventListener('wheel', onWheel, { passive: false });

        // Touch pinch zoom
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);

        // Keyboard
        document.addEventListener('keydown', onKeyDown);

        // Resize
        window.addEventListener('resize', onResize);

        // Gyroscope
        setupGyroscope();
    }

    /* ========= POINTER / DRAG ========= */
    function onPointerDown(e) {
        if (e.pointerType === 'touch' && e.isPrimary === false) return;
        isDragging = true;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        lonStart = lon;
        latStart = lat;
        autoRotatePaused = true;
        resetIdle();
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        lon = lonStart - dx * DRAG_SPEED;
        lat = latStart + dy * DRAG_SPEED;
        lat = Math.max(-85, Math.min(85, lat));
    }

    function onPointerUp() {
        isDragging = false;
        resetIdle();
    }

    function onWheel(e) {
        e.preventDefault();
        targetFov = Math.max(30, Math.min(100, targetFov + e.deltaY * 0.04));
        resetIdle();
    }

    /* ========= TOUCH PINCH ========= */
    function onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            lastPinchDist = getTouchDist(e.touches);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDist(e.touches);
            const delta = lastPinchDist - dist;
            targetFov = Math.max(30, Math.min(100, targetFov + delta * 0.08));
            lastPinchDist = dist;
        }
    }

    function onTouchEnd() {
        lastPinchDist = 0;
    }

    function getTouchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /* ========= GYROSCOPE ========= */
    function setupGyroscope() {
        if (!window.DeviceOrientationEvent) return;

        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ needs permission
            document.addEventListener('touchstart', function reqPerm() {
                DeviceOrientationEvent.requestPermission().then(state => {
                    if (state === 'granted') enableGyro();
                }).catch(() => { });
                document.removeEventListener('touchstart', reqPerm);
            }, { once: true });
        } else {
            enableGyro();
        }
    }

    function enableGyro() {
        window.addEventListener('deviceorientation', e => {
            if (!gyroEnabled && e.alpha !== null) gyroEnabled = true;
            if (!gyroEnabled) return;

            const alpha = e.alpha || 0;
            const beta = e.beta || 0;
            const gamma = e.gamma || 0;

            // Only apply gyro when not dragging
            if (!isDragging) {
                lon = alpha * -1;
                lat = Math.max(-85, Math.min(85, (beta - 90) * -1));
            }
        });
    }

    /* ========= KEYBOARD ========= */
    function onKeyDown(e) {
        switch (e.key) {
            case 'Escape':
                closeLightbox();
                closeGallery();
                break;
            case 'ArrowLeft': lightboxPrev(); break;
            case 'ArrowRight': lightboxNext(); break;
            case '+': case '=': zoomIn(); break;
            case '-': zoomOut(); break;
        }
    }

    /* ========= RESIZE ========= */
    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /* ========= IDLE TIMER ========= */
    function resetIdle() {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            autoRotatePaused = false;
        }, 3000);
    }

    /* ========= LOADER ========= */
    let loaderProgress = 0;
    function updateLoaderProgress(target) {
        loaderProgress = target;
        const bar = document.getElementById('loader-bar');
        if (bar) bar.style.width = target + '%';
    }

    function hideLoader() {
        updateLoaderProgress(100);
        setTimeout(() => {
            document.getElementById('loader').classList.add('hidden');
        }, 400);
    }

    /* ========= START ========= */
    updateLoaderProgress(10);
    document.addEventListener('DOMContentLoaded', () => {
        updateLoaderProgress(30);
        init();
    });
})();
