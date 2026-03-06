class HarmonyRecorder {
    constructor() {
        this.tracks = [];
        this.audioContext = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.isPlayingAll = false;
        this.recordingStartTime = 0;
        this.timerInterval = null;
        this.trackIdCounter = 0;
        this.db = null;
        this.audioUnlocked = false;
        this.currentMimeType = '';
        this.globalAnimationFrame = null;
        this.savedMuteStates = null;
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        this.analyser = null;
        this.liveWaveformAnimationFrame = null;
        this.pitchAnimationFrame = null;
        this.audioDataArray = null;
        this.pitchBuffer = null;
        this.liveWaveformColor = '#3b82f6';

        this.initElements();
        this.initEventListeners();
        this.initDatabase().then(() => this.loadTracksFromStorage());
    }

    initElements() {
        this.recordBtn = document.getElementById('recordBtn');
        this.playAllBtn = document.getElementById('playAllBtn');
        this.muteAllBtn = document.getElementById('muteAllBtn');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.recordTimer = document.getElementById('recordTimer');
        this.tracksContainer = document.getElementById('tracksContainer');
        this.emptyState = document.getElementById('emptyState');
        this.trackCount = document.getElementById('trackCount');
        this.trackTemplate = document.getElementById('trackTemplate');
        
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsModal = document.getElementById('settingsModal');
        this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
        this.inputDeviceSelect = document.getElementById('inputDevice');
        this.outputDeviceSelect = document.getElementById('outputDevice');
        this.refreshDevicesBtn = document.getElementById('refreshDevicesBtn');
        
        this.liveRecordingSection = document.getElementById('liveRecordingSection');
        this.liveWaveformCanvas = document.getElementById('liveWaveform');
        this.liveRecordingTime = document.getElementById('liveRecordingTime');
        this.pitchNote = document.getElementById('pitchNote');
        this.pitchOctave = document.getElementById('pitchOctave');
        this.pitchIndicator = document.getElementById('pitchIndicator');
        this.pitchFrequency = document.getElementById('pitchFrequency');
    }

    initEventListeners() {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.recordBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.toggleRecording();
        });
        this.playAllBtn.addEventListener('click', () => this.togglePlayAll());
        this.playAllBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.togglePlayAll();
        });
        this.muteAllBtn.addEventListener('click', () => this.toggleMuteAll());
        this.muteAllBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.toggleMuteAll();
        });

        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.closeSettings();
        });
        this.refreshDevicesBtn.addEventListener('click', () => this.refreshDevices());
        this.inputDeviceSelect.addEventListener('change', () => this.saveDeviceSettings());
        this.outputDeviceSelect.addEventListener('change', () => this.saveDeviceSettings());

        document.addEventListener('touchstart', () => this.unlockAudio(), { once: true });
        document.addEventListener('click', () => this.unlockAudio(), { once: true });
        
        this.loadDeviceSettings();
    }

    async openSettings() {
        this.settingsModal.classList.add('open');
        await this.refreshDevices();
    }

    closeSettings() {
        this.settingsModal.classList.remove('open');
    }

    async refreshDevices() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

            const savedInput = localStorage.getItem('harmonyInputDevice') || '';
            const savedOutput = localStorage.getItem('harmonyOutputDevice') || '';

            this.inputDeviceSelect.innerHTML = '<option value="">Default</option>';
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${this.inputDeviceSelect.options.length}`;
                option.selected = device.deviceId === savedInput;
                this.inputDeviceSelect.appendChild(option);
            });

            this.outputDeviceSelect.innerHTML = '<option value="">Default</option>';
            audioOutputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Speaker ${this.outputDeviceSelect.options.length}`;
                option.selected = device.deviceId === savedOutput;
                this.outputDeviceSelect.appendChild(option);
            });

        } catch (err) {
            console.error('Error enumerating devices:', err);
        }
    }

    saveDeviceSettings() {
        localStorage.setItem('harmonyInputDevice', this.inputDeviceSelect.value);
        localStorage.setItem('harmonyOutputDevice', this.outputDeviceSelect.value);
        this.applyOutputDevice();
    }

    loadDeviceSettings() {
        const savedInput = localStorage.getItem('harmonyInputDevice') || '';
        const savedOutput = localStorage.getItem('harmonyOutputDevice') || '';
        this.inputDeviceSelect.value = savedInput;
        this.outputDeviceSelect.value = savedOutput;
    }

    async applyOutputDevice() {
        const outputDeviceId = this.outputDeviceSelect.value;
        if (!outputDeviceId) return;

        try {
            if (this.audioContext && this.audioContext.setSinkId) {
                await this.audioContext.setSinkId(outputDeviceId);
            }
        } catch (err) {
            console.log('Could not set output device:', err);
        }
    }

    setupLiveAnalysis(stream) {
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;
        
        source.connect(this.analyser);
        
        this.audioDataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.pitchBuffer = new Float32Array(this.analyser.fftSize);
        
        this.liveRecordingSection.classList.add('active');
        this.startLiveWaveform();
        this.startPitchDetection();
    }

    stopLiveAnalysis() {
        if (this.liveWaveformAnimationFrame) {
            cancelAnimationFrame(this.liveWaveformAnimationFrame);
            this.liveWaveformAnimationFrame = null;
        }
        if (this.pitchAnimationFrame) {
            cancelAnimationFrame(this.pitchAnimationFrame);
            this.pitchAnimationFrame = null;
        }
        
        this.liveRecordingSection.classList.remove('active', 'in-tune');
        this.resetPitchDisplay();
    }

    startLiveWaveform() {
        const canvas = this.liveWaveformCanvas;
        const ctx = canvas.getContext('2d');
        
        const draw = () => {
            if (!this.isRecording) return;
            
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            
            const width = rect.width;
            const height = rect.height;
            
            this.analyser.getByteTimeDomainData(this.audioDataArray);
            
            ctx.fillStyle = 'transparent';
            ctx.clearRect(0, 0, width, height);
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = this.liveWaveformColor || '#3b82f6';
            ctx.beginPath();
            
            const sliceWidth = width / this.audioDataArray.length;
            let x = 0;
            
            for (let i = 0; i < this.audioDataArray.length; i++) {
                const v = this.audioDataArray[i] / 128.0;
                const y = (v * height) / 2;
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            
            ctx.stroke();
            
            const elapsed = Date.now() - this.recordingStartTime;
            this.liveRecordingTime.textContent = this.formatTime(elapsed);
            
            this.liveWaveformAnimationFrame = requestAnimationFrame(draw);
        };
        
        draw();
    }

    startPitchDetection() {
        const noteStrings = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        
        const detect = () => {
            if (!this.isRecording) return;
            
            this.analyser.getFloatTimeDomainData(this.pitchBuffer);
            
            const frequency = this.detectPitch(this.pitchBuffer, this.audioContext.sampleRate);
            
            if (frequency !== -1 && frequency > 60 && frequency < 1200) {
                const noteNum = 12 * (Math.log2(frequency / 440)) + 69;
                const roundedNote = Math.round(noteNum);
                const cents = Math.floor((noteNum - roundedNote) * 100);
                
                const noteName = noteStrings[roundedNote % 12];
                const octave = Math.floor(roundedNote / 12) - 1;
                
                this.pitchNote.textContent = noteName;
                this.pitchOctave.textContent = octave;
                this.pitchFrequency.textContent = `${Math.round(frequency)} Hz`;
                
                const offset = Math.max(-50, Math.min(50, cents));
                const position = 50 + offset;
                this.pitchIndicator.style.left = `${position}%`;
                
                this.pitchIndicator.classList.remove('flat', 'sharp', 'in-tune');
                this.pitchNote.classList.remove('flat', 'sharp', 'in-tune');
                this.liveRecordingSection.classList.remove('in-tune');
                if (Math.abs(cents) <= 5) {
                    this.pitchIndicator.classList.add('in-tune');
                    this.pitchNote.classList.add('in-tune');
                    this.liveRecordingSection.classList.add('in-tune');
                    this.liveWaveformColor = '#22c55e';
                } else if (cents < 0) {
                    this.pitchIndicator.classList.add('flat');
                    this.pitchNote.classList.add('flat');
                    this.liveWaveformColor = '#3b82f6';
                } else {
                    this.pitchIndicator.classList.add('sharp');
                    this.pitchNote.classList.add('sharp');
                    this.liveWaveformColor = '#3b82f6';
                }
            } else {
                this.pitchNote.textContent = '--';
                this.pitchOctave.textContent = '';
                this.pitchFrequency.textContent = '-- Hz';
                this.pitchIndicator.style.left = '50%';
                this.pitchIndicator.classList.remove('flat', 'sharp', 'in-tune');
                this.pitchNote.classList.remove('flat', 'sharp', 'in-tune');
                this.liveRecordingSection.classList.remove('in-tune');
                this.liveWaveformColor = '#3b82f6';
            }
            
            this.pitchAnimationFrame = requestAnimationFrame(detect);
        };
        
        detect();
    }

    detectPitch(buffer, sampleRate) {
        let size = buffer.length;
        let maxSamples = Math.floor(size / 2);
        let bestOffset = -1;
        let bestCorrelation = 0;
        let foundGoodCorrelation = false;
        let correlations = new Array(maxSamples);
        
        let rms = 0;
        for (let i = 0; i < size; i++) {
            const val = buffer[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / size);
        
        if (rms < 0.01) return -1;
        
        let lastCorrelation = 1;
        for (let offset = 0; offset < maxSamples; offset++) {
            let correlation = 0;
            
            for (let i = 0; i < maxSamples; i++) {
                correlation += Math.abs(buffer[i] - buffer[i + offset]);
            }
            correlation = 1 - (correlation / maxSamples);
            correlations[offset] = correlation;
            
            if ((correlation > 0.9) && (correlation > lastCorrelation)) {
                foundGoodCorrelation = true;
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    bestOffset = offset;
                }
            } else if (foundGoodCorrelation) {
                let shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
                return sampleRate / (bestOffset + (8 * shift));
            }
            lastCorrelation = correlation;
        }
        
        if (bestCorrelation > 0.01) {
            return sampleRate / bestOffset;
        }
        return -1;
    }

    resetPitchDisplay() {
        this.pitchNote.textContent = '--';
        this.pitchOctave.textContent = '';
        this.pitchFrequency.textContent = '-- Hz';
        this.pitchIndicator.style.left = '50%';
        this.pitchIndicator.classList.remove('flat', 'sharp', 'in-tune');
        this.pitchNote.classList.remove('flat', 'sharp', 'in-tune');
        this.liveRecordingSection.classList.remove('in-tune');
        this.liveWaveformColor = '#3b82f6';
    }

    async unlockAudio() {
        if (this.audioUnlocked) return;
        
        try {
            await this.initAudioContext();
            
            const buffer = this.audioContext.createBuffer(1, 1, 22050);
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            source.start(0);
            
            this.audioUnlocked = true;
            console.log('Audio unlocked for iOS');
            
            this.decodeAllTracks();
        } catch (e) {
            console.log('Audio unlock attempt:', e);
        }
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('HarmonyRecorderDB', 1);

            request.onerror = () => {
                console.error('Failed to open database');
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('tracks')) {
                    const store = db.createObjectStore('tracks', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    async saveTrackToStorage(track) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['tracks'], 'readwrite');
            const store = transaction.objectStore('tracks');

            const trackData = {
                id: track.id,
                name: track.name,
                blob: track.blob,
                duration: track.duration,
                volume: track.volume,
                muted: track.muted,
                offset: track.offset || 0,
                createdAt: Date.now()
            };

            const request = store.put(trackData);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteTrackFromStorage(trackId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['tracks'], 'readwrite');
            const store = transaction.objectStore('tracks');
            const request = store.delete(trackId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadTracksFromStorage() {
        if (!this.db) return;

        return new Promise(async (resolve) => {
            const transaction = this.db.transaction(['tracks'], 'readonly');
            const store = transaction.objectStore('tracks');
            const index = store.index('createdAt');
            const request = index.openCursor();

            const tracksToLoad = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    tracksToLoad.push(cursor.value);
                    cursor.continue();
                } else {
                    this.restoreTracks(tracksToLoad).then(resolve);
                }
            };

            request.onerror = () => resolve();
        });
    }

    async restoreTracks(tracksData) {
        if (tracksData.length === 0) return;

        for (const trackData of tracksData) {
            try {
                const track = {
                    id: trackData.id,
                    name: trackData.name,
                    blob: trackData.blob,
                    audioBuffer: null,
                    duration: trackData.duration,
                    volume: trackData.volume,
                    muted: trackData.muted,
                    offset: trackData.offset || 0,
                    source: null,
                    gainNode: null,
                    isPlaying: false,
                    playbackStartTime: 0,
                    needsDecode: true
                };

                this.tracks.push(track);
                this.trackIdCounter = Math.max(this.trackIdCounter, track.id);
                this.renderTrackPlaceholder(track);
            } catch (err) {
                console.error('Failed to restore track:', trackData.id, err);
            }
        }

        this.updateTracksUI();
        this.decodeAllTracks();
    }

    async decodeAllTracks() {
        try {
            await this.initAudioContext();
        } catch (e) {
            return;
        }

        for (const track of this.tracks) {
            if (track.needsDecode && track.blob) {
                await this.decodeTrackAudio(track);
            }
        }
    }

    async decodeTrackAudio(track) {
        if (!track.needsDecode || track.audioBuffer) return;
        
        try {
            await this.initAudioContext();
            const arrayBuffer = await track.blob.arrayBuffer();
            track.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
            track.needsDecode = false;
            
            const trackEl = this.tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
            if (trackEl) {
                const canvas = trackEl.querySelector('.waveform-canvas');
                if (canvas && track.audioBuffer) {
                    this.drawWaveform(canvas, track.audioBuffer, track.offset);
                }
            }
        } catch (err) {
            console.error('Failed to decode track:', track.id, err);
        }
    }

    renderTrackPlaceholder(track) {
        const template = this.trackTemplate.content.cloneNode(true);
        const trackEl = template.querySelector('.track');

        trackEl.dataset.trackId = track.id;
        
        const trackName = trackEl.querySelector('.track-name');
        trackName.textContent = track.name;
        trackName.addEventListener('click', () => this.startRenameTrack(track.id));
        
        trackEl.querySelector('.track-duration').textContent = this.formatTime(track.duration);

        const playBtn = trackEl.querySelector('.play-track-btn');
        const muteBtn = trackEl.querySelector('.mute-track-btn');
        const soloBtn = trackEl.querySelector('.solo-track-btn');
        const volumeSlider = trackEl.querySelector('.volume-slider');
        const deleteBtn = trackEl.querySelector('.delete-track-btn');

        volumeSlider.value = track.volume * 100;

        playBtn.addEventListener('click', () => this.toggleTrackPlayback(track.id));
        muteBtn.addEventListener('click', () => this.toggleTrackMute(track.id));
        soloBtn.addEventListener('click', () => this.toggleSolo(track.id));
        volumeSlider.addEventListener('input', (e) => this.setTrackVolume(track.id, e.target.value / 100));
        deleteBtn.addEventListener('click', () => this.deleteTrack(track.id));

        this.tracksContainer.appendChild(trackEl);

        if (track.muted) {
            trackEl.classList.add('muted');
            muteBtn.classList.add('muted');
            muteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 8.5v2.09l2.5 2.5V12zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
        }

        const canvas = trackEl.querySelector('.waveform-canvas');
        const waveform = trackEl.querySelector('.track-waveform');
        
        waveform.style.opacity = 0.3 + (track.volume * 0.7);
        
        this.setupWaveformDrag(track, waveform, canvas);
        this.setupTrackDrag(trackEl);
    }

    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        await this.applyOutputDevice();
    }

    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            await this.unlockAudio();
            await this.initAudioContext();

            const selectedInputDevice = localStorage.getItem('harmonyInputDevice') || '';
            
            const audioConstraints = this.isIOS ? {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
                ...(selectedInputDevice && { deviceId: { exact: selectedInputDevice } })
            } : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                ...(selectedInputDevice && { deviceId: { exact: selectedInputDevice } })
            };

            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: audioConstraints
            });

            this.recordedChunks = [];
            this.currentMimeType = this.getSupportedMimeType();
            
            const recorderOptions = {};
            if (this.currentMimeType) {
                recorderOptions.mimeType = this.currentMimeType;
            }
            
            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording(stream);
            };

            this.mediaRecorder.onerror = (e) => {
                console.error('MediaRecorder error:', e);
                this.stopRecording();
                alert('Recording error occurred. Please try again.');
            };

            const timeslice = this.isIOS ? 1000 : 100;
            this.mediaRecorder.start(timeslice);
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            this.updateRecordingUI(true);
            this.startTimer();
            
            this.setupLiveAnalysis(stream);

            if (this.tracks.length > 0) {
                this.muteNonBaseTracks();
                this.playBaseTrack();
            }

        } catch (err) {
            console.error('Error accessing microphone:', err);
            let message = 'Could not access your microphone. ';
            if (err.name === 'NotAllowedError') {
                message += 'Please grant microphone permission in your browser settings.';
            } else if (err.name === 'NotFoundError') {
                message += 'No microphone found on this device.';
            } else if (this.isIOS) {
                message += 'On iOS, make sure you\'re using Safari and have granted microphone access.';
            } else {
                message += 'Please ensure you have granted permission.';
            }
            alert(message);
        }
    }

    getSupportedMimeType() {
        const types = [
            'audio/mp4',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/aac',
            'audio/mpeg'
        ];
        
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
            return '';
        }
        
        for (const type of types) {
            try {
                if (MediaRecorder.isTypeSupported(type)) {
                    console.log('Using MIME type:', type);
                    return type;
                }
            } catch (e) {
                continue;
            }
        }
        console.log('No specific MIME type supported, using default');
        return '';
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        this.updateRecordingUI(false);
        this.stopTimer();
        this.stopAllTracks();
        this.restoreMuteStates();
        this.stopLiveAnalysis();
    }

    muteNonBaseTracks() {
        this.savedMuteStates = {};
        
        for (let i = 0; i < this.tracks.length; i++) {
            const track = this.tracks[i];
            this.savedMuteStates[track.id] = track.muted;
            
            if (i > 0 && !track.muted) {
                track.muted = true;
                if (track.gainNode) {
                    track.gainNode.gain.value = 0;
                }
                this.updateTrackUI(track);
            }
        }
        
        this.updateMuteAllUI();
    }

    restoreMuteStates() {
        if (!this.savedMuteStates) return;
        
        for (const track of this.tracks) {
            const savedState = this.savedMuteStates[track.id];
            if (savedState !== undefined && track.muted !== savedState) {
                track.muted = savedState;
                if (track.gainNode) {
                    track.gainNode.gain.value = savedState ? 0 : track.volume;
                }
                this.updateTrackUI(track);
            }
        }
        
        this.savedMuteStates = null;
        this.updateMuteAllUI();
    }

    async processRecording(stream) {
        stream.getTracks().forEach(track => track.stop());

        const mimeType = this.currentMimeType || this.mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        
        let audioBuffer;
        try {
            const arrayBuffer = await blob.arrayBuffer();
            audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
        } catch (decodeError) {
            console.error('Error decoding audio:', decodeError);
            alert('Could not process the recording. Please try again.');
            return;
        }

        const duration = Date.now() - this.recordingStartTime;
        const trackId = ++this.trackIdCounter;

        const track = {
            id: trackId,
            name: `Track ${trackId}`,
            blob,
            audioBuffer,
            duration,
            volume: 1,
            muted: false,
            offset: 0,
            source: null,
            gainNode: null,
            isPlaying: false,
            playbackStartTime: 0
        };

        this.tracks.push(track);
        this.renderTrack(track);
        this.updateTracksUI();

        await this.saveTrackToStorage(track);
    }

    renderTrack(track) {
        const template = this.trackTemplate.content.cloneNode(true);
        const trackEl = template.querySelector('.track');

        trackEl.dataset.trackId = track.id;
        
        const trackName = trackEl.querySelector('.track-name');
        trackName.textContent = track.name;
        trackName.addEventListener('click', () => this.startRenameTrack(track.id));
        
        trackEl.querySelector('.track-duration').textContent = this.formatTime(track.duration);

        const playBtn = trackEl.querySelector('.play-track-btn');
        const muteBtn = trackEl.querySelector('.mute-track-btn');
        const soloBtn = trackEl.querySelector('.solo-track-btn');
        const volumeSlider = trackEl.querySelector('.volume-slider');
        const deleteBtn = trackEl.querySelector('.delete-track-btn');

        volumeSlider.value = track.volume * 100;

        playBtn.addEventListener('click', () => this.toggleTrackPlayback(track.id));
        muteBtn.addEventListener('click', () => this.toggleTrackMute(track.id));
        soloBtn.addEventListener('click', () => this.toggleSolo(track.id));
        volumeSlider.addEventListener('input', (e) => this.setTrackVolume(track.id, e.target.value / 100));
        deleteBtn.addEventListener('click', () => this.deleteTrack(track.id));

        this.tracksContainer.appendChild(trackEl);

        if (track.muted) {
            trackEl.classList.add('muted');
            muteBtn.classList.add('muted');
            muteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 8.5v2.09l2.5 2.5V12zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
        }

        const canvas = trackEl.querySelector('.waveform-canvas');
        const waveform = trackEl.querySelector('.track-waveform');
        
        waveform.style.opacity = 0.3 + (track.volume * 0.7);
        
        this.setupWaveformDrag(track, waveform, canvas);
        this.setupTrackDrag(trackEl);
        
        requestAnimationFrame(() => {
            this.drawWaveform(canvas, track.audioBuffer, track.offset);
        });
    }

    setupTrackDrag(trackEl) {
        trackEl.addEventListener('dragstart', (e) => {
            trackEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', trackEl.dataset.trackId);
        });

        trackEl.addEventListener('dragend', () => {
            trackEl.classList.remove('dragging');
            document.querySelectorAll('.track.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        trackEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = this.tracksContainer.querySelector('.track.dragging');
            if (dragging && dragging !== trackEl) {
                trackEl.classList.add('drag-over');
            }
        });

        trackEl.addEventListener('dragleave', () => {
            trackEl.classList.remove('drag-over');
        });

        trackEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            trackEl.classList.remove('drag-over');
            
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            const targetId = parseInt(trackEl.dataset.trackId);
            
            if (draggedId === targetId) return;
            
            await this.reorderTracks(draggedId, targetId);
        });
    }

    async reorderTracks(draggedId, targetId) {
        const draggedIndex = this.tracks.findIndex(t => t.id === draggedId);
        const targetIndex = this.tracks.findIndex(t => t.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        const [draggedTrack] = this.tracks.splice(draggedIndex, 1);
        this.tracks.splice(targetIndex, 0, draggedTrack);
        
        this.rerenderAllTracks();
        
        for (const track of this.tracks) {
            await this.saveTrackToStorage(track);
        }
    }

    rerenderAllTracks() {
        const trackEls = this.tracksContainer.querySelectorAll('.track');
        trackEls.forEach(el => el.remove());
        
        for (const track of this.tracks) {
            if (track.audioBuffer) {
                this.renderTrack(track);
            } else {
                this.renderTrackPlaceholder(track);
            }
        }
        
        this.updateTracksUI();
    }

    setupWaveformDrag(track, waveform, canvas) {
        let isDragging = false;
        let startX = 0;
        let startOffset = 0;
        let currentDeltaX = 0;

        const pxToMs = (px) => {
            const rect = waveform.getBoundingClientRect();
            const duration = track.audioBuffer ? track.audioBuffer.duration * 1000 : track.duration;
            return Math.round((px / rect.width) * duration);
        };

        const handleStart = (e) => {
            if (track.isPlaying || !track.audioBuffer) return;
            
            isDragging = true;
            startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            startOffset = track.offset;
            currentDeltaX = 0;
            waveform.classList.add('dragging');
            canvas.style.transition = 'none';
            e.preventDefault();
        };

        const handleMove = (e) => {
            if (!isDragging) return;
            
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            currentDeltaX = clientX - startX;
            const deltaMs = pxToMs(currentDeltaX);
            
            track.offset = startOffset + deltaMs;
            
            canvas.style.transform = `translateX(${currentDeltaX}px)`;
        };

        const handleEnd = async () => {
            if (!isDragging) return;
            
            isDragging = false;
            waveform.classList.remove('dragging');
            
            canvas.style.transition = '';
            canvas.style.transform = '';
            this.drawWaveform(canvas, track.audioBuffer, track.offset);
            
            await this.saveTrackToStorage(track);
        };

        waveform.addEventListener('mousedown', handleStart);
        waveform.addEventListener('touchstart', handleStart, { passive: false });
        
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('touchmove', handleMove, { passive: false });
        
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchend', handleEnd);
    }

    startRenameTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${trackId}"]`);
        if (!trackEl) return;

        const trackName = trackEl.querySelector('.track-name');
        const currentName = track.name;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'track-name-input';
        input.value = currentName;
        input.maxLength = 50;

        const finishRename = async () => {
            const newName = input.value.trim() || currentName;
            track.name = newName;
            
            const span = document.createElement('span');
            span.className = 'track-name';
            span.textContent = newName;
            span.addEventListener('click', () => this.startRenameTrack(trackId));
            
            input.replaceWith(span);
            await this.saveTrackToStorage(track);
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = currentName;
                input.blur();
            }
        });

        trackName.replaceWith(input);
        input.focus();
        input.select();
    }

    drawWaveform(canvas, audioBuffer, offset = 0) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        
        const width = rect.width || canvas.parentElement.offsetWidth;
        const height = rect.height || 60;
        
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(0, 0, width, height);

        if (!audioBuffer) {
            ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
            ctx.fillRect(0, height / 2 - 2, width, 4);
            return;
        }
        
        const data = audioBuffer.getChannelData(0);
        const duration = audioBuffer.duration * 1000;
        const offsetPx = (offset / duration) * width;
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        if (offset !== 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(width / 2, 0);
            ctx.lineTo(width / 2, height);
            ctx.stroke();
        }

        for (let i = 0; i < width; i++) {
            const drawX = i + offsetPx;
            if (drawX < 0 || drawX >= width) continue;
            
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            const y1 = (1 + min) * amp;
            const y2 = (1 + max) * amp;

            ctx.fillStyle = '#6366f1';
            ctx.fillRect(drawX, y1, 1, y2 - y1 || 1);
        }
    }

    toggleTrackPlayback(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (track.isPlaying) {
            this.stopTrack(track);
        } else {
            this.playTrack(track);
        }
    }

    async playTrack(track) {
        await this.initAudioContext();

        if (track.needsDecode) {
            await this.decodeTrackAudio(track);
        }

        if (!track.audioBuffer) {
            console.error('Cannot play track: no audio buffer');
            return;
        }

        if (track.source) {
            track.source.stop();
        }

        track.source = this.audioContext.createBufferSource();
        track.source.buffer = track.audioBuffer;

        track.gainNode = this.audioContext.createGain();
        track.gainNode.gain.value = track.muted ? 0 : track.volume;

        track.source.connect(track.gainNode);
        track.gainNode.connect(this.audioContext.destination);

        track.source.onended = () => {
            track.isPlaying = false;
            this.resetPlayhead(track);
            this.updateTrackUI(track);
            this.checkPlaybackState();
        };

        const offsetSec = (track.offset || 0) / 1000;
        const now = this.audioContext.currentTime;
        
        if (offsetSec >= 0) {
            track.playbackStartTime = now + offsetSec;
            track.source.start(now + offsetSec, 0);
        } else {
            const skipTime = Math.min(-offsetSec, track.audioBuffer.duration - 0.01);
            track.playbackStartTime = now - skipTime;
            track.source.start(now, skipTime);
        }
        
        track.isPlaying = true;
        this.updateTrackUI(track);
        this.initPlayhead(track);
        this.startGlobalAnimation();
    }

    stopTrack(track) {
        if (track.source) {
            try {
                track.source.stop();
            } catch (e) {}
            track.source = null;
        }
        track.isPlaying = false;
        this.resetPlayhead(track);
        this.updateTrackUI(track);
    }

    initPlayhead(track) {
        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackEl) return;

        const playhead = trackEl.querySelector('.playhead');
        const progress = trackEl.querySelector('.waveform-progress');
        
        if (playhead) {
            playhead.style.opacity = '1';
            playhead.style.left = '0%';
        }
        if (progress) {
            progress.style.width = '0%';
        }
    }

    startGlobalAnimation() {
        if (this.globalAnimationFrame) return;
        
        const animate = () => {
            const playingTracks = this.tracks.filter(t => t.isPlaying);
            
            if (playingTracks.length === 0) {
                this.globalAnimationFrame = null;
                return;
            }

            const now = this.audioContext?.currentTime || 0;

            for (const track of playingTracks) {
                const trackEl = this.tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
                if (!trackEl) continue;

                const playhead = trackEl.querySelector('.playhead');
                const progress = trackEl.querySelector('.waveform-progress');
                if (!playhead || !progress) continue;

                const elapsed = now - track.playbackStartTime;
                const duration = track.audioBuffer.duration;
                const percent = Math.min(Math.max((elapsed / duration) * 100, 0), 100);

                playhead.style.left = `${percent}%`;
                progress.style.width = `${percent}%`;

                if (percent >= 100) {
                    playhead.style.opacity = '0';
                }
            }

            this.globalAnimationFrame = requestAnimationFrame(animate);
        };

        this.globalAnimationFrame = requestAnimationFrame(animate);
    }

    resetPlayhead(track) {
        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackEl) return;

        const playhead = trackEl.querySelector('.playhead');
        const progress = trackEl.querySelector('.waveform-progress');

        if (playhead) {
            playhead.style.left = '0%';
            playhead.style.opacity = '0';
        }
        if (progress) {
            progress.style.width = '0%';
        }
    }

    async toggleTrackMute(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.muted = !track.muted;

        if (track.gainNode) {
            track.gainNode.gain.value = track.muted ? 0 : track.volume;
        }

        this.updateTrackUI(track);
        await this.saveTrackToStorage(track);
    }

    toggleSolo(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${trackId}"]`);
        const soloBtn = trackEl?.querySelector('.solo-track-btn');
        const isCurrentlySolo = trackEl?.classList.contains('solo');

        this.tracks.forEach(t => {
            const el = this.tracksContainer.querySelector(`[data-track-id="${t.id}"]`);
            const btn = el?.querySelector('.solo-track-btn');
            el?.classList.remove('solo');
            btn?.classList.remove('active');
        });

        if (!isCurrentlySolo) {
            trackEl?.classList.add('solo');
            soloBtn?.classList.add('active');

            this.tracks.forEach(t => {
                const shouldMute = t.id !== trackId;
                if (t.gainNode) {
                    t.gainNode.gain.value = shouldMute ? 0 : t.volume;
                }
            });
        } else {
            this.tracks.forEach(t => {
                if (t.gainNode) {
                    t.gainNode.gain.value = t.muted ? 0 : t.volume;
                }
            });
        }
    }

    async toggleMuteAll() {
        if (this.tracks.length === 0) return;

        const allMuted = this.tracks.every(t => t.muted);
        const newMuteState = !allMuted;

        for (const track of this.tracks) {
            track.muted = newMuteState;

            if (track.gainNode) {
                track.gainNode.gain.value = newMuteState ? 0 : track.volume;
            }

            this.updateTrackUI(track);
            await this.saveTrackToStorage(track);
        }

        this.updateMuteAllUI();
    }

    updateMuteAllUI() {
        const allMuted = this.tracks.length > 0 && this.tracks.every(t => t.muted);
        
        this.muteAllBtn.classList.toggle('muted', allMuted);
        this.muteAllBtn.innerHTML = allMuted
            ? '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 8.5v2.09l2.5 2.5V12zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg><span>Unmute</span>'
            : '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.49 4.49 0 002.5-3.5z"/></svg><span>Mute All</span>';
    }

    async setTrackVolume(trackId, volume) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.volume = volume;

        if (track.gainNode && !track.muted) {
            track.gainNode.gain.value = volume;
        }

        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${trackId}"]`);
        if (trackEl) {
            const waveform = trackEl.querySelector('.track-waveform');
            if (waveform) {
                waveform.style.opacity = 0.3 + (volume * 0.7);
            }
        }

        await this.saveTrackToStorage(track);
    }

    async deleteTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        this.stopTrack(track);
        this.tracks = this.tracks.filter(t => t.id !== trackId);

        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${trackId}"]`);
        if (trackEl) {
            trackEl.remove();
        }

        this.updateTracksUI();
        await this.deleteTrackFromStorage(trackId);
    }

    async playBaseTrack() {
        if (this.tracks.length === 0) return;

        await this.initAudioContext();
        
        const baseTrack = this.tracks[0];
        this.playTrack(baseTrack);
        this.updateMasterControlsUI();
    }

    togglePlayAll() {
        if (this.isPlayingAll) {
            this.stopAllTracks();
        } else {
            this.playAllTracks();
        }
    }

    async playAllTracks() {
        if (this.tracks.length === 0) return;

        await this.initAudioContext();
        this.isPlayingAll = true;

        for (const track of this.tracks) {
            this.playTrack(track);
        }

        this.updatePlayAllButtonUI();
        this.updateMasterControlsUI();
    }

    stopAllTracks() {
        this.isPlayingAll = false;

        for (const track of this.tracks) {
            this.stopTrack(track);
        }

        this.updatePlayAllButtonUI();
        this.updateMasterControlsUI();
    }

    updatePlayAllButtonUI() {
        const playIcon = this.playAllBtn.querySelector('.play-icon');
        const stopIcon = this.playAllBtn.querySelector('.stop-icon');
        const label = this.playAllBtn.querySelector('.btn-label');

        if (this.isPlayingAll) {
            playIcon.style.display = 'none';
            stopIcon.style.display = 'block';
            label.textContent = 'Stop';
            this.playAllBtn.classList.remove('play-btn');
            this.playAllBtn.classList.add('stop-btn');
        } else {
            playIcon.style.display = 'block';
            stopIcon.style.display = 'none';
            label.textContent = 'Play All';
            this.playAllBtn.classList.remove('stop-btn');
            this.playAllBtn.classList.add('play-btn');
        }
    }

    checkPlaybackState() {
        const anyPlaying = this.tracks.some(t => t.isPlaying);
        if (!anyPlaying) {
            this.isPlayingAll = false;
            this.updatePlayAllButtonUI();
            this.updateMasterControlsUI();
        }
    }

    updateTrackUI(track) {
        const trackEl = this.tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackEl) return;

        const playBtn = trackEl.querySelector('.play-track-btn');
        const muteBtn = trackEl.querySelector('.mute-track-btn');

        trackEl.classList.toggle('playing', track.isPlaying);
        trackEl.classList.toggle('muted', track.muted);
        playBtn.classList.toggle('playing', track.isPlaying);
        muteBtn.classList.toggle('muted', track.muted);

        playBtn.innerHTML = track.isPlaying 
            ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

        muteBtn.innerHTML = track.muted
            ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 8.5v2.09l2.5 2.5V12zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.49 4.49 0 002.5-3.5z"/></svg>';
    }

    updateTracksUI() {
        const hasTrack = this.tracks.length > 0;
        this.emptyState.style.display = hasTrack ? 'none' : 'flex';
        this.trackCount.textContent = `${this.tracks.length} track${this.tracks.length !== 1 ? 's' : ''}`;
        this.playAllBtn.disabled = !hasTrack;
        this.muteAllBtn.disabled = !hasTrack;
        this.updateMuteAllUI();
    }

    updateRecordingUI(isRecording) {
        this.recordBtn.classList.toggle('recording', isRecording);
        this.recordingIndicator.classList.toggle('active', isRecording);

        this.recordBtn.querySelector('span').textContent = isRecording ? 'Stop' : 'Record';
        this.recordBtn.innerHTML = isRecording
            ? '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg><span>Stop</span>'
            : '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg><span>Record</span>';
    }

    updateMasterControlsUI() {
        const anyPlaying = this.tracks.some(t => t.isPlaying);

        this.playAllBtn.innerHTML = anyPlaying
            ? '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause All</span>'
            : '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Play All</span>';
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            this.recordTimer.textContent = this.formatTime(elapsed);
        }, 100);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.recordTimer.textContent = '0:00';
    }

    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HarmonyRecorder();
});
