// viewer.js
// Dedicated Media Viewer Player for Toystaller: WhatsApp Edition
// Bypasses Chromium blob navigation restrictions by reconstructing in-origin media blob with zero CORS/COOP issues.

(function() {
    const params = new URLSearchParams(window.location.search);
    const mediaId = params.get('id');
    const directUrl = params.get('url');
    const isVideoHint = params.get('isVideo') === 'true';

    const mediaTitle = document.getElementById('mediaTitle');
    const mediaSubtitle = document.getElementById('mediaSubtitle');
    const downloadBtn = document.getElementById('downloadBtn');
    const spinnerBox = document.getElementById('spinnerBox');
    const errorBox = document.getElementById('errorBox');
    const errorMessage = document.getElementById('errorMessage');
    const mediaVideo = document.getElementById('mediaVideo');
    const mediaImg = document.getElementById('mediaImg');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const pipBtn = document.getElementById('pipBtn');

    let activeObjectUrl = null;
    let currentIsVideo = false;

    function showError(msg) {
        if (spinnerBox) spinnerBox.style.display = 'none';
        if (errorBox) errorBox.style.display = 'flex';
        if (errorMessage) errorMessage.textContent = msg || 'Failed to load media.';
    }

    function renderMedia(blob, filename, isVideo) {
        if (spinnerBox) spinnerBox.style.display = 'none';
        currentIsVideo = isVideo;

        activeObjectUrl = URL.createObjectURL(blob);

        const typeLabel = isVideo ? 'WhatsApp Video' : 'WhatsApp Image';
        document.title = `${typeLabel} — Toystaller`;
        if (mediaTitle) mediaTitle.textContent = typeLabel;
        if (mediaSubtitle) mediaSubtitle.textContent = filename || `${typeLabel.toLowerCase()}_${Date.now()}`;

        if (downloadBtn) {
            downloadBtn.href = activeObjectUrl;
            downloadBtn.download = filename || (isVideo ? 'whatsapp_video.mp4' : 'whatsapp_image.jpg');
        }

        if (isVideo) {
            mediaVideo.src = activeObjectUrl;
            mediaVideo.style.display = 'block';
            mediaVideo.focus();
            mediaVideo.play().catch(() => {});

            if (document.pictureInPictureEnabled && pipBtn) {
                pipBtn.style.display = 'inline-flex';
                pipBtn.addEventListener('click', () => {
                    if (document.pictureInPictureElement) {
                        document.exitPictureInPicture().catch(() => {});
                    } else {
                        mediaVideo.requestPictureInPicture().catch(() => {});
                    }
                });
            }
        } else {
            mediaImg.src = activeObjectUrl;
            mediaImg.style.display = 'block';
        }
    }

    // Load via transferred media buffer from background service worker
    if (mediaId) {
        chrome.runtime.sendMessage({ action: 'getViewerMedia', id: mediaId }, (response) => {
            if (chrome.runtime.lastError || !response || !response.buffer) {
                showError('Could not retrieve media from WhatsApp session. Please try again.');
                return;
            }

            try {
                // Structured clone gives ArrayBuffer directly, or fallback if Uint8Array
                const buffer = response.buffer instanceof ArrayBuffer 
                    ? response.buffer 
                    : (response.buffer.buffer || new Uint8Array(response.buffer).buffer);

                const blob = new Blob([buffer], { type: response.mimeType || (response.isVideo ? 'video/mp4' : 'image/jpeg') });
                renderMedia(blob, response.filename, response.isVideo);
            } catch (err) {
                console.error('Toystaller viewer error:', err);
                showError('Error decoding media data: ' + err.message);
            }
        });
    } else if (directUrl) {
        // Direct URL fallback
        fetch(directUrl)
            .then(res => res.blob())
            .then(blob => {
                renderMedia(blob, 'whatsapp_media', isVideoHint);
            })
            .catch(err => {
                showError('Could not load direct URL: ' + err.message);
            });
    } else {
        showError('No media identifier specified.');
    }

    // Fullscreen toggle
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });
    }

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case ' ':
                e.preventDefault();
                if (currentIsVideo && mediaVideo.src) {
                    if (mediaVideo.paused) mediaVideo.play();
                    else mediaVideo.pause();
                }
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                } else {
                    document.exitFullscreen().catch(() => {});
                }
                break;
            case 'm':
            case 'M':
                e.preventDefault();
                if (currentIsVideo && mediaVideo.src) {
                    mediaVideo.muted = !mediaVideo.muted;
                }
                break;
            case 'd':
            case 'D':
                e.preventDefault();
                if (downloadBtn && downloadBtn.href) {
                    downloadBtn.click();
                }
                break;
            case 'ArrowLeft':
                if (currentIsVideo && mediaVideo.src) {
                    e.preventDefault();
                    mediaVideo.currentTime = Math.max(0, mediaVideo.currentTime - 5);
                }
                break;
            case 'ArrowRight':
                if (currentIsVideo && mediaVideo.src) {
                    e.preventDefault();
                    mediaVideo.currentTime = Math.min(mediaVideo.duration, mediaVideo.currentTime + 5);
                }
                break;
        }
    });

    window.addEventListener('beforeunload', () => {
        if (activeObjectUrl) {
            URL.revokeObjectURL(activeObjectUrl);
        }
    });
})();
