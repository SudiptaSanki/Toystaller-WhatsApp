// core/content_core.js
// Toystaller v1.0 (WhatsApp Edition) — Specialized Media Extractor & Button Injector.
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

// Safely opens the image or video in a new dedicated viewer/player tab
async function openMediaTab(url, isVideo = false) {
    if (!url) {
        console.warn('Toystaller: No media URL found to open.');
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = isVideo ? 'mp4' : 'jpg';
    const filename = `whatsapp_${isVideo ? 'video' : 'image'}_${timestamp}.${ext}`;

    if (url.startsWith('blob:') || url.startsWith('data:')) {
        try {
            const res = await fetch(url);
            const blob = await res.blob();

            // Convert to Base64 Data URL so it serializes cleanly without corruption in messaging
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                safeSendMessage({
                    action: 'createPlayerTab',
                    dataUrl: dataUrl,
                    mimeType: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
                    isVideo: isVideo,
                    filename: filename
                }, (response) => {
                    if (!response || !response.success) {
                        window.open(url, '_blank');
                    }
                });
            };
            reader.onerror = () => {
                window.open(url, '_blank');
            };
            reader.readAsDataURL(blob);
            return;
        } catch (err) {
            console.error('Toystaller: Failed to read media blob for viewer tab:', err);
            window.open(url, '_blank');
        }
    } else {
        safeSendMessage({ 
            action: 'createPlayerTab', 
            url: url, 
            isVideo: isVideo, 
            filename: filename 
        }, (response) => {
            if (!response || !response.success) {
                safeSendMessage({ action: 'openInNewTab', url: url, isVideo: isVideo });
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
    return window.ToystallerActivePlatform || (window.ToystallerPlatforms && window.ToystallerPlatforms['whatsapp']) || {
        name: 'whatsapp',
        hasActiveModal() { return false; },
        isInsideModal() { return false; },
        isThumbnail() { return false; },
        getButtonScale() { return 1; },
        filterBackgroundUrls(candidates) { return candidates; },
        useDirectDownload: false,
        isInternalUrl() { return true; }
    };
}

function getHighResImageUrl(media) {
    if (!media) return null;
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
    // Check nested or adjacent video element if media is a container
    if (!url && media.parentElement) {
        const nested = media.parentElement.querySelector('video');
        if (nested && nested !== media) {
            url = nested.currentSrc || nested.src || '';
        }
    }
    return url;
}

function getResolvedMediaUrl(media, isVideo) {
    if (isVideo) {
        return getVideoUrl(media);
    }
    return getHighResImageUrl(media);
}

// Active polling and event listener for media that is still buffering (e.g., status video newly opened)
function resolveMediaWithWait(media, isVideo, timeoutMs = 2000) {
    return new Promise((resolve) => {
        let url = getResolvedMediaUrl(media, isVideo);
        if (url) return resolve(url);

        const startTime = Date.now();
        const interval = setInterval(() => {
            url = getResolvedMediaUrl(media, isVideo);
            if (url) {
                clearInterval(interval);
                return resolve(url);
            }
            if (Date.now() - startTime >= timeoutMs) {
                clearInterval(interval);
                return resolve(null);
            }
        }, 120);

        if (media && media.addEventListener) {
            const onLoaded = () => {
                cleanup();
                resolve(getResolvedMediaUrl(media, isVideo));
            };
            const cleanup = () => {
                media.removeEventListener('loadeddata', onLoaded);
                media.removeEventListener('canplay', onLoaded);
            };
            media.addEventListener('loadeddata', onLoaded, { once: true });
            media.addEventListener('canplay', onLoaded, { once: true });
        }
    });
}

function getVideoPosterUrl(media) {
    if (!media) return null;
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
                    border-radius: 7px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: auto;
                    opacity: 0.55;
                    transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.45);
                    transform: scale(${scale});
                    transform-origin: center;
                    margin: 0 3px;
                `;

                const iconSize = Math.round(16 * scale);
                const arrowSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                const spinnerSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: toystaller-spin 0.8s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"></circle></svg>`;

                // Ensure spinner animation is injected once
                if (!document.getElementById('toystaller-spin-style')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'toystaller-spin-style';
                    styleEl.textContent = `@keyframes toystaller-spin { 100% { transform: rotate(360deg); } }`;
                    (document.head || document.documentElement).appendChild(styleEl);
                }

                // --- Button 1: Blue Arrow Button (Open Video/Image in new tab) ---
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open HD video in new tab' : 'Open photo in new tab';
                openBtn.innerHTML = arrowSvg;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                openBtn.addEventListener('mouseenter', () => {
                    openBtn.style.opacity = '1';
                    openBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
                });
                openBtn.addEventListener('mouseleave', () => {
                    openBtn.style.opacity = '0.55';
                    openBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                openBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    openBtn.innerHTML = spinnerSvg;
                    let url = await resolveMediaWithWait(media, isVideo, 2000);
                    if (url) {
                        await openMediaTab(url, isVideo);
                    } else {
                        alert("Media is still buffering in WhatsApp. Please make sure playback starts and try again.");
                    }
                    setTimeout(() => { openBtn.innerHTML = arrowSvg; }, 600);
                });
                buttons.push(openBtn);

                // --- Button 2: Red Arrow Button (Open Thumbnail / Poster in new tab) ---
                const imgBtn = document.createElement('button');
                imgBtn.className = 'magic-img-btn';
                imgBtn.title = isVideo ? 'Open thumbnail in new tab' : 'Open photo in new tab';
                imgBtn.innerHTML = arrowSvg;
                imgBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                imgBtn.addEventListener('mouseenter', () => {
                    imgBtn.style.opacity = '1';
                    imgBtn.style.backgroundColor = 'rgba(231, 76, 60, 0.95)';
                });
                imgBtn.addEventListener('mouseleave', () => {
                    imgBtn.style.opacity = '0.55';
                    imgBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                imgBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    imgBtn.innerHTML = spinnerSvg;

                    if (isVideo) {
                        // 1. Try static poster attribute
                        let poster = getVideoPosterUrl(media);
                        if (poster) {
                            await openMediaTab(poster, false);
                            setTimeout(() => { imgBtn.innerHTML = arrowSvg; }, 600);
                            return;
                        }

                        // 2. Capture video frame via offscreen canvas
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = media.videoWidth || 640;
                            canvas.height = media.videoHeight || 360;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                            await openMediaTab(dataUrl, false);
                        } catch (err) {
                            console.warn('Toystaller: Could not capture frame from video:', err);
                            // Fallback to video URL itself
                            const vUrl = await resolveMediaWithWait(media, true, 1000);
                            if (vUrl) {
                                await openMediaTab(vUrl, true);
                            } else {
                                alert("No thumbnail available for this video.");
                            }
                        }
                    } else {
                        // Photo element: open full-resolution photo in new tab
                        let imgUrl = await resolveMediaWithWait(media, false, 1000);
                        if (imgUrl) {
                            await openMediaTab(imgUrl, false);
                        } else {
                            alert("Could not extract image source.");
                        }
                    }

                    setTimeout(() => { imgBtn.innerHTML = arrowSvg; }, 600);
                });
                buttons.push(imgBtn);

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
                <h2>Toystaller ${platform.version || 'v1.0'} — WhatsApp Edition</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on ${window.location.hostname}
            </div>
            <div class="specialization">
                <strong>WhatsApp Downloader:</strong><br/>
                Download high-resolution images, videos, and status updates directly in high-quality new tabs.
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
