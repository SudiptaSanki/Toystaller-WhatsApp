// background_script.js
// Toystaller: WhatsApp Edition — Network interception, download dispatcher, tab management.

const interceptedMedia = {};
const viewerMediaCache = new Map();

const mediaExtensions = ['.mp4', '.m3u8', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.m4a'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const { tabId, url, type } = details;
        if (tabId < 0) return;

        const lowerUrl = url.toLowerCase();
        const isVideo = type === 'media' ||
                        mediaExtensions.some(ext => lowerUrl.includes(ext)) ||
                        lowerUrl.includes('mime=video') ||
                        lowerUrl.includes('/video/');
        const isImage = type === 'image' || imageExtensions.some(ext => lowerUrl.includes(ext));

        if (isVideo || isImage) {
            if (!interceptedMedia[tabId]) {
                interceptedMedia[tabId] = { video: new Set(), img: new Set() };
            }
            if (isVideo) {
                interceptedMedia[tabId].video.add(url);
            } else if (isImage) {
                interceptedMedia[tabId].img.add(url);
            }
        }
    },
    { urls: ["*://web.whatsapp.com/*", "*://*.whatsapp.net/*"] }
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getMediaUrls') {
        const tabId = sender.tab ? sender.tab.id : request.tabId;
        const mediaType = request.mediaType;
        const tabMedia = interceptedMedia[tabId];
        const urls = tabMedia && tabMedia[mediaType] ? Array.from(tabMedia[mediaType]) : [];
        sendResponse({ urls: urls });
    } else if (request.action === 'downloadMedia') {
        const downloadOptions = {
            url: request.url,
            saveAs: false
        };
        if (request.filename) {
            downloadOptions.filename = request.filename;
        }

        chrome.downloads.download(downloadOptions, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Toystaller: Download failed:", chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId: downloadId });
            }
        });
        return true;
    } else if (request.action === 'createViewerTab') {
        const id = 'viewer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        viewerMediaCache.set(id, {
            buffer: request.buffer,
            mimeType: request.mimeType,
            isVideo: request.isVideo,
            filename: request.filename,
            timestamp: Date.now()
        });

        // 60-second automatic garbage collection if tab isn't opened
        setTimeout(() => {
            if (viewerMediaCache.has(id)) {
                viewerMediaCache.delete(id);
            }
        }, 60000);

        chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${id}`) }, (tab) => {
            if (chrome.runtime.lastError) {
                console.error("Toystaller: Failed to create viewer tab:", chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, id: id, tabId: tab ? tab.id : null });
            }
        });
        return true;
    } else if (request.action === 'getViewerMedia') {
        const id = request.id;
        const media = viewerMediaCache.get(id);
        if (media) {
            viewerMediaCache.delete(id);
            sendResponse(media);
        } else {
            sendResponse(null);
        }
        return true;
    } else if (request.action === 'openInNewTab') {
        try {
            chrome.tabs.create({ url: request.url }, () => {
                if (chrome.runtime.lastError) {
                    console.warn("Toystaller: Could not open tab directly:", chrome.runtime.lastError.message);
                }
            });
        } catch (e) {
            console.warn("Toystaller: Could not open tab:", e);
        }
        sendResponse({ success: true });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete interceptedMedia[tabId];
});

if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener((tab) => {
        if (tab && tab.id > 0) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggleDashboard' }).catch(() => {});
        }
    });
}
