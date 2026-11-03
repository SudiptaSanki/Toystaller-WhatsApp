// extensions/whatsapp/content.js
// WhatsApp-specific content script entry point.
// Boots Toystaller with WhatsApp platform config and interceptor scripts.

// Boot immediately — manifest restricts this to web.whatsapp.com only
bootToystaller([
    'platform.js',              // Sets window.ToystallerPlatform in MAIN world
    'core/interceptor_core.js'  // Patches fetch/XHR and React Fiber extraction
]);
