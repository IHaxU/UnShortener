(function() {
    "use strict";

    const DEBUG = false; // debug logging
    const oldLog = console.log;
    const oldWarn = console.warn;
    const oldError = console.error;
    function log(...args) { if (DEBUG) oldLog("[UnShortener]", ...args); }
    function warn(...args) { if (DEBUG) oldWarn("[UnShortener]", ...args); }
    function error(...args) { if (DEBUG) oldError("[UnShortener]", ...args); }

    if (DEBUG) console.clear = function() {}; // Disable console.clear to keep logs visible

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.bottom = "10px";
    container.style.left = "10px";
    container.style.zIndex = 999999;

    // Attach closed shadow root
    const shadow = container.attachShadow({ mode: "closed" });

    // Create your hint element
    const hint = document.createElement("div");
    hint.textContent = "🔒 Please solve the captcha to continue";

    Object.assign(hint.style, {
        background: "rgba(0,0,0,0.8)",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: "6px",
        fontSize: "14px",
        fontFamily: "sans-serif",
        pointerEvents: "none"
    });

    shadow.appendChild(hint);
    document.documentElement.appendChild(container);

    // Anti-anti ad-blocker
    const oldFetch = window.fetch;
    window.fetch = function (...args) {
        const url = args[0];
        log("Fetch called with arguments:", args);

        // Prevents ad-blocker checks, improving user experience and site performance
        if (url === "https://widgets.outbrain.com/outbrain.js") {
            warn("Blocked fetch for outbrain.js");
            return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
        }

        if (url.startsWith("https://hotjar.com?hash=")) {
            warn("Blocked fetch for hotjar.com");
            return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
        }

        return oldFetch.apply(this, args);
    }

    const adBlockCheckElementIds = ["AdHeader", "AdContainer", "AD_Top", "homead", "ad-lead"];
    const realGetElementById = document.getElementById;
    document.getElementById = function (id) {
        if (adBlockCheckElementIds.includes(id)) {
            const fake = document.createElement("div");
            
            Object.defineProperty(fake, "offsetHeight", { get: () => 1 });
            Object.defineProperty(fake, "offsetWidth", { get: () => 1 });
            
            return fake;
        }
        
        return realGetElementById.call(this, id);
    };

    Object.defineProperty(window, "optimize", {
        value: {},
        writable: false,
        configurable: false
    });

    // Global state
    let _sessionController = undefined;
    let _sendMessage = undefined;
    let _onLinkDestination = undefined;
    
    // Constants
    function getClientPacketTypes() {
        return {
            ANNOUNCE: "c_announce",
            MONETIZATION: "c_monetization",
            SOCIAL_STARTED: "c_social_started",
            RECAPTCHA_RESPONSE: "c_recaptcha_response",
            HCAPTCHA_RESPONSE: "c_hcaptcha_response",
            TURNSTILE_RESPONSE: "c_turnstile_response",
            ADBLOCKER_DETECTED: "c_adblocker_detected",
            FOCUS_LOST: "c_focus_lost",
            OFFERS_SKIPPED: "c_offers_skipped",
            FOCUS: "c_focus",
            WORKINK_PASS_AVAILABLE: "c_workink_pass_available",
            WORKINK_PASS_USE: "c_workink_pass_use",
            PING: "c_ping"
        };
    }

    function createSendMessageProxy() {
        const clientPacketTypes = getClientPacketTypes();

        return function(...args) {
            const packet_type = args[0];
            const packet_data = args[1];

            log("Sent message:", packet_type, packet_data);

            if (packet_type === clientPacketTypes.ADBLOCKER_DETECTED) {
                warn("Blocked adblocker detected message to avoid false positive.");
                return;
            }

            if (_sessionController.linkInfo && packet_type === clientPacketTypes.TURNSTILE_RESPONSE) {
                const ret = _sendMessage.apply(this, args);

                hint.textContent = "🎉 Captcha solved, redirecting...";

                // Send bypass messages
                _sendMessage.call(this, clientPacketTypes.MONETIZATION, {
                    type: "readArticles2",
                    payload: {
                        event: "read"
                    }
                });

                _sendMessage.call(this, clientPacketTypes.MONETIZATION, {
                    type: "betterdeals",
                    payload: {
                        event: "installed"
                    }
                });

                return ret;
            }

            return _sendMessage.apply(this, args);
        };
    }

    function createOnLinkDestinationProxy() {
        return function(...args) {
            const payload = args[0];

            log("Link destination received:", payload);

            window.location.href = payload.url;

            return _onLinkDestination.apply(this, args);
        };
    }

    function setupSessionControllerProxy() {
        _sendMessage = _sessionController.sendMessage;
        _onLinkDestination = _sessionController.onLinkDestination;

        const sendMessageProxy = createSendMessageProxy();
        const onLinkDestinationProxy = createOnLinkDestinationProxy();
        
        Object.defineProperty(_sessionController, "sendMessage", {
            get() { return sendMessageProxy },
            set(newValue) {
                _sendMessage = newValue
            }
        });

        Object.defineProperty(_sessionController, "onLinkDestination", {
            get() { return onLinkDestinationProxy },
            set(newValue) {
                _onLinkDestination = newValue
            }
        });

        log("SessionController proxies installed: sendMessage, onLinkDestination");
    }

    function checkForSessionController(target, prop, value, receiver) {
        if (value &&
            typeof value === "object" &&
            typeof value.sendMessage === "function" &&
            typeof value._onMessage === "function" &&
            typeof value.onLinkDestination === "function" &&
            !_sessionController
        ) {
            _sessionController = value;
            log("Intercepted session controller:", _sessionController);
            setupSessionControllerProxy();
        }

        return Reflect.set(target, prop, value, receiver);
    }

    function createComponentProxy(component) {
        return new Proxy(component, {
            construct(target, args) {
                const result = Reflect.construct(target, args);
                log("Intercepted SvelteKit component construction:", target, args, result);

                result.$$.ctx = new Proxy(result.$$.ctx, {
                    set: checkForSessionController
                });

                return result;
            }
        });
    }

    function createNodeResultProxy(result) {
        return new Proxy(result, {
            get(target, prop, receiver) {
                if (prop === "component") {
                    return createComponentProxy(target.component);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    function createNodeProxy(oldNode) {
        return async (...args) => {
            const result = await oldNode(...args);
            log("Intercepted SvelteKit node result:", result);
            return createNodeResultProxy(result);
        };
    }

    function createKitProxy(kit) {
      	if (typeof kit !== "object" || !kit) return [false, kit];

        const originalStart = "start" in kit && kit.start;
        if (!originalStart) return [false, kit];

        const kitProxy = new Proxy(kit, {
            get(target, prop, receiver) {
                if (prop === "start") {
                    return function(...args) {
                        const appModule = args[0];
                        const options = args[2];

                        if (typeof appModule === "object" &&
                            typeof appModule.nodes === "object" &&
                            typeof options === "object" &&
                            typeof options.node_ids === "object") {

                            const oldNode = appModule.nodes[options.node_ids[1]];
                            appModule.nodes[options.node_ids[1]] = createNodeProxy(oldNode);
                        }

                        log("kit.start intercepted!", options);
                        return originalStart.apply(this, args);
                    };
                }
                return Reflect.get(target, prop, receiver);
            }
        });

        return [true, kitProxy];
    }

    function setupSvelteKitInterception() {
        const originalPromiseAll = Promise.all;
        let intercepted = false;

        Promise.all = async function(promises) {
            const result = originalPromiseAll.call(this, promises);

            if (!intercepted) {
                intercepted = true;

                return await new Promise((resolve) => {
                    result.then(([kit, app, ...args]) => {
                        log("SvelteKit modules loaded");

                        const [success, wrappedKit] = createKitProxy(kit);
                        if (success) {
                            // Restore original Promise.all
                            Promise.all = originalPromiseAll;

                            log("Wrapped kit ready:", wrappedKit, app);
                        }

                        resolve([wrappedKit, app, ...args]);
                    });
                });
            }

            return await result;
        };
    }

    // Initialize the bypass
    setupSvelteKitInterception();

    // Remove injected ads
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                    // Direct match
                    if (node.classList?.contains("adsbygoogle")) {
                        node.remove();
                        log("Removed injected ad:", node);
                    }
                    // Or children inside the node
                    node.querySelectorAll?.(".adsbygoogle").forEach((el) => {
                        el.remove();
                        log("Removed nested ad:", el);
                    });
                }
            }
        }
    });

    // Start observing the document for changes
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
