// core/content_core.js
// Toystaller: WhatsApp Edition — Specialized Media Extractor & Downloader.
// Supports: Chat Conversation Images & Videos, Status/Stories Viewer, Fullscreen Media Lightbox, and Contact Info Drawer.

const pageInterceptedVideoUrls = new Set();
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'toystaller_video_urls' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(url => pageInterceptedVideoUrls.add(url));
    }
});

function safeSendMessage(msg, callback) {
    try {
        if (!chrome.runtime || !chrome.runtime.id) return;
        chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Toystaller: extension context invalidated, please reload page.');
                return;
            }
            if (callback) callback(response);
        });
    } catch (e) {
        console.warn('Toystaller: extension context invalidated, please reload page.');
    }
}

// Native in-page Blob and media downloader for WhatsApp Web client-decrypted media
async function downloadMediaBlob(url, isVideo = false) {
    if (!url) {
        console.warn('Toystaller: No media URL found to download.');
        return false;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = isVideo ? 'mp4' : 'jpg';
    const filename = `whatsapp_${isVideo ? 'video' : 'image'}_${timestamp}.${ext}`;

    try {
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            const response = await fetch(url);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(objectUrl);
            }, 4000);
            return true;
        } else {
            // Attempt clean fetch first to enforce custom filename
            try {
                const res = await fetch(url);
                const blob = await res.blob();
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = objectUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    a.remove();
                    URL.revokeObjectURL(objectUrl);
                }, 4000);
                return true;
            } catch (err) {
                safeSendMessage({ action: 'downloadMedia', url: url, filename: filename });
                return true;
            }
        }
    } catch (e) {
        console.warn('Toystaller: Direct fetch failed, attempting anchor click fallback:', e);
        try {
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 2000);
            return true;
        } catch (e2) {
            console.error('Toystaller: Download failed:', e2);
            return false;
        }
    }
}

// Safely opens the image or video in a new dedicated viewer tab
async function openMediaTab(url, isVideo = false) {
    if (!url) {
        console.warn('Toystaller: No media URL found to open.');
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `whatsapp_${isVideo ? 'video' : 'image'}_${timestamp}.${isVideo ? 'mp4' : 'jpg'}`;

    if (url.startsWith('blob:') || url.startsWith('data:')) {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();

            safeSendMessage({
                action: 'createViewerTab',
                buffer: buffer,
                mimeType: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
                isVideo: isVideo,
                filename: filename
            }, (response) => {
                if (!response || !response.success) {
                    console.warn('Toystaller: Viewer tab creation returned unsuccessful, downloading directly:', response);
                    downloadMediaBlob(url, isVideo);
                }
            });
            return;
        } catch (err) {
            console.error('Toystaller: Failed to fetch media buffer for viewer tab:', err);
            downloadMediaBlob(url, isVideo);
        }
    } else {
        safeSendMessage({ action: 'createViewerTab', url: url, isVideo: isVideo, filename: filename }, (response) => {
            if (!response || !response.success) {
                safeSendMessage({ action: 'openInNewTab', url: url });
            }
        });
    }
}

function isRawMediaTab() {
    if (document.contentType && (document.contentType.startsWith('video/') || document.contentType.startsWith('image/'))) {
        return true;
    }
    if (document.body && document.body.children.length === 1) {
        const child = document.body.firstElementChild;
        if (child && (child.tagName === 'VIDEO' || child.tagName === 'IMG')) {
            return true;
        }
    }
    return false;
}

function getActivePlatform() {
    return window.ToystallerActivePlatform || window.ToystallerPlatforms['whatsapp'] || {
        name: 'whatsapp',
        hasActiveModal() { return false; },
        isInsideModal() { return false; },
        isThumbnail() { return false; },
        getButtonScale() { return 1; },
        filterBackgroundUrls(candidates) { return candidates; },
        useDirectDownload: true,
        isInternalUrl() { return true; }
    };
}

function getHighResImageUrl(media) {
    let finalUrl = media.currentSrc || media.src;

    if (media.srcset) {
        const srcsetItems = media.srcset.split(',').map(s => s.trim().split(' '));
        if (srcsetItems.length > 0) {
            const largest = srcsetItems.sort((a, b) => {
                const wA = parseInt(a[1] || '0', 10);
                const wB = parseInt(b[1] || '0', 10);
                return wB - wA;
            })[0];
            if (largest && largest[0]) {
                finalUrl = largest[0];
            }
        }
    }

    return finalUrl;
}

function getVideoUrl(media) {
    if (!media) return '';
    let url = media.currentSrc || media.src || '';
    if (!url && media.querySelector) {
        const source = media.querySelector('source');
        if (source && source.src) url = source.src;
    }
    if (!url) {
        url = media.getAttribute('src') || '';
    }
    return url;
}

function getResolvedMediaUrl(media, isVideo) {
    if (isVideo) {
        return getVideoUrl(media);
    }
    return getHighResImageUrl(media);
}

function getVideoPosterUrl(media) {
    let poster = media.getAttribute('poster');
    if (!poster) {
        let current = media;
        for (let i = 0; i < 4 && current && !poster; i++) {
            const img = current.querySelector ? current.querySelector('img') : null;
            if (img && img.src && !img.src.startsWith('data:')) {
                poster = img.currentSrc || img.src;
            }
            current = current.parentElement;
        }
    }
    return poster;
}

function injectDownloadButtons() {
    if (isRawMediaTab()) return;

    const platform = getActivePlatform();
    const hasModal = platform.hasActiveModal();

    if (window.magicOverlayManager) {
        window.magicOverlayManager.updateAllPositions();
    }

    const mediaElements = document.querySelectorAll('video, img');

    mediaElements.forEach(media => {
        if (platform.isThumbnail(media)) return;

        if (hasModal && !platform.isInsideModal(media)) return;

        if (window.magicOverlayManager && !window.magicOverlayManager.overlays.has(media)) {
            const isVideo = media.tagName.toLowerCase() === 'video';
            const scale = platform.getButtonScale(media);

            const createButtonsFn = () => {
                const buttons = [];

                const makeBtnStyle = (bgColor) => `
                    padding: ${Math.round(7 * scale)}px;
                    background-color: ${bgColor};
                    color: white;
                    border: 1.5px solid rgba(255,255,255,0.85);
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: auto;
                    opacity: 0.9;
                    transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                    transform: scale(${scale});
                    transform-origin: center;
                    margin: 0 3px;
                `;

                const iconSize = Math.round(16 * scale);

                // --- Button 1: WhatsApp Green Direct Download Button ---
                const dlBtn = document.createElement('button');
                dlBtn.className = 'magic-dl-btn';
                dlBtn.title = isVideo ? 'Download WhatsApp Video' : 'Download WhatsApp Image';
                const dlIconSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
                dlBtn.innerHTML = dlIconSvg;
                dlBtn.style.cssText = makeBtnStyle('#25D366');

                dlBtn.addEventListener('mouseenter', () => {
                    dlBtn.style.opacity = '1';
                    dlBtn.style.backgroundColor = '#1ebe5d';
                });
                dlBtn.addEventListener('mouseleave', () => {
                    dlBtn.style.opacity = '0.9';
                    dlBtn.style.backgroundColor = '#25D366';
                });
                dlBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    let url = getResolvedMediaUrl(media, isVideo);
                    if (!url) {
                        setTimeout(() => {
                            url = getResolvedMediaUrl(media, isVideo);
                            if (url) {
                                downloadMediaBlob(url, isVideo);
                            } else {
                                alert("Media is still buffering in WhatsApp. Please try again in a moment.");
                            }
                        }, 350);
                        return;
                    }

                    downloadMediaBlob(url, isVideo);

                    // Micro-interaction: Checkmark confirmation feedback
                    dlBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    dlBtn.style.backgroundColor = '#128C7E';
                    setTimeout(() => {
                        dlBtn.innerHTML = dlIconSvg;
                        dlBtn.style.backgroundColor = '#25D366';
                    }, 1400);
                });
                buttons.push(dlBtn);

                // --- Button 2: Blue Open in New Tab Button ---
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open video in new tab' : 'Open image in new tab';
                const openIconSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                const spinnerSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 0.8s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"></circle></svg>`;
                openBtn.innerHTML = openIconSvg;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                openBtn.addEventListener('mouseenter', () => {
                    openBtn.style.opacity = '1';
                    openBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
                });
                openBtn.addEventListener('mouseleave', () => {
                    openBtn.style.opacity = '0.9';
                    openBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                openBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    let url = getResolvedMediaUrl(media, isVideo);
                    if (!url) {
                        setTimeout(async () => {
                            url = getResolvedMediaUrl(media, isVideo);
                            if (url) {
                                openBtn.innerHTML = spinnerSvg;
                                await openMediaTab(url, isVideo);
                                setTimeout(() => { openBtn.innerHTML = openIconSvg; }, 800);
                            } else {
                                alert("Media is still buffering in WhatsApp. Please try again in a moment.");
                            }
                        }, 350);
                        return;
                    }

                    openBtn.innerHTML = spinnerSvg;
                    await openMediaTab(url, isVideo);
                    setTimeout(() => { openBtn.innerHTML = openIconSvg; }, 800);
                });
                buttons.push(openBtn);

                // --- Button 3: Video Poster / Thumbnail Download (Videos Only) ---
                if (isVideo) {
                    const thumbBtn = document.createElement('button');
                    thumbBtn.className = 'magic-thumb-btn';
                    thumbBtn.title = 'Download video thumbnail';
                    thumbBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
                    thumbBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                    thumbBtn.addEventListener('mouseenter', () => {
                        thumbBtn.style.opacity = '1';
                        thumbBtn.style.backgroundColor = 'rgba(230, 126, 34, 0.95)';
                    });
                    thumbBtn.addEventListener('mouseleave', () => {
                        thumbBtn.style.opacity = '0.9';
                        thumbBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                    });
                    thumbBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const poster = getVideoPosterUrl(media);
                        if (poster) {
                            downloadMediaBlob(poster, false);
                        } else {
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = media.videoWidth || 640;
                                canvas.height = media.videoHeight || 360;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                downloadMediaBlob(dataUrl, false);
                            } catch (err) {
                                console.warn('Toystaller: Could not capture video poster frame:', err);
                            }
                        }
                    });
                    buttons.push(thumbBtn);
                }

                return buttons;
            };

            window.magicOverlayManager.addOverlay(media, createButtonsFn);
        }
    });
}

let injectScheduled = false;
function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
        injectScheduled = false;
        injectDownloadButtons();
    }, 120);
}

// Dashboard Overlay
let dashboardContainer = null;
function toggleDashboardOverlay() {
    if (dashboardContainer) {
        dashboardContainer.remove();
        dashboardContainer = null;
        return;
    }

    const platform = getActivePlatform();

    dashboardContainer = document.createElement('div');
    dashboardContainer.id = 'toystaller-dashboard-container';
    dashboardContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;

    const shadow = dashboardContainer.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>
            .dashboard {
                background: rgba(17, 27, 33, 0.95);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 16px;
                color: #e9edef;
                width: 280px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 8px;
                margin-bottom: 12px;
            }
            h2 { margin: 0; font-size: 14px; font-weight: 600; color: #fff; }
            .close-btn {
                background: transparent;
                border: none;
                color: #8696a0;
                font-size: 18px;
                cursor: pointer;
                transition: color 0.2s;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: 4px;
            }
            .close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
            .info-row {
                font-size: 12px;
                color: #8696a0;
                text-align: center;
                padding: 6px 0;
            }
            .specialization {
                margin-top: 8px;
                padding: 10px;
                background: rgba(255, 255, 255, 0.04);
                border-radius: 8px;
                font-size: 11px;
                line-height: 1.5;
                color: #d1d7db;
                border-left: 3px solid #25D366;
            }
        </style>

        <div class="dashboard">
            <div class="header">
                <h2>Toystaller ${platform.version || 'v6.0'} — WhatsApp Edition</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on ${window.location.hostname}
            </div>
            <div class="specialization">
                <strong>WhatsApp Downloader:</strong><br/>
                Download high-resolution images, videos, and status updates directly to your computer.
            </div>
        </div>
    `;

    shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);
    document.body.appendChild(dashboardContainer);
}

// Background script listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'toggleDashboard') {
            toggleDashboardOverlay();
        }
    });
}

let toystallerBooted = false;

function bootToystaller(platformScripts = [], routerCode = null) {
    if (toystallerBooted) return;
    toystallerBooted = true;

    if (platformScripts && platformScripts.length > 0) {
        let currentScriptIdx = 0;
        const injectNext = () => {
            if (currentScriptIdx >= platformScripts.length) {
                if (routerCode) {
                    const routerScript = document.createElement('script');
                    routerScript.textContent = routerCode;
                    (document.head || document.documentElement).appendChild(routerScript);
                    routerScript.remove();
                }
                return;
            }
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(platformScripts[currentScriptIdx]);
            script.onload = () => {
                script.remove();
                currentScriptIdx++;
                injectNext();
            };
            (document.head || document.documentElement).appendChild(script);
        };
        injectNext();
    }

    injectDownloadButtons();
    setInterval(injectDownloadButtons, 1000);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

// Auto-boot if not already booted
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!toystallerBooted) bootToystaller();
    });
} else {
    setTimeout(() => {
        if (!toystallerBooted) bootToystaller();
    }, 100);
}
