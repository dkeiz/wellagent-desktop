(function installMainPanelVoice(global) {
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const raw = String(reader.result || '');
                resolve(raw.includes(',') ? raw.split(',').pop() : raw);
            };
            reader.onerror = () => reject(reader.error || new Error('Failed to read recorded audio'));
            reader.readAsDataURL(blob);
        });
    }

    function mergeFloat32Chunks(chunks) {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }
        return merged;
    }

    function resampleFloat32(input, inputRate, outputRate) {
        if (!input.length || inputRate === outputRate) return input;
        const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
        const output = new Float32Array(outputLength);
        const ratio = (input.length - 1) / Math.max(1, outputLength - 1);
        for (let i = 0; i < outputLength; i += 1) {
            const position = i * ratio;
            const left = Math.floor(position);
            const right = Math.min(input.length - 1, left + 1);
            const weight = position - left;
            output[i] = input[left] * (1 - weight) + input[right] * weight;
        }
        return output;
    }

    function writeAscii(view, offset, value) {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    }

    function encodePcmWav(samples, sampleRate) {
        const dataBytes = samples.length * 2;
        const buffer = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(buffer);
        writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataBytes, true);
        writeAscii(view, 8, 'WAVE');
        writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, 'data');
        view.setUint32(40, dataBytes, true);
        for (let i = 0; i < samples.length; i += 1) {
            const sample = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return buffer;
    }

    function initializeVoice(panel) {
        panel.voiceRecorder = null;
        panel.voiceChunks = [];
        panel.voiceStream = null;
        panel.voiceMimeType = '';
        panel.voiceAudioContext = null;
        panel.voiceProcessor = null;
        panel.voiceSource = null;
        panel.voiceSampleRate = 16000;
    }

    function initializeTtsController(panel) {
        if (window.LocalAgentTtsController) {
            panel.ttsController = new window.LocalAgentTtsController({
                panel,
                button: document.getElementById('speak-btn')
            });
        }
    }

    function toggleVoiceInput(panel) {
        if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
            panel.showNotification('Voice input not supported in this browser.', 'error');
            return;
        }
        const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextCtor) {
            panel.showNotification('Audio recording is not supported in this browser.', 'error');
            return;
        }
        const voiceBtn = document.getElementById('voice-btn');
        if (panel.voiceRecorder && panel.voiceRecorder.state === 'recording' && panel.voiceRecorder.stop) {
            panel.voiceRecorder.stop();
            return;
        }
        startDesktopSttRecording(panel, voiceBtn).catch((error) => {
            console.error('Failed to start voice input:', error);
            voiceBtn.classList.remove('recording');
            panel.showNotification(`Voice error: ${error.message || 'failed to start'}`, 'error');
        });
    }

    async function startDesktopSttRecording(panel, voiceBtn) {
        const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
        panel.voiceChunks = [];
        panel.voiceMimeType = 'audio/wav';
        panel.voiceStream = await global.navigator.mediaDevices.getUserMedia({ audio: true });
        panel.voiceAudioContext = new AudioContextCtor();
        panel.voiceSource = panel.voiceAudioContext.createMediaStreamSource(panel.voiceStream);
        panel.voiceProcessor = panel.voiceAudioContext.createScriptProcessor(4096, 1, 1);
        panel.voiceProcessor.onaudioprocess = (event) => {
            if (!panel.voiceRecorder || panel.voiceRecorder.state !== 'recording') return;
            panel.voiceChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        panel.voiceSource.connect(panel.voiceProcessor);
        panel.voiceProcessor.connect(panel.voiceAudioContext.destination);
        panel.voiceRecorder = {
            state: 'recording',
            stop() {
                if (this.state !== 'recording') return;
                this.state = 'stopped';
                transcribeDesktopRecording(panel).catch((error) => {
                    cleanupDesktopRecording(panel);
                    console.error('Voice transcription failed:', error);
                    panel.showNotification(`Voice error: ${error.message || 'transcription failed'}`, 'error');
                });
            }
        };
        panel.voiceAudioContext.resume().catch((error) => {
            console.error('Voice recorder error:', error);
            panel.voiceRecorder = null;
            cleanupDesktopRecording(panel);
            panel.showNotification(`Voice error: ${error.message || 'recording failed'}`, 'error');
        });

        voiceBtn.classList.add('recording');
    }

    function cleanupDesktopRecording(panel) {
        if (panel.voiceProcessor) {
            try { panel.voiceProcessor.disconnect(); } catch (_) {}
            panel.voiceProcessor.onaudioprocess = null;
            panel.voiceProcessor = null;
        }
        if (panel.voiceSource) {
            try { panel.voiceSource.disconnect(); } catch (_) {}
            panel.voiceSource = null;
        }
        if (panel.voiceAudioContext) {
            panel.voiceAudioContext.close().catch(() => {});
            panel.voiceAudioContext = null;
        }
        if (panel.voiceStream) {
            panel.voiceStream.getTracks().forEach((track) => track.stop());
            panel.voiceStream = null;
        }
        panel.voiceRecorder = null;
    }

    async function transcribeDesktopRecording(panel) {
        const voiceBtn = document.getElementById('voice-btn');
        voiceBtn.classList.remove('recording');
        const chunks = panel.voiceChunks || [];
        const sourceRate = panel.voiceAudioContext ? panel.voiceAudioContext.sampleRate : 48000;
        panel.voiceChunks = [];
        try {
            if (!chunks.length) throw new Error('No audio was recorded');
            const merged = mergeFloat32Chunks(chunks);
            const resampled = resampleFloat32(merged, sourceRate, panel.voiceSampleRate || 16000);
            const wav = encodePcmWav(resampled, panel.voiceSampleRate || 16000);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const audioBase64 = await blobToBase64(blob);
            const result = await global.electronBridge.stt.transcribeAudio({
                audioBase64,
                mimeType: 'audio/wav',
                language: 'english'
            });
            if (!result || result.success === false) {
                throw new Error(result?.error || 'transcription failed');
            }
            const transcript = String(result.transcript || result.text || result.result?.text || '').trim();
            if (!transcript) throw new Error('No transcript returned');
            document.getElementById('message-input').value = transcript;
        } finally {
            cleanupDesktopRecording(panel);
        }
    }

    async function toggleAutoSpeak(panel) {
        if (panel.ttsController) {
            await panel.ttsController.toggleAutoSpeak();
            panel.autoSpeak = Boolean(panel.ttsController.settings.autoSpeak);
            return;
        }
        panel.autoSpeak = !panel.autoSpeak;
    }

    async function speakText(panel, text) {
        if (panel.ttsController) {
            return panel.ttsController.speakText(text);
        }
        const cleanText = String(text || '')
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/<!--\s*(?:emotion|mood)\s*(?::|=)\s*["']?[a-z][a-z0-9_-]*["']?\s*-->/gi, '')
            .trim();
        panel.synthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        panel.synthesis.speak(utterance);
        return { ok: true, provider: 'browser' };
    }

    global.LocalAgentMainPanelVoice = {
        initializeTtsController,
        initializeVoice,
        speakText,
        toggleAutoSpeak,
        toggleVoiceInput
    };
})(window);
