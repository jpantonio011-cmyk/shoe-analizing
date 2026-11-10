(function() {
  'use strict';

  // ---------- DOM refs ----------
  const cameraVideo = document.getElementById('cameraVideo');
  const previewImage = document.getElementById('previewImage');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const cameraControls = document.getElementById('cameraControls');
  const retakeControls = document.getElementById('retakeControls');
  const cancelCameraBtn = document.getElementById('cancelCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const retakeBtn = document.getElementById('retakeBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const placeholderMessage = document.getElementById('placeholderMessage');
  const resultContent = document.getElementById('resultContent');
  const descOutput = document.getElementById('descOutput');
  const brandOutput = document.getElementById('brandOutput');
  const priceOutput = document.getElementById('priceOutput');
  const statusMessage = document.getElementById('statusMessage');
  const themeToggle = document.getElementById('themeToggle');

  // ---------- State ----------
  const ENDPOINT = 'https://oxford.uk.eu.org/ai/oxford';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MAX_SIDE_RESIZE = 1280;
  const TIMEOUT_MS = 75000;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  let currentFile = null;
  let previewUrl = null;
  let stream = null;
  let abortController = null;
  let isAnalyzing = false;
  let cameraActive = false;

  // ---------- Theme ----------
  const savedTheme = localStorage.getItem('shoe-analyzer-theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    themeToggle.textContent = '☀️';
  }

  themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light');
    themeToggle.textContent = isLight ? '☀️' : '🌙';
    localStorage.setItem('shoe-analyzer-theme', isLight ? 'light' : 'dark');
  });

  // ---------- Helpers ----------
  function showStatus(msg, isError = false) {
    statusMessage.textContent = msg;
    statusMessage.classList.remove('hidden');
    statusMessage.classList.toggle('error', isError);
  }

  function hideStatus() {
    statusMessage.classList.add('hidden');
    statusMessage.textContent = '';
    statusMessage.classList.remove('error');
  }

  function setLoading(loading) {
    isAnalyzing = loading;
    captureBtn.disabled = loading;
    retakeBtn.disabled = loading;
    cancelCameraBtn.disabled = loading;
    leaveBtn.disabled = loading;
    if (loading) {
      captureBtn.innerHTML = '<span class="spinner"></span> Analyzing…';
    } else {
      captureBtn.innerHTML = '📸 Capture';
    }
  }

  function resetResults() {
    placeholderMessage.classList.remove('hidden');
    resultContent.classList.add('hidden');
    descOutput.textContent = '—';
    brandOutput.textContent = '—';
    brandOutput.classList.remove('brand-tag');
    priceOutput.textContent = '—';
    priceOutput.classList.remove('price-tag');
    hideStatus();
  }

  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewImage.src = '#';
    previewImage.classList.add('hidden');
    currentFile = null;
  }

  // ---------- Camera ----------
  async function startCamera() {
    stopCamera();
    hideStatus();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStatus('Camera not supported. Please use a modern browser.', true);
      showPlaceholder();
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false
      });

      cameraVideo.srcObject = stream;
      cameraVideo.classList.remove('hidden');
      previewImage.classList.add('hidden');
      cameraPlaceholder.classList.add('hidden');
      cameraControls.classList.remove('hidden');
      retakeControls.classList.add('hidden');
      cameraActive = true;
      resetResults();
    } catch (err) {
      console.warn('Camera error:', err);
      cameraActive = false;
      showPlaceholder();
      if (err.name === 'NotAllowedError') {
        showStatus('⚠️ ❌ Camera access denied or unavailable. Please refresh and allow camera access.', true);
      } else if (err.name === 'NotFoundError') {
        showStatus('No camera found on this device.', true);
      } else {
        showStatus('Could not open camera. Please try again.', true);
      }
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    cameraVideo.srcObject = null;
    cameraVideo.classList.add('hidden');
    cameraActive = false;
  }

  function showPlaceholder() {
    cameraPlaceholder.classList.remove('hidden');
    cameraControls.classList.add('hidden');
    retakeControls.classList.add('hidden');
  }

  function capturePhoto() {
    if (!cameraActive || !stream) {
      showStatus('Camera is not active. Please wait or reload.', true);
      return;
    }

    const video = cameraVideo;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    if (width === 0 || height === 0) {
      showStatus('Camera not ready. Please try again in a moment.', true);
      return;
    }

    const canvas = document.createElement('canvas');
    const longest = Math.max(width, height);
    const scale = longest > MAX_SIDE_RESIZE ? MAX_SIDE_RESIZE / longest : 1;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          showStatus('Could not capture photo. Please try again.', true);
          return;
        }

        stopCamera();
        clearPreview();

        currentFile = new File([blob], 'shoe.jpg', { type: 'image/jpeg' });

        previewUrl = URL.createObjectURL(blob);
        previewImage.src = previewUrl;
        previewImage.classList.remove('hidden');
        cameraPlaceholder.classList.add('hidden');
        cameraControls.classList.add('hidden');
        retakeControls.classList.remove('hidden');

        resetResults();
        hideStatus();

        // Auto-analyze after capture
        analyzeShoe();
      },
      'image/jpeg',
      0.9
    );
  }

  async function retake() {
    if (isAnalyzing) return;
    clearPreview();
    resetResults();
    await startCamera();
  }

  function leave() {
    stopCamera();
    clearPreview();
    resetResults();
    showPlaceholder();
    // Optionally, show a goodbye message
    showStatus('Session ended. Refresh to start again.', false);
  }

  // ---------- Image resize ----------
  function resizeImage(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        const longest = Math.max(width, height);
        const scale = longest > MAX_SIDE_RESIZE ? MAX_SIDE_RESIZE / longest : 1;
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        canvas.toBlob(
          (outBlob) => {
            if (!outBlob) reject(new Error('Could not process the image.'));
            else resolve(outBlob);
          },
          'image/jpeg',
          0.85
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read the captured image.'));
      };

      img.src = objectUrl;
    });
  }

  // ---------- JSON extraction ----------
  function extractJson(text) {
    const t = String(text).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      return null;
    }
  }

  // ---------- Analyze ----------
  async function analyzeShoe() {
    if (isAnalyzing) return;
    hideStatus();

    if (!currentFile) {
      showStatus('Take a photo first.', true);
      return;
    }

    setLoading(true);
    abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      if (abortController) abortController.abort();
    }, TIMEOUT_MS);

    try {
      let uploadBlob;
      try {
        uploadBlob = await resizeImage(currentFile);
      } catch (resizeErr) {
        throw new Error('Image processing failed: ' + resizeErr.message);
      }

      const prompt = [
        'You are a professional shoe analyst. Analyze the shoe in the image.',
        '',
        'Respond with ONLY a valid JSON object (no markdown, no code fences, no extra text) using exactly this shape:',
        '{',
        '  "description": "A detailed description of the shoe, minimum 10 words (type, color, style, material, details).",',
        '  "brand": "The brand name if clearly identifiable. If the brand is not clearly known or visible, use exactly \\"Unknown / Generic\\".",',
        '  "price_range": "A realistic price range in Philippine pesos (₱), for example \\"₱1500 – ₱4500\\"."',
        '}',
        '',
        'Rules:',
        '- The description must be at least 10 words long.',
        '- For brand, only state a real brand if you are confident; otherwise use "Unknown / Generic".',
        '- The price range must use the Philippine peso symbol (₱) and reflect typical Philippine retail prices.',
        '- Do not include any explanation or text outside the JSON object.'
      ].join('\n');

      const form = new FormData();
      form.append('message', prompt);
      form.append('image', uploadBlob, 'shoe.jpg');

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body: form,
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        let errMsg = (data && data.error) ? data.error : `Request failed (HTTP ${res.status}).`;
        if (res.status === 403) {
          errMsg = 'Available only in the Philippines.';
        } else if (res.status === 413) {
          errMsg = 'Image or request is too large. Try a smaller image.';
        } else if (res.status === 429) {
          const retry = res.headers.get('Retry-After');
          errMsg = 'Too many requests. ' + (retry ? `Wait ${retry} seconds.` : 'Wait a minute.');
        } else if (res.status === 502 || res.status === 503) {
          errMsg = 'AI temporarily unavailable. Please try again shortly.';
        }
        throw new Error(errMsg);
      }

      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('The AI returned an empty response. Please try again.');
      }

      const parsed = extractJson(data.reply);

      if (parsed && typeof parsed === 'object') {
        const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
        const brand = typeof parsed.brand === 'string' ? parsed.brand.trim() : '';
        const priceRange = typeof parsed.price_range === 'string' ? parsed.price_range.trim() : '';

        const wordCount = description.split(/\s+/).filter(Boolean).length;
        if (!description || wordCount < 10) {
          throw new Error('AI response did not meet the minimum description length. Please try again.');
        }
        if (!brand) throw new Error('AI response missing brand information.');
        if (!priceRange) throw new Error('AI response missing price range.');

        descOutput.textContent = description;

        if (brand.toLowerCase() === 'unknown / generic' || brand.toLowerCase() === 'unknown' || brand.toLowerCase() === 'generic') {
          brandOutput.textContent = 'Unknown / Generic';
          brandOutput.classList.remove('brand-tag');
        } else {
          brandOutput.textContent = brand;
          brandOutput.classList.add('brand-tag');
        }

        priceOutput.textContent = priceRange;
        priceOutput.classList.add('price-tag');

        placeholderMessage.classList.add('hidden');
        resultContent.classList.remove('hidden');
      } else {
        const raw = data.reply.trim();
        descOutput.textContent = raw;
        brandOutput.textContent = 'Unknown / Generic';
        brandOutput.classList.remove('brand-tag');
        priceOutput.textContent = '₱500 – ₱2,000 (estimate)';
        priceOutput.classList.add('price-tag');

        placeholderMessage.classList.add('hidden');
        resultContent.classList.remove('hidden');
        showStatus('AI response could not be fully parsed. Showing raw reply.', false);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showStatus('Request timed out or cancelled. Please try again.', true);
      } else {
        showStatus(err.message || 'Something went wrong. Please try again.', true);
      }
    } finally {
      clearTimeout(timeoutId);
      abortController = null;
      setLoading(false);
    }
  }

  // ---------- Event listeners ----------
  captureBtn.addEventListener('click', capturePhoto);
  retakeBtn.addEventListener('click', retake);
  leaveBtn.addEventListener('click', leave);
  cancelCameraBtn.addEventListener('click', () => {
    stopCamera();
    showPlaceholder();
    resetResults();
    showStatus('Camera cancelled.', false);
  });

  // Analyze button (hidden by default but we auto-analyze after capture)
  // We don't have a separate analyze button in this design; auto-analyze after capture.

  // Handle page visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (stream && cameraActive) {
        stopCamera();
        if (!currentFile) {
          showPlaceholder();
        }
      }
    }
  });

  // ---------- Init ----------
  window.addEventListener('load', () => {
    setTimeout(() => {
      startCamera();
    }, 150);
  });

  window.addEventListener('beforeunload', () => {
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  window.addEventListener('pagehide', () => {
    stopCamera();
  });
})();