// overlay_manager.js
// Tracks media elements and positions action buttons safely on document.body.
// WhatsApp Edition: Section-aware modal suppression, zero-bleed backdrop isolation, smart corner placement,
// clamped-inside-frame positioning, per-section toggle support.

class OverlayManager {
    constructor() {
        this.overlays = new Map();
        this.activeEntry = null;
        this.hideTimeout = null;

        // Per-section toggle settings (loaded from chrome.storage)
        this._sectionToggles = {
            toystaller_wa_chat:         true,
            toystaller_wa_status:       true,
            toystaller_wa_media_viewer: true,
            toystaller_wa_profile:      true
        };
        this._loadToggles();

        // Listen for settings changes from popup
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((msg) => {
                if (msg && msg.action === 'toystaller_settings_changed') {
                    this._sectionToggles[msg.key] = msg.value;
                    this.updateAllPositions();
                }
            });
        }

        this._onMouseMove = this._throttle(this._handlePointerMove.bind(this), 30);
        document.addEventListener('mousemove', this._onMouseMove, true);
        document.addEventListener('pointermove', this._onMouseMove, true);

        window.addEventListener('scroll', () => this.updateAllPositions(), true);
        window.addEventListener('resize', () => this.updateAllPositions());

        // Instant modal listener — when a dialog/modal opens or closes, immediately sync overlay visibility
        this._modalObserver = new MutationObserver(() => {
            this.updateAllPositions();
        });
        const obsTarget = document.documentElement || document.body;
        if (obsTarget) {
            this._modalObserver.observe(obsTarget, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['role', 'aria-modal', 'class', 'data-animate-media-viewer', 'data-animate-status-v3', 'data-testid']
            });
        }

        setInterval(() => this.updateAllPositions(), 1000);
    }

    _loadToggles() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(Object.keys(this._sectionToggles), (result) => {
                    if (chrome.runtime.lastError) return;
                    for (const key of Object.keys(this._sectionToggles)) {
                        if (result[key] !== undefined && result[key] !== null) {
                            this._sectionToggles[key] = result[key];
                        }
                    }
                    this.updateAllPositions();
                });
            }
        } catch(e) { /* storage unavailable */ }
    }

    _isSectionDisabledByToggle() {
        const platform = this._getPlatform();
        if (!platform || !platform.getSection) return false;
        const section = platform.getSection();

        if (section === 'wa-chat')         return !this._sectionToggles.toystaller_wa_chat;
        if (section === 'wa-status')       return !this._sectionToggles.toystaller_wa_status;
        if (section === 'wa-media-viewer') return !this._sectionToggles.toystaller_wa_media_viewer;
        if (section === 'wa-profile')      return !this._sectionToggles.toystaller_wa_profile;

        return false;
    }

    _getPlatform() {
        if (typeof PlatformManager !== 'undefined') {
            return PlatformManager.getPlatform();
        }
        if (window.ToystallerActivePlatform) {
            return window.ToystallerActivePlatform;
        }
        if (window.ToystallerPlatforms && window.ToystallerPlatforms['whatsapp']) {
            return window.ToystallerPlatforms['whatsapp'];
        }
        return null;
    }

    _throttle(fn, ms) {
        let last = 0;
        let pending = null;
        return (...args) => {
            const now = Date.now();
            const run = () => {
                last = Date.now();
                pending = null;
                fn(...args);
            };
            if (now - last >= ms) {
                run();
            } else if (!pending) {
                pending = setTimeout(run, ms - (now - last));
            }
        };
    }

    _findHoverHost(media) {
        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) return media;

        let host = media;
        let node = media.parentElement;

        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            const rect = node.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 40) break;

            const wRatio = rect.width / mediaRect.width;
            const hRatio = rect.height / mediaRect.height;

            if (wRatio >= 0.8 && wRatio <= 1.4 && hRatio >= 0.8 && hRatio <= 1.4) {
                host = node;
            } else {
                break;
            }
        }

        return host;
    }

    _isClippedByAncestor(media) {
        const platform = this._getPlatform();
        if (platform && platform.isInsideModal && platform.isInsideModal(media)) {
            return false;
        }

        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) return true;

        let node = media.parentElement;
        let depth = 0;

        while (node && node !== document.body && node !== document.documentElement && depth < 15) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                if (style.overflow === 'hidden' || style.overflow === 'scroll' || style.overflow === 'auto' || 
                    style.overflowY === 'hidden' || style.overflowY === 'scroll' || style.overflowY === 'auto' ||
                    style.overflowX === 'hidden' || style.overflowX === 'scroll' || style.overflowX === 'auto') {
                    
                    const parentRect = node.getBoundingClientRect();
                    
                    const intersectLeft = Math.max(mediaRect.left, parentRect.left);
                    const intersectTop = Math.max(mediaRect.top, parentRect.top);
                    const intersectRight = Math.min(mediaRect.right, parentRect.right);
                    const intersectBottom = Math.min(mediaRect.bottom, parentRect.bottom);
                    
                    const intersectWidth = intersectRight - intersectLeft;
                    const intersectHeight = intersectBottom - intersectTop;
                    
                    if (intersectWidth <= 0 || intersectHeight <= 0) {
                        return true;
                    }
                    
                    const intersectArea = intersectWidth * intersectHeight;
                    const mediaArea = mediaRect.width * mediaRect.height;
                    
                    if (intersectArea / mediaArea < 0.35) {
                        return true;
                    }
                }
            }
            node = node.parentElement;
            depth++;
        }
        return false;
    }

    _pointInRect(x, y, rect) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    _getHoverRect(media, entry) {
        const mediaRect = media.getBoundingClientRect();
        const hostRect = entry.hoverHost.getBoundingClientRect();

        if (hostRect.width >= mediaRect.width * 0.8 && hostRect.height >= mediaRect.height * 0.8) {
            return hostRect;
        }
        return mediaRect;
    }

    _handlePointerMove(e) {
        const x = e.clientX;
        const y = e.clientY;

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

        let hoverCandidates = [];

        // 1. Check if hovering directly over an existing button
        for (const [media, entry] of this.overlays.entries()) {
            if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
                if (entry.container.style.display !== 'none') {
                    entry.container.style.display = 'none';
                    entry.container.style.visibility = 'hidden';
                }
                continue;
            }

            if (entry.container.style.display === 'none') continue;

            const btnRect = entry.container.getBoundingClientRect();
            if (btnRect.width > 0 && this._pointInRect(x, y, btnRect)) {
                this._show(entry);
                return;
            }

            if (this._isClippedByAncestor(media)) continue;

            const hoverRect = this._getHoverRect(media, entry);
            if (hoverRect.width > 0 && hoverRect.height > 0 && this._pointInRect(x, y, hoverRect)) {
                hoverCandidates.push({ media, entry });
            }
        }

        if (hoverCandidates.length === 0) {
            this._scheduleHide();
            return;
        }

        // 2. Use document.elementsFromPoint
        const hits = document.elementsFromPoint(x, y);
        if (!hits || hits.length === 0) {
            this._scheduleHide();
            return;
        }

        let matchedCandidates = [];

        for (const el of hits) {
            for (const candidate of hoverCandidates) {
                const entry = candidate.entry;
                const media = candidate.media;
                if (el === entry.hoverHost || entry.hoverHost.contains(el) || el === media || media.contains(el)) {
                    if (!matchedCandidates.includes(candidate)) {
                        matchedCandidates.push(candidate);
                    }
                } else {
                    const parentContainer = media.closest('[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"], [data-animate-status-v3="true"], div[data-testid="status-v3-main"], div[data-testid="status-viewer"], div[role="row"], div[data-testid="msg-container"]');
                    if (parentContainer && (parentContainer === el || parentContainer.contains(el))) {
                        if (!this.isSiteControl(el, media)) {
                            if (!matchedCandidates.includes(candidate)) {
                                matchedCandidates.push(candidate);
                            }
                        }
                    }
                }
            }
        }

        if (matchedCandidates.length === 0 && hoverCandidates.length > 0) {
            const modalCandidate = hoverCandidates.find(c => platform && platform.isInsideModal && platform.isInsideModal(c.media));
            if (modalCandidate) {
                const hitSiteControl = hits.some(el => this.isSiteControl(el, modalCandidate.media));
                if (!hitSiteControl) {
                    matchedCandidates.push(modalCandidate);
                }
            }
        }

        if (matchedCandidates.length > 0) {
            const videoCandidate = matchedCandidates.find(c => c.media.tagName.toLowerCase() === 'video');
            if (videoCandidate) {
                this._show(videoCandidate.entry);
            } else {
                this._show(matchedCandidates[0].entry);
            }
            return;
        }

        this._scheduleHide();
    }

    _show(entry) {
        clearTimeout(this.hideTimeout);
        if (this.activeEntry && this.activeEntry !== entry) {
            this._hide(this.activeEntry);
        }
        entry.container.style.display = 'flex';
        entry.container.style.opacity = '1';
        entry.container.style.visibility = 'visible';
        entry.container.style.pointerEvents = 'auto';
        this.activeEntry = entry;
    }

    _hide(entry) {
        if (!entry || !entry.container) return;
        entry.container.style.opacity = '0';
        entry.container.style.visibility = 'hidden';
        entry.container.style.pointerEvents = 'none';
    }

    _scheduleHide() {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => {
            for (const entry of this.overlays.values()) {
                this._hide(entry);
            }
            this.activeEntry = null;
        }, 300);
    }

    addOverlay(media, createButtonsFn) {
        if (this.overlays.has(media)) return;

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;
        if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'magic-dl-overlay';
        container.style.cssText = `
            position: fixed;
            z-index: 2147483646;
            display: flex;
            gap: 6px;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease, visibility 0.15s ease;
        `;

        const buttons = createButtonsFn();
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', () => this._show(this.overlays.get(media)));
            container.appendChild(btn);
        });

        document.body.appendChild(container);

        const hoverHost = this._findHoverHost(media);
        const hostShow = () => {
            const entry = this.overlays.get(media);
            if (entry) {
                const curPlatform = this._getPlatform();
                const curModal = curPlatform && curPlatform.hasActiveModal ? curPlatform.hasActiveModal() : false;
                if (curModal && curPlatform && curPlatform.isInsideModal && !curPlatform.isInsideModal(media)) {
                    return;
                }
                this._show(entry);
            }
        };
        const hostHide = () => this._scheduleHide();

        hoverHost.addEventListener('mouseenter', hostShow, true);
        hoverHost.addEventListener('mouseleave', hostHide, true);
        hoverHost.addEventListener('pointerenter', hostShow, true);
        hoverHost.addEventListener('pointerleave', hostHide, true);

        const resizeObserver = new ResizeObserver(() => {
            this.updatePosition(media, container);
        });
        resizeObserver.observe(media);
        if (hoverHost !== media) {
            resizeObserver.observe(hoverHost);
        }

        const entry = { container, corner: null, resizeObserver, hoverHost, isVisible: false, intersectionObserver: null };
        
        entry.intersectionObserver = new IntersectionObserver((entries) => {
            for (const e of entries) {
                entry.isVisible = e.isIntersecting;
                this.updatePosition(media, container);
            }
        }, { threshold: 0.15 });
        
        entry.intersectionObserver.observe(media);

        this.overlays.set(media, entry);

        requestAnimationFrame(() => this.updatePosition(media, container));
    }

    isSiteControl(el, media) {
        if (!el || el === document.documentElement || el === document.body) return false;
        if (el.closest('.magic-dl-overlay')) return false;
        if (el === media || media.contains(el)) return false;

        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const className = (el.className && typeof el.className === 'string')
            ? el.className.toLowerCase()
            : '';

        const controlHints = ['close', 'dismiss', 'minimize', 'expand', 'fullscreen', 'menu', 'more', 'options', 'share',
                               'mute', 'unmute', 'volume', 'sound', 'play', 'pause', 'like', 'comment', 'follow',
                               'audio', 'speaker', 'forward', 'rewind', 'skip', 'next', 'previous', 'seek', 'star'];
        const hintText = `${ariaLabel} ${title} ${className}`;
        if (controlHints.some(hint => hintText.includes(hint))) return true;

        if (['button', 'input', 'select', 'textarea'].includes(tag)) return true;
        if (role === 'button' || role === 'menuitem') return true;
        if (el.closest('button, [role="button"], [role="menuitem"]')) return true;

        // Header controls inside WhatsApp status or media viewer dialog
        if (el.closest('header, [data-testid*="header"], [data-testid="status-header"], [data-testid="status-v3-main"] > div:first-child')) return true;
        if (el.closest('button[aria-label*="Play" i], button[aria-label*="Pause" i], button[aria-label*="Mute" i], button[aria-label*="Unmute" i], button[aria-label*="Close" i], button[aria-label*="More" i]')) return true;

        const style = window.getComputedStyle(el);
        if (style.pointerEvents !== 'none' && parseInt(style.zIndex, 10) > 5000) return true;

        return false;
    }

    getPlatformConfig(media) {
        const platform = this._getPlatform();
        if (platform && platform.getPlatformConfig) {
            return platform.getPlatformConfig(media || window.location.pathname.toLowerCase());
        }
        return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 12 };
    }

    cornerHasConflict(media, rect, corner, width, height, pad = 12) {
        const config = this.getPlatformConfig(media);
        const topOffset = config.topOffset || 0;
        const bottomOffset = config.bottomOffset || 0;
        let left;
        let top;

        switch (corner) {
            case 'bottom-right':
                left = rect.right - width - pad;
                top = rect.bottom - height - pad - bottomOffset;
                break;
            case 'bottom-left':
                left = rect.left + pad;
                top = rect.bottom - height - pad - bottomOffset;
                break;
            case 'top-left':
                left = rect.left + pad;
                top = rect.top + pad + topOffset;
                break;
            case 'top-right':
            default:
                left = rect.right - width - pad;
                top = rect.top + pad + topOffset;
                break;
        }

        // Test multiple points across the proposed button bounds
        const testPoints = [
            { x: left + 6, y: top + 6 },
            { x: left + width / 2, y: top + height / 2 },
            { x: left + width - 6, y: top + 6 },
            { x: left + width - 6, y: top + height - 6 },
            { x: left + 6, y: top + height - 6 }
        ];

        for (const pt of testPoints) {
            const elements = document.elementsFromPoint(pt.x, pt.y);
            for (const el of elements) {
                if (this.isSiteControl(el, media)) {
                    return true;
                }
            }
        }
        return false;
    }

    chooseCorner(media, rect, width, height) {
        const config = this.getPlatformConfig(media);
        const preferred = config.preferredCorners || ['top-right', 'top-left', 'bottom-right'];
        const pad = config.padding !== undefined ? config.padding : 12;

        for (const corner of preferred) {
            if (!this.cornerHasConflict(media, rect, corner, width, height, pad)) {
                return corner;
            }
        }
        return preferred[0] || 'top-right';
    }

    _getVisibleClampedRect(media) {
        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) return null;

        const platform = this._getPlatform();
        if (platform && platform.isInsideModal && platform.isInsideModal(media)) {
            return mediaRect;
        }

        let clipLeft   = mediaRect.left;
        let clipTop    = mediaRect.top;
        let clipRight  = mediaRect.right;
        let clipBottom = mediaRect.bottom;

        let node = media.parentElement;
        let depth = 0;
        while (node && node !== document.body && node !== document.documentElement && depth < 15) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                if (style.overflow === 'hidden' || style.overflow === 'scroll' || style.overflow === 'auto' ||
                    style.overflowY === 'hidden' || style.overflowY === 'scroll' || style.overflowY === 'auto' ||
                    style.overflowX === 'hidden' || style.overflowX === 'scroll' || style.overflowX === 'auto') {
                    const parentRect = node.getBoundingClientRect();
                    clipLeft   = Math.max(clipLeft,   parentRect.left);
                    clipTop    = Math.max(clipTop,    parentRect.top);
                    clipRight  = Math.min(clipRight,  parentRect.right);
                    clipBottom = Math.min(clipBottom, parentRect.bottom);
                }
            }
            node = node.parentElement;
            depth++;
        }

        if (clipRight <= clipLeft || clipBottom <= clipTop) {
            return null;
        }

        return {
            left: clipLeft,
            top: clipTop,
            right: clipRight,
            bottom: clipBottom,
            width: clipRight - clipLeft,
            height: clipBottom - clipTop
        };
    }

    updatePosition(media, container) {
        if (!media.isConnected) {
            container.remove();
            const entry = this.overlays.get(media);
            if (entry) {
                entry.resizeObserver.disconnect();
                if (entry.intersectionObserver) entry.intersectionObserver.disconnect();
                if (this.activeEntry === entry) this.activeEntry = null;
            }
            this.overlays.delete(media);
            return;
        }

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;
        if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        if (this._isSectionDisabledByToggle()) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        const rect = this._getVisibleClampedRect(media);

        if (!rect || rect.width < 50 || rect.height < 50) {
            container.style.display = 'none';
            return;
        }

        const config = this.getPlatformConfig(media);
        const pad = config.padding !== undefined ? config.padding : 12;
        const topOffset = config.topOffset || 0;
        const bottomOffset = config.bottomOffset || 0;

        const overlayWidth = container.offsetWidth || 84;
        const overlayHeight = container.offsetHeight || 34;

        const corner = this.chooseCorner(media, rect, overlayWidth, overlayHeight);
        const entry = this.overlays.get(media);
        if (entry) entry.corner = corner;

        let left;
        let top;

        switch (corner) {
            case 'bottom-right':
                left = rect.right - overlayWidth - pad;
                top = rect.bottom - overlayHeight - pad - bottomOffset;
                break;
            case 'bottom-left':
                left = rect.left + pad;
                top = rect.bottom - overlayHeight - pad - bottomOffset;
                break;
            case 'top-left':
                left = rect.left + pad;
                top = rect.top + pad + topOffset;
                break;
            case 'top-right':
            default:
                left = rect.right - overlayWidth - pad;
                top = rect.top + pad + topOffset;
                break;
        }

        const section = platform && platform.getSection ? platform.getSection(media) : '';
        if (section === 'wa-status') {
            // HARD CLAMP FOR STATUS:
            // Top must NEVER be inside the header (y < 90px) where Play/Pause/Mute reside
            if (corner.startsWith('top')) {
                top = Math.max(90, top);
            } else {
                top = Math.min(window.innerHeight - overlayHeight - 80, top);
            }
            // Clamp within viewport horizontally
            left = Math.max(16, Math.min(left, window.innerWidth - overlayWidth - 16));
        } else if (section === 'wa-media-viewer') {
            if (corner === 'top-right') {
                top = Math.max(72, top);
            }
            left = Math.max(rect.left + 2, Math.min(left, rect.right - overlayWidth - 2));
            top = Math.max(rect.top + 2, Math.min(top, rect.bottom - overlayHeight - 2));
        } else {
            left = Math.max(rect.left + 2, Math.min(left, rect.right - overlayWidth - 2));
            top = Math.max(rect.top + 2, Math.min(top, rect.bottom - overlayHeight - 2));
        }

        container.style.left = `${left}px`;
        container.style.top = `${top}px`;
    }

    updateAllPositions() {
        for (const [media, entry] of this.overlays.entries()) {
            this.updatePosition(media, entry.container);
        }
    }
}

window.MagicOverlayManager = OverlayManager;
if (!window.magicOverlayManager) {
    window.magicOverlayManager = new OverlayManager();
}
