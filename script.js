/**
 * @file Consola DSP Modular con Web Audio API (Optimizada para Móviles y Perillas CSS Clásicas)
 */

// ==========================================
// 1. DECLARACIÓN DE VARIABLES GLOBALES
// ==========================================
let audioCtx, streamOriginal, visualizacionId; // Contexto de audio principal, flujo multimedia de entrada y ID del bucle visual
let micSource, mainLowpass, postFilterGain;    // Fuente de audio y nodos para el filtro pasa-bajos principal
let bpHighFilter, bpLowFilter, bpPostGain;     // Nodos para el filtro de paso banda (Highpass + Lowpass)
let eqPostGain;                                // Ganancia global de compensación para el ecualizador
let chorusDelay, lfoNode, lfoGainNode, chorusDry, chorusWet, chorusOutput; // Nodos de retardo, LFO y mezcla para el efecto Chorus
let reverbConvolver, reverbDry, reverbWet, reverbOutput;                 // Nodos de convolución y ganancias para la Reverberación
let masterGain, analyser;                      // Control de volumen maestro y analizador de espectro para el visualizador

// Definición de frecuencias estándar para un ecualizador gráfico de 10 bandas y sus etiquetas descriptivas
const eqFrequencies = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const eqLabels = ["31.5", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
let eqFilters = []; // Almacenará los objetos BiquadFilter de cada banda del ecualizador

// Estados de encendido (Power ON/OFF) independientes para cada módulo de efectos
let powerStates = {
    eq: false,
    filter: false,
    bandpass: false,
    chorus: false,
    reverb: false
};

// Orden inicial predeterminado en el que la señal de audio pasa a través de los efectos (Patch Bay modular)
let cableOrder = ['filter', 'bandpass', 'eq', 'chorus', 'reverb'];

// Configuración inicial del lienzo (Canvas) 2D para renderizar el analizador de espectro visual
const canvas = document.getElementById('visualizer');
const ctxCanvas = canvas.getContext('2d');
canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;

// ==========================================
// 2. CONSTRUCCIÓN DINÁMICA DE LA INTERFAZ DE ECUALIZACIÓN
// ==========================================
const eqContainer = document.getElementById('eqContainer');
eqFrequencies.forEach((freq, index) => {
    const div = document.createElement('div');
    div.className = 'knob-control-container';
    div.setAttribute('data-eq-index', index);
    div.setAttribute('data-param', `eq_${index}`);
    div.setAttribute('data-min', '-12');
    div.setAttribute('data-max', '12');
    div.setAttribute('data-step', '0.5');
    div.setAttribute('data-val', '0');
    div.setAttribute('data-unit', 'dB');

    // Inyecta el marcado HTML para representar una perilla rotativa clásica por cada banda de frecuencia
    div.innerHTML = `
        <span class="title" style="font-size: 9px;">${eqLabels[index]}</span>
        <div class="knob-dial" style="width:36px;height:36px;"><div class="knob-indicator" style="top:3px;height:10px;transform-origin:50% 15px;"></div></div>
        <input type="number" class="knob-input" value="0" min="-12" max="12" step="0.5" style="width:40px; font-size:9px;">
    `;
    eqContainer.appendChild(div);
});

// ==========================================
// 3. FUNCIONES DE REVERBERACIÓN Y PROCESAMIENTO
// ==========================================

/**
 * Genera algorítmicamente una respuesta al impulso estéreo simulando reflexiones acústicas.
 * @param {number} duration - Duración de la cola de reverberación en segundos.
 * @param {number} decay - Factor de atenuación exponencial del decaimiento.
 */
function generarImpulseResponse(duration, decay) {
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
}

/**
 * Actualiza el búfer de convolución del efecto Reverb según el preset seleccionado en la interfaz.
 */
function actualizarPresetReverb() {
    if (!audioCtx || !reverbConvolver) return;
    const preset = document.getElementById('reverbPreset').value;
    if (preset === 'small') {
        reverbConvolver.buffer = generarImpulseResponse(0.6, 3.0);
    } else if (preset === 'studio') {
        reverbConvolver.buffer = generarImpulseResponse(1.2, 2.2);
    } else if (preset === 'large') {
        reverbConvolver.buffer = generarImpulseResponse(3.0, 1.3);
    }
}

// ==========================================
// 4. CONTROLADOR DE PERILLAS (MOUSE Y TÁCTIL)
// ==========================================

/**
 * Inicializa perillas rotativas CSS y gestiona la interacción con el Mouse y Pantallas Táctiles.
 */
function inicializarPerillas() {
    document.querySelectorAll('.knob-control-container').forEach(container => {
        const wrapper = container.querySelector('.knob-dial');
        const indicator = container.querySelector('.knob-indicator');
        const input = container.querySelector('.knob-input');

        const min = parseFloat(container.dataset.min);
        const max = parseFloat(container.dataset.max);
        const step = parseFloat(container.dataset.step);
        const param = container.dataset.param;

        // Actualiza la representación gráfica de la perilla y aplica los cambios en el motor DSP de audio
        function actualizarGraficoYAudio(val) {
            val = Math.max(min, Math.min(max, val));
            const decimals = (step.toString().split('.')[1] || '').length;
            val = parseFloat(val.toFixed(decimals));
            input.value = val;

            // Mapeo lineal del valor numérico a grados de rotación (-135° a +135°, total de 270°)
            const porcentaje = (val - min) / (max - min);
            const angle = -135 + (porcentaje * 270);
            if (indicator) {
                indicator.style.transform = `rotate(${angle}deg)`;
            }

            aplicarCambioAudio(param, val, container);
        }

        let isDragging = false, startY = 0, startVal = 0;

        // Inicia el gesto de arrastre vertical para mover la perilla
        function handleStart(clientY) {
            if (input.disabled) return;
            isDragging = true;
            startY = clientY;
            startVal = parseFloat(input.value);
            document.body.style.cursor = 'ns-resize';
        }

        // Calcula el desplazamiento vertical del cursor o dedo y ajusta el valor proporcionalmente
        function handleMove(clientY) {
            if (!isDragging) return;
            const deltaY = startY - clientY;
            const range = max - min;
            const newVal = startVal + (deltaY / 150) * range;
            actualizarGraficoYAudio(newVal);
        }

        // Finaliza la interacción de arrastre
        function handleEnd() {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = 'default';
            }
        }

        // Eventos de interacción con el Mouse
        wrapper.addEventListener('mousedown', (e) => { handleStart(e.clientY); e.preventDefault(); });
        window.addEventListener('mousemove', (e) => { handleMove(e.clientY); });
        window.addEventListener('mouseup', handleEnd);

        // Eventos de interacción Táctil para dispositivos móviles y tablets
        wrapper.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) handleStart(e.touches[0].clientY);
            e.preventDefault();
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length > 0) handleMove(e.touches[0].clientY);
        }, { passive: true });

        window.addEventListener('touchend', handleEnd);

        // Permite la sincronización si el usuario escribe directamente en el input numérico oculto/secundario
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) actualizarGraficoYAudio(val);
        });

        // Inicializa la perilla con su valor predeterminado
        actualizarGraficoYAudio(parseFloat(input.value));
    });
}

/**
 * Traduce los cambios físicos de las perillas en modificaciones de parámetros de los nodos Web Audio API en tiempo real.
 */
function aplicarCambioAudio(param, val, container) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const nyquistLimit = audioCtx.sampleRate / 2 - 100;

    // Modifica las bandas del ecualizador si está encendido
    if (param.startsWith('eq_') && powerStates.eq) {
        const index = parseInt(container.dataset.eqIndex);
        if (eqFilters[index]) eqFilters[index].gain.setTargetAtTime(val, now, 0.05);
    } else if (param === 'eqGain' && powerStates.eq) {
        if (eqPostGain) eqPostGain.gain.setTargetAtTime(val, now, 0.05);
    // Modifica los parámetros del filtro Lowpass principal
    } else if (param === 'fc' && powerStates.filter) {
        if (mainLowpass) mainLowpass.frequency.setTargetAtTime(Math.max(10, Math.min(nyquistLimit, val)), now, 0.05);
    } else if (param === 'qFactor' && powerStates.filter) {
        if (mainLowpass) mainLowpass.Q.setTargetAtTime(Math.max(0.0001, Math.min(15, val)), now, 0.05);
    } else if (param === 'gainFiltro' && powerStates.filter) {
        if (postFilterGain) postFilterGain.gain.setTargetAtTime(val, now, 0.05);
    // Modifica los cortes del filtro Bandpass
    } else if (param === 'bpLowCut' && powerStates.bandpass) {
        if (bpHighFilter) bpHighFilter.frequency.setTargetAtTime(Math.max(10, Math.min(nyquistLimit, val)), now, 0.05);
    } else if (param === 'bpHighCut' && powerStates.bandpass) {
        if (bpLowFilter) bpLowFilter.frequency.setTargetAtTime(Math.max(100, Math.min(nyquistLimit, val)), now, 0.05);
    // Modifica los parámetros del efecto Chorus (Velocidad, Profundidad y Mezcla Dry/Wet)
    } else if (param === 'chorusRate' && powerStates.chorus) {
        if (lfoNode) lfoNode.frequency.setTargetAtTime(val, now, 0.05);
    } else if (param === 'chorusDepth' && powerStates.chorus) {
        if (lfoGainNode) lfoGainNode.gain.setTargetAtTime(val / 1000.0, now, 0.05);
    } else if (param === 'chorusMix' && powerStates.chorus) {
        if (chorusDry && chorusWet) {
            chorusDry.gain.setTargetAtTime(Math.cos(val * 0.5 * Math.PI), now, 0.05);
            chorusWet.gain.setTargetAtTime(Math.sin(val * 0.5 * Math.PI), now, 0.05);
        }
    // Modifica el volumen general de salida maestro
    } else if (param === 'volMaster') {
        if (masterGain) masterGain.gain.setTargetAtTime(val, now, 0.05);
    }
}

// Inicialización de componentes cuando el DOM termina de cargar
window.addEventListener('DOMContentLoaded', () => {
    inicializarPerillas();
    configurarPatchBayDragAndDrop();
    document.getElementById('reverbPreset').addEventListener('change', actualizarPresetReverb);
});

// ==========================================
// 5. GESTIÓN DEL PATCH BAY Y RUTEO MODULAR
// ==========================================

/**
 * Configura la funcionalidad de arrastrar y soltar (Drag and Drop) para reordenar los módulos de efectos visualmente.
 */
function configurarPatchBayDragAndDrop() {
    const slots = document.getElementById('patchSlots');
    let draggedItem = null;

    slots.querySelectorAll('.patch-chip').forEach(chip => {
        chip.addEventListener('dragstart', () => {
            draggedItem = chip;
            setTimeout(() => chip.style.opacity = '0.4', 0);
        });
        chip.addEventListener('dragend', () => {
            draggedItem.style.opacity = '1';
            draggedItem = null;
            actualizarOrdenCablesDesdeDOM();
        });
        chip.addEventListener('dragover', e => e.preventDefault());
        chip.addEventListener('drop', function () {
            if (draggedItem !== this) {
                let allChips = [...slots.querySelectorAll('.patch-chip')];
                let draggedIndex = allChips.indexOf(draggedItem);
                let targetIndex = allChips.indexOf(this);
                if (draggedIndex < targetIndex) {
                    this.after(draggedItem);
                } else {
                    this.before(draggedItem);
                }
            }
        });
    });
}

/**
 * Lee el nuevo orden de los elementos visuales en el DOM y reconstruye el flujo de audio en cadena.
 */
function actualizarOrdenCablesDesdeDOM() {
    const chips = document.querySelectorAll('#patchSlots .patch-chip');
    cableOrder = Array.from(chips).map(c => c.dataset.mod);
    if (audioCtx) reconstruirGrafoDeAudio();
}

/**
 * Configura los botones de encendido/apagado (Power) individuales para cada efecto de la consola.
 */
function setupPowerButton(btnId, modKey, uiId) {
    document.getElementById(btnId).addEventListener('click', () => {
        powerStates[modKey] = !powerStates[modKey];
        const btn = document.getElementById(btnId);
        const modBox = document.getElementById(uiId);

        btn.classList.toggle('active', powerStates[modKey]);
        btn.textContent = `Power: ${powerStates[modKey] ? 'ON' : 'OFF'}`;
        modBox.style.opacity = powerStates[modKey] ? '1' : '0.5';

        if (audioCtx) reconstruirGrafoDeAudio();
    });
}

// Vinculación de los botones de encendido por módulo
setupPowerButton('btnFilterPower', 'filter', 'modFilter');
setupPowerButton('btnBandpassPower', 'bandpass', 'modBandpass');
setupPowerButton('btnEqPower', 'eq', 'modEq');
setupPowerButton('btnChorusPower', 'chorus', 'modChorus');
setupPowerButton('btnReverbPower', 'reverb', 'modReverb');

/**
 * Desconecta todos los nodos del grafo actual y los vuelve a interconectar dinámicamente
 * respetando el orden especificado en `cableOrder` y el estado de encendido (`powerStates`).
 */
function reconstruirGrafoDeAudio() {
    if (!audioCtx) return;

    // Desconecta preventivamente todos los nodos de audio para evitar fugas de memoria o ruidos parásitos
    micSource.disconnect();
    mainLowpass.disconnect();
    postFilterGain.disconnect();
    bpHighFilter.disconnect();
    bpLowFilter.disconnect();
    bpPostGain.disconnect();
    eqFilters.forEach(f => f.disconnect());
    eqPostGain.disconnect();
    chorusDelay.disconnect();
    lfoGainNode.disconnect();
    chorusDry.disconnect();
    chorusWet.disconnect();
    chorusOutput.disconnect();
    reverbConvolver.disconnect();
    reverbDry.disconnect();
    reverbWet.disconnect();
    reverbOutput.disconnect();
    masterGain.disconnect();

    let currentNode = micSource;

    // Recorre el orden de los módulos configurados en el patch bay modular
    cableOrder.forEach(mod => {
        if (mod === 'filter') {
            currentNode.connect(mainLowpass);
            mainLowpass.connect(postFilterGain);
            currentNode = postFilterGain;

            if (!powerStates.filter) {
                postFilterGain.gain.value = 1;
                mainLowpass.frequency.value = 20000; // Bypass si está apagado
            } else {
                const val = parseFloat(document.querySelector('.knob-control-container[data-param="gainFiltro"] input').value);
                postFilterGain.gain.value = val;
            }
        } else if (mod === 'bandpass') {
            currentNode.connect(bpHighFilter);
            bpHighFilter.connect(bpLowFilter);
            bpLowFilter.connect(bpPostGain);
            currentNode = bpPostGain;

            if (!powerStates.bandpass) {
                bpHighFilter.frequency.value = 20;
                bpLowFilter.frequency.value = 20000;
                bpPostGain.gain.value = 1;
            } else {
                const lowVal = parseFloat(document.querySelector('.knob-control-container[data-param="bpLowCut"] input').value);
                const highVal = parseFloat(document.querySelector('.knob-control-container[data-param="bpHighCut"] input').value);
                bpHighFilter.frequency.value = lowVal;
                bpLowFilter.frequency.value = highVal;
                bpPostGain.gain.value = 1;
            }
        } else if (mod === 'eq') {
            eqFilters.forEach(filter => {
                currentNode.connect(filter);
                currentNode = filter;
            });
            eqFilters[eqFilters.length - 1].connect(eqPostGain);
            currentNode = eqPostGain;

            if (!powerStates.eq) {
                eqFilters.forEach(f => f.gain.value = 0);
                eqPostGain.gain.value = 1;
            } else {
                const trimVal = parseFloat(document.querySelector('.knob-control-container[data-param="eqGain"] input').value);
                eqPostGain.gain.value = trimVal;
            }
        } else if (mod === 'chorus') {
            currentNode.connect(chorusDry);
            currentNode.connect(chorusDelay);
            chorusDelay.connect(chorusWet);
            chorusDry.connect(chorusOutput);
            chorusWet.connect(chorusOutput);

            if (!powerStates.chorus) {
                chorusWet.gain.value = 0;
                chorusDry.gain.value = 1;
            } else {
                const mixVal = parseFloat(document.querySelector('.knob-control-container[data-param="chorusMix"] input').value);
                chorusDry.gain.value = Math.cos(mixVal * 0.5 * Math.PI);
                chorusWet.gain.value = Math.sin(mixVal * 0.5 * Math.PI);
            }
            currentNode = chorusOutput;
        } else if (mod === 'reverb') {
            currentNode.connect(reverbDry);
            currentNode.connect(reverbConvolver);
            reverbConvolver.connect(reverbWet);
            reverbDry.connect(reverbOutput);
            reverbWet.connect(reverbOutput);

            if (!powerStates.reverb) {
                reverbWet.gain.value = 0;
                reverbDry.gain.value = 1;
            } else {
                reverbWet.gain.value = 0.4;
                reverbDry.gain.value = 0.8;
            }
            currentNode = reverbOutput;
        }
    });

    // Envía la cadena de procesamiento final al canal maestro, analizador y salida de audio física
    currentNode.connect(masterGain);
    masterGain.connect(analyser);
    masterGain.connect(audioCtx.destination);
}

// ==========================================
// 6. CONTROL DE INICIO Y CIERRE DEL MOTOR DE AUDIO
// ==========================================

// Evento al presionar el botón de inicio de audio
document.getElementById('btnStart').addEventListener('click', async () => {
    try {
        const sourceType = document.getElementById('audioSource').value;
        if (sourceType === 'mic') {
            // Captura de audio desde el micrófono del dispositivo
            streamOriginal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
            // Captura de audio desde una pestaña o pantalla compartida
            streamOriginal = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            streamOriginal.getVideoTracks().forEach(track => track.stop()); // Detiene el vídeo ya que solo se requiere audio
        }

        // Instanciación del contexto principal de Web Audio API
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        document.getElementById('lblFs').textContent = `fs: ${(audioCtx.sampleRate / 1000).toFixed(1)} kHz`;

        // Creación y configuración inicial de los nodos DSP principales
        micSource = audioCtx.createMediaStreamSource(streamOriginal);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        masterGain = audioCtx.createGain();

        // Configuración del filtro Lowpass
        mainLowpass = audioCtx.createBiquadFilter();
        postFilterGain = audioCtx.createGain();
        mainLowpass.type = 'lowpass';

        // Configuración del filtro Bandpass
        bpHighFilter = audioCtx.createBiquadFilter();
        bpLowFilter = audioCtx.createBiquadFilter();
        bpHighFilter.type = 'highpass';
        bpLowFilter.type = 'lowpass';
        bpPostGain = audioCtx.createGain();

        // Configuración de las bandas del ecualizador paramétrico/peaking
        eqFilters = eqFrequencies.map(freq => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.414;
            filter.gain.value = 0;
            return filter;
        });
        eqPostGain = audioCtx.createGain();

        // Configuración del efecto Chorus con un oscilador LFO modulando el tiempo de retardo
        chorusDelay = audioCtx.createDelay(0.1);
        chorusDelay.delayTime.value = 0.025;
        lfoNode = audioCtx.createOscillator();
        lfoNode.type = 'sine';
        lfoNode.frequency.value = 1.5;
        lfoGainNode = audioCtx.createGain();
        lfoGainNode.gain.value = 0.005;
        lfoNode.connect(lfoGainNode);
        lfoGainNode.connect(chorusDelay.delayTime);
        lfoNode.start();

        chorusDry = audioCtx.createGain();
        chorusWet = audioCtx.createGain();
        chorusOutput = audioCtx.createGain();

        // Configuración del efecto Reverb (Convolución)
        reverbConvolver = audioCtx.createConvolver();
        actualizarPresetReverb();
        reverbDry = audioCtx.createGain();
        reverbWet = audioCtx.createGain();
        reverbOutput = audioCtx.createGain();

        masterGain.gain.value = parseFloat(document.querySelector('.knob-control-container[data-param="volMaster"] input').value);

        // Genera el grafo de conexiones inicial
        reconstruirGrafoDeAudio();

        // Intercambio de visibilidad de botones de control general
        document.getElementById('btnStart').style.display = 'none';
        document.getElementById('btnStop').style.display = 'block';
        document.getElementById('audioSource').disabled = true;

        iniciarVisualizadorAvanzado();

    } catch (err) {
        alert('Error al iniciar el motor de audio: ' + err.message);
    }
});

// Evento al presionar el botón de detención y apagado del sistema de audio
document.getElementById('btnStop').addEventListener('click', () => {
    if (streamOriginal) streamOriginal.getTracks().forEach(track => track.stop());
    if (audioCtx) {
        audioCtx.close();
        cancelAnimationFrame(visualizacionId);
        ctxCanvas.clearRect(0, 0, canvas.width, canvas.height);
    }
    document.getElementById('btnStart').style.display = 'block';
    document.getElementById('btnStop').style.display = 'none';
    document.getElementById('audioSource').disabled = false;
    document.getElementById('freqDescription').textContent = "Frecuencia Dominante: --";
});

// ==========================================
// 7. VISUALIZADOR DE ESPECTRO EN TIEMPO REAL
// ==========================================

/**
 * Traduce un valor en Hz al rango musical descriptivo correspondiente.
 */
function obtenerNombreRangoFrecuencia(freqHz) {
    if (freqHz < 60) return "Sub-graves (< 60 Hz)";
    if (freqHz < 250) return "Graves (60 - 250 Hz)";
    if (freqHz < 500) return "Medios-graves (250 - 500 Hz)";
    if (freqHz < 2000) return "Medios / Voz (500 Hz - 2 kHz)";
    if (freqHz < 6000) return "Presencia (2 - 6 kHz)";
    if (freqHz < 12000) return "Brillo (6 - 12 kHz)";
    return "Aire (> 12 kHz)";
}

/**
 * Inicia el bucle gráfico de renderizado del analizador en el Canvas empleando requestAnimationFrame.
 */
function iniciarVisualizadorAvanzado() {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function loop() {
        if (!audioCtx || audioCtx.state === 'closed') return;
        visualizacionId = requestAnimationFrame(loop);

        // Obtiene los datos de frecuencia del analizador de audio
        analyser.getByteFrequencyData(dataArray);

        // Limpia el lienzo del canvas
        ctxCanvas.fillStyle = '#111';
        ctxCanvas.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.8;
        let barHeight, x = 0, maxVal = 0, maxIndex = 0;

        // Dibuja las barras del espectro de frecuencias aplicando un mapa cromático HSL
        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * canvas.height;
            if (dataArray[i] > maxVal) {
                maxVal = dataArray[i];
                maxIndex = i;
            }
            const hue = (i / bufferLength) * 140 + 80;
            ctxCanvas.fillStyle = `hsl(${hue}, 80%, 50%)`;
            ctxCanvas.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }

        // Calcula y muestra la frecuencia dominante detectada en el audio
        const dominantFreq = (maxIndex / bufferLength) * (audioCtx.sampleRate / 2);
        if (maxVal > 20) {
            document.getElementById('freqDescription').textContent =
                `Dominante: ${Math.round(dominantFreq)} Hz — ${obtenerNombreRangoFrecuencia(dominantFreq)}`;
        } else {
            document.getElementById('freqDescription').textContent = "Escuchando audio...";
        }
    }
    loop();
}
