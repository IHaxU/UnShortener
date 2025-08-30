(function() {
    "use strict";

    const DEBUG = true; // debug logging
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

    // Global state
    let _sessionController = undefined;
    let _sendMsg = undefined;
    let _onLinkInfo = undefined;
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

    function createSendMsgProxy() {
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
                const ret = _sendMsg.apply(this, args);

                hint.textContent = "🎉 Captcha solved, redirecting...";

                // Send bypass messages
                for (const monetization of _sessionController.linkInfo.monetizations) {
                    switch (monetization) {
                        case 22: { // readArticles2
                            _sendMsg.call(this, clientPacketTypes.MONETIZATION, {
                                type: "readArticles2",
                                payload: {
                                    event: "read"
                                }
                            });
                            break;
                        }

                        case 45: { // pdfeditor
                            _sendMsg.call(this, clientPacketTypes.MONETIZATION, {
                                type: "pdfeditor",
                                payload: {
                                    event: "installed"
                                }
                            });
                            break;
                        }

                        case 57: { // betterdeals
                            _sendMsg.call(this, clientPacketTypes.MONETIZATION, {
                                type: "betterdeals",
                                payload: {
                                    event: "installed"
                                }
                            });
                            break;
                        }

                        default: {
                            log("Unknown monetization type:", typeof monetization, monetization);
                            break;
                        }
                    }
                }

                return ret;
            }

            return _sendMsg.apply(this, args);
        };
    }

    function createOnLinkInfoProxy() {
        return function(...args) {
            const linkInfo = args[0];

            log("Link info received:", linkInfo);

            Object.defineProperty(linkInfo, "isAdblockEnabled", {
                get() { return false },
                set(newValue) {
                    log("Attempted to set isAdblockEnabled to:", newValue);
                },
                configurable: false,
                enumerable: true
            });

            return _onLinkInfo.apply(this, args);
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
        _sendMsg = _sessionController.sendMsg;
        _onLinkInfo = _sessionController.onLinkInfo;
        _onLinkDestination = _sessionController.onLinkDestination;

        const sendMsgProxy = createSendMsgProxy();
        const onLinkInfoProxy = createOnLinkInfoProxy();
        const onLinkDestinationProxy = createOnLinkDestinationProxy();
        
        Object.defineProperty(_sessionController, "sendMsg", {
            get() { return sendMsgProxy },
            set(newValue) {
                _sendMsg = newValue
            },
            configurable: false,
            enumerable: true
        });

        Object.defineProperty(_sessionController, "onLinkInfo", {
            get() { return onLinkInfoProxy },
            set(newValue) {
                _onLinkInfo = newValue
            },
            configurable: false,
            enumerable: true
        });

        Object.defineProperty(_sessionController, "onLinkDestination", {
            get() { return onLinkDestinationProxy },
            set(newValue) {
                _onLinkDestination = newValue
            },
            configurable: false,
            enumerable: true
        });

        log("SessionController proxies installed: sendMsg, onLinkDestination");
    }

    function checkForSessionController(target, prop, value, receiver) {
        log("Checking property set:", prop, value);
        if (value &&
            typeof value === "object" &&
            typeof value.sendMsg === "function" &&
            typeof value.onLinkInfo === "function" &&
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
