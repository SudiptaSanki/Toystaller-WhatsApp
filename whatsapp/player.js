// player.js
// Anti-Redirect In-Browser HTML5 Player for Toystaller: WhatsApp Edition
// Bypasses CDN 302 redirects by loading media natively inside an HTML5 <video> element with Referer/Origin rules.
// Supports direct CDN URLs (?url=...) and client-decrypted blob buffers (?id=...).

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('url');
    const mediaId = params.get('id');

    const player = document.getElementById('videoPlayer');
    const dlBtn = document.getElementById('dlBtn');
    const copyBtn = document.getElementById('copyBtn');
    const resText = document.getElementById('resolutionText');

    let activeDownloadUrl = videoUrl;
    let activeFilename = `WhatsApp_Video_${Date.now()}.mp4`;

    function showError(msg) {
        document.body.innerHTML = `
            <div style="color:#e9edef;font-family:sans-serif;text-align:center;margin-top:25vh;">
                <h2>Unable to Load Video</h2>
                <p style="margin-top:10px;color:#8696a0;">${msg || 'Please close this tab and try clicking the download button again on WhatsApp.'}</p>
            </div>
        `;
    }

    if (!videoUrl && !mediaId) {
        showError('No video link or session specified.');
        return;
    }

    if (videoUrl) {
        player.src = videoUrl;
        const idMatch = videoUrl.match(/\/(\d+_[^/?]+)/);
        if (idMatch) {
            activeFilename = `WhatsApp_${idMatch[1]}.mp4`;
        }
    } else if (mediaId) {
        // Retrieve client-decrypted buffer from background service worker
        chrome.runtime.sendMessage({ action: 'getPlayerMedia', id: mediaId }, (response) => {
            if (chrome.runtime.lastError || !response || !response.buffer) {
                // Also check getViewerMedia for backwards compatibility
                chrome.runtime.sendMessage({ action: 'getViewerMedia', id: mediaId }, (res2) => {
                    if (chrome.runtime.lastError || !res2 || !res2.buffer) {
                        showError('Could not retrieve decrypted media buffer from WhatsApp session.');
                        return;
                    }
                    loadBuffer(res2);
                });
                return;
            }
            loadBuffer(response);
        });
    }

    function loadBuffer(data) {
        try {
            const buffer = data.buffer instanceof ArrayBuffer 
                ? data.buffer 
                : (data.buffer.buffer || new Uint8Array(data.buffer).buffer);
            const blob = new Blob([buffer], { type: data.mimeType || 'video/mp4' });
            activeDownloadUrl = URL.createObjectURL(blob);
            if (data.filename) {
                activeFilename = data.filename;
            }
            player.src = activeDownloadUrl;
            player.play().catch(() => {});
        } catch (err) {
            console.error('Toystaller player error:', err);
            showError('Error decoding media buffer: ' + err.message);
        }
    }

    player.addEventListener('loadedmetadata', () => {
        if (player.videoWidth && player.videoHeight) {
            resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
        }
    });

    player.addEventListener('error', () => {
        resText.textContent = 'Unable to stream directly. Please click "Download Video" above to save the file.';
        resText.style.color = '#ef4444';
    });

    dlBtn.addEventListener('click', () => {
        if (!activeDownloadUrl) return;

        if (activeDownloadUrl.startsWith('blob:') || activeDownloadUrl.startsWith('data:')) {
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = activeDownloadUrl;
            a.download = activeFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 2000);
            animateDownloadBtn();
            return;
        }

        chrome.runtime.sendMessage({
            action: 'downloadMedia',
            url: activeDownloadUrl,
            filename: activeFilename
        }, (response) => {
            if (response && response.success) {
                animateDownloadBtn();
            } else {
                // Direct fallback
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = activeDownloadUrl;
                a.download = activeFilename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 2000);
                animateDownloadBtn();
            }
        });
    });

    function animateDownloadBtn() {
        dlBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Download Started
        `;
        dlBtn.style.background = '#128C7E';
        setTimeout(() => {
            dlBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download Video
            `;
            dlBtn.style.background = '#25D366';
        }, 2500);
    }

    copyBtn.addEventListener('click', () => {
        const textToCopy = videoUrl || activeDownloadUrl || window.location.href;
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy Link
                `;
            }, 1800);
        });
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case ' ':
                e.preventDefault();
                if (player.src) {
                    if (player.paused) player.play();
                    else player.pause();
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
                player.muted = !player.muted;
                break;
            case 'd':
            case 'D':
                e.preventDefault();
                dlBtn.click();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                player.currentTime = Math.max(0, player.currentTime - 5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                player.currentTime = Math.min(player.duration, player.currentTime + 5);
                break;
        }
    });

    window.addEventListener('beforeunload', () => {
        if (activeDownloadUrl && activeDownloadUrl.startsWith('blob:')) {
            URL.revokeObjectURL(activeDownloadUrl);
        }
    });
})();
