window.ToystallerPlatforms = window.ToystallerPlatforms || {};

(function() {
    const whatsappPlatform = {
        name: 'whatsapp',
        version: 'v6.0',
        specialization: 'WhatsApp Web media extraction — Chats, Status, and Media Lightbox.',

        // --- Route & Section Detection ---
        getSection() {
            // Priority 1: Fullscreen media lightbox overlay
            if (document.querySelector('[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"]')) {
                return 'wa-media-viewer';
            }

            // Priority 2: Fullscreen status/story viewer
            if (document.querySelector('[data-animate-status-v3="true"], div[data-testid="status-v3-main"]')) {
                return 'wa-status';
            }

            // Priority 3: Contact / Group info drawer (wa-profile)
            if (document.querySelector('div[data-testid="drawer-right"]')) {
                return 'wa-profile';
            }

            // Priority 4: Main active conversation message stream
            if (document.querySelector('div[data-testid="conversation-panel-messages"]')) {
                return 'wa-chat';
            }

            return 'whatsapp'; // General fallback
        },

        // --- Corner Placement Config Per Section ---
        getPlatformConfig(path) {
            const section = this.getSection();

            if (section === 'wa-media-viewer' || section === 'wa-status') {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 16 };
            }
            if (section === 'wa-chat') {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 8 };
            }
            
            return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 12 };
        },

        // --- Modal Detection ---
        hasActiveModal() {
            const viewer = document.querySelector('[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"], [data-animate-status-v3="true"]');
            return viewer !== null && viewer.isConnected;
        },

        getActiveModal() {
            return document.querySelector('[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"], [data-animate-status-v3="true"]');
        },

        isInsideModal(media) {
            if (!media) return false;
            const modal = media.closest('[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"], [data-animate-status-v3="true"]');
            return modal !== null;
        },

        // --- Thumbnail / Eligibility Filter (per section) ---
        isThumbnail(media) {
            if (!media) return true;
            const tagName = media.tagName.toLowerCase();
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width || rect.width;
            const naturalH = media.naturalHeight || media.height || rect.height;

            const section = this.getSection();

            // Strict isolation: if modal is active, only allow media inside it
            if (this.hasActiveModal()) {
                if (!this.isInsideModal(media)) return true;
                
                // Exclude small ui elements inside the modal
                if (rect.width < 100 || rect.height < 100) return true;
                return false;
            }

            // Exclude circular contact list avatars (width < 60px, border-radius: 50%)
            if (rect.width < 60) {
                const style = window.getComputedStyle(media);
                if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius) > 20)) {
                    return true;
                }
            }

            // Exclude emojis, reactions, stickers
            if (media.src && media.src.includes('sticker')) return true;
            if (rect.width < 120 && rect.height < 120) return true;

            // Target valid post media in messages
            if (section === 'wa-chat') {
                const isMessageMedia = media.closest('div[role="row"]');
                if (isMessageMedia) {
                    if (rect.width < 120 || rect.height < 120) return true;
                    return false;
                }
            }

            if (rect.width < 120 || rect.height < 120) return true;
            return false;
        },

        // --- Button Scale Per Section ---
        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            
            if (minSide < 200) return 0.85;
            if (minSide < 300) return 0.9;
            return 1.0;
        },

        // --- Extraction Config ---
        useDirectDownload: false, // Always open in new tab
        useReactThumbnail: false, // Use DOM poster / blob extraction

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('web.whatsapp.com') || lower.includes('.whatsapp.net');
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            return false;
        },
        looksLikeReactImage(val, key) {
            return false;
        },
        looksLikeReactVideo(val, key) {
            return false;
        },
        extractPriorityReactUrl(val, isVideoContext) {
            return null;
        },
        filterBackgroundUrls(candidates, isVideo) {
            return candidates;
        },
        extractVideoUrlFromDOM(el) {
            if (el.tagName.toLowerCase() === 'video') {
                return el.currentSrc || el.src;
            }
            return null;
        }
    };

    window.ToystallerPlatforms['whatsapp'] = whatsappPlatform;
    window.ToystallerPlatform = whatsappPlatform;
    window.ToystallerActivePlatform = whatsappPlatform;
})();
