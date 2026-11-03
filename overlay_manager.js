// overlay_manager.js
// Tracks media elements and positions action buttons safely on document.body.
// Toystaller v1.0 (Specialized WhatsApp Edition):
// - Permanently locked corners per media element (never jumps down on scroll)
// - Clean disappearance when media scrolls behind sticky headers / navbars
// - Section-aware modal isolation (Chats, Status, Media Lightbox, Profile)
// - Clamped ancestor visibility checking and per-section toggles

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

        window.addEventListener('scroll', () => {
            if (this.activeEntry) {
                this._hide(this.activeEntry);
                this.activeEntry = null;
            }
            this.updateAllPositions();
        }, { passive: true, capture: true });
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

    _isSectionDisabledByToggle(media) {
        const platform = this._getPlatform();
        if (!platform || !platform.getSection) return false;
        const section = platform.getSection(media);

        if (section === 'wa-chat')         return !this._sectionToggles.toystaller_wa_chat;
        if (section === 'wa-status')       return !this._sectionToggles.toystaller_wa_status;
        if (section === 'wa-media-viewer') return !this._sectionToggles.toystaller_wa_media_viewer;
        if (section === 'wa-profile')      return !this._sectionToggles.toystaller_wa_profile;

        return false;
    }

    _getTopNavHeight(media) {
        const platform = this._getPlatform();
        const section = platform && platform.getSection ? platform.getSection(media) : '';
        if (section === 'wa-status') {
            return 85;
        }
        if (section === 'wa-media-viewer') {
            return 60;
        }
        // Active chat conversation header
        const chatHeader = document.querySelector('#main header, div[data-testid="conversation-header"], header');
        if (chatHeader) {
            const hRect = chatHeader.getBoundingClientRect();
            if (hRect.top <= 10 && hRect.bottom >= 40 && hRect.bottom <= 120) {
                return hRect.bottom;
            }
        }
        return 59;
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
            }

            if (node.tagName.toLowerCase() === 'article' ||
                node.getAttribute('role') === 'row' ||
                node.getAttribute('data-testid') === 'msg-container') {
                break;
            }
        }
        return host;
    }

    _pointInRect(x, y, rect) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    _isClippedByAncestor(el) {
        const elRect = el.getBoundingClientRect();
        let node = el.parentElement;
        let depth = 0;

        while (node && node !== document.body && node !== document.documentElement && depth < 12) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                const ov = style.overflow + style.overflowX + style.overflowY;
                if (ov.includes('hidden') || ov.includes('scroll') || ov.includes('auto') || ov.includes('clip')) {
                    const pRect = node.getBoundingClientRect();
                    if (elRect.bottom < pRect.top || elRect.top > pRect.bottom ||
                        elRect.right < pRect.left || elRect.left > pRect.right) {
                        return true;
                    }
                }
            }
            node = node.parentElement;
            depth++;
        }
        return false;
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
                               'audio', 'speaker', 'forward', 'rewind', 'skip', 'next', 'previous', 'seek', 'star', 'reply'];
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

    pickBestCorner(media, rect, container) {
        const config = this.getPlatformConfig(media);
        const preferred = config.preferredCorners || ['top-right', 'top-left', 'bottom-right'];
        const pad = config.padding !== undefined ? config.padding : 12;
        const width = container.offsetWidth || 84;
        const height = container.offsetHeight || 34;

        for (const corner of preferred) {
            if (!this.cornerHasConflict(media, rect, corner, width, height, pad)) {
                return corner;
            }
        }
        return preferred[0] || 'top-right';
    }

    // Compute the actually visible portion of a media element by intersecting
    // its rect with all overflow-clipping ancestors and the viewport.
    _getVisibleRect(media) {
        let vRect = media.getBoundingClientRect();
        let visTop = vRect.top;
        let visLeft = vRect.left;
        let visBottom = vRect.bottom;
        let visRight = vRect.right;

        let node = media.parentElement;
        let depth = 0;
        while (node && node !== document.body && node !== document.documentElement && depth < 15) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                const ov = style.overflow + style.overflowX + style.overflowY;
                if (ov.includes('hidden') || ov.includes('scroll') || ov.includes('auto') || ov.includes('clip')) {
                    const pRect = node.getBoundingClientRect();
                    visTop = Math.max(visTop, pRect.top);
                    visLeft = Math.max(visLeft, pRect.left);
                    visBottom = Math.min(visBottom, pRect.bottom);
                    visRight = Math.min(visRight, pRect.right);
                }
            }
            node = node.parentElement;
            depth++;
        }

        const platform = this._getPlatform();
        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const topLimit = inModal ? 0 : this._getTopNavHeight(media);

        visTop = Math.max(visTop, topLimit);
        visLeft = Math.max(visLeft, 0);
        visBottom = Math.min(visBottom, window.innerHeight);
        visRight = Math.min(visRight, window.innerWidth);

        return {
            top: visTop,
            left: visLeft,
            bottom: visBottom,
            right: visRight,
            width: Math.max(0, visRight - visLeft),
            height: Math.max(0, visBottom - visTop)
        };
    }

    applyCornerPosition(rect, container, corner, media) {
        const config = this.getPlatformConfig(media);
        const pad = config.padding !== undefined ? config.padding : 12;
        const topOffset = config.topOffset || 0;
        const bottomOffset = config.bottomOffset || 0;
        const width = container.offsetWidth || 84;
        const height = container.offsetHeight || 34;

        let top, left;

        switch (corner) {
            case 'bottom-right':
                top = rect.bottom - height - pad - bottomOffset;
                left = rect.right - width - pad;
                break;
            case 'bottom-left':
                top = rect.bottom - height - pad - bottomOffset;
                left = rect.left + pad;
                break;
            case 'top-left':
                top = rect.top + pad + topOffset;
                left = rect.left + pad;
                break;
            case 'top-right':
            default:
                top = rect.top + pad + topOffset;
                left = rect.right - width - pad;
                break;
        }

        const platform = this._getPlatform();
        const section = platform && platform.getSection ? platform.getSection(media) : 'wa-chat';
        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const isStatus = section === 'wa-status';
        const topNavHeight = inModal ? (isStatus ? 85 : 0) : this._getTopNavHeight(media);

        // 1. Strict Top Boundary:
        // As media scrolls, keep button locked in place! When its corner reaches under the top navbar/header,
        // HIDE it cleanly — NEVER dynamically jump down to bottom-right or slide along the header!
        if (top < topNavHeight + 4) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        // 2. Status reply drawer / bottom bounds:
        if (isStatus) {
            if (top + height > window.innerHeight - 75) {
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                return;
            }
        }

        // 3. Viewport Boundaries:
        if (top + height > window.innerHeight - 4 || left < 2 || left + width > window.innerWidth - 2) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        // 4. Overflow container / ancestor clipping:
        const vis = media ? this._getVisibleRect(media) : rect;
        if (top < vis.top - 2 || top + height > vis.bottom + 2 || left < vis.left - 2 || left + width > vis.right + 2) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        container.style.top = `${top}px`;
        container.style.left = `${left}px`;
    }

    updatePosition(media, container) {
        const entry = this.overlays.get(media);
        if (!entry) return;

        if (!media.isConnected) {
            entry.resizeObserver.disconnect();
            if (entry.intersectionObserver) entry.intersectionObserver.disconnect();
            container.remove();
            if (this.activeEntry === entry) this.activeEntry = null;
            this.overlays.delete(media);
            return;
        }

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

        // Modal isolation check
        if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        // Per-section toggle check
        if (this._isSectionDisabledByToggle(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        // Section thumbnail/eligibility check
        if (platform && platform.isThumbnail && platform.isThumbnail(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        const rect = media.getBoundingClientRect();
        const style = window.getComputedStyle(media);
        const isStyleHidden = style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none';

        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const topNavHeight = inModal ? 0 : this._getTopNavHeight(media);

        // If media has scrolled behind top navbar or off screen
        if (rect.bottom <= topNavHeight + 8) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        const vis = this._getVisibleRect(media);
        if (vis.height < 45 || vis.width < 50) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        if (rect.width === 0 || rect.height === 0 || !entry.isVisible || isStyleHidden || this._isClippedByAncestor(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            return;
        }

        const fullyAbove = rect.bottom < 0;
        const fullyBelow = rect.top > window.innerHeight;
        const fullyLeft = rect.right < 0;
        const fullyRight = rect.left > window.innerWidth;

        if (fullyAbove || fullyBelow || fullyLeft || fullyRight) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            return;
        }

        container.style.display = 'flex';
        if (this.activeEntry === entry) {
            container.style.visibility = 'visible';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }

        // Lock corner on first placement so buttons never jump down across corners on scroll!
        if (!entry.corner) {
            entry.corner = this.pickBestCorner(media, rect, container);
        }
        this.applyCornerPosition(rect, container, entry.corner, media);
    }

    updateAllPositions() {
        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

        // If an active modal is open and the activeEntry is outside the modal, instantly reset it
        if (hasModal && this.activeEntry && platform && platform.isInsideModal && !platform.isInsideModal(this.activeEntry.hoverHost)) {
            this._hide(this.activeEntry);
            this.activeEntry = null;
        }

        for (const [media, entry] of this.overlays.entries()) {
            this.updatePosition(media, entry.container);
        }
    }
}

window.MagicOverlayManager = OverlayManager;
if (!window.magicOverlayManager) {
    window.magicOverlayManager = new OverlayManager();
}
