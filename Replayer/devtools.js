// devtools.js

// Create the Replayer panel
let replayerPanel = null;
chrome.devtools.panels.create(
    "Replayer",
    "icon.png",
    "panel.html",
    function(panel) {
        console.log("Replayer panel created.");
        replayerPanel = panel; // Store reference to the panel for later use

        // Listen for when the panel becomes visible
        panel.onShown.addListener(() => {
            console.log("Replayer panel is shown.");
        });

        panel.onHidden.addListener(() => {
            console.log("Replayer panel is hidden.");
        });
    }
);

// Listener for messages from the background script
// The background script will now primarily ask to focus the panel or get the latest HAR entry.
// For getting the "selected" HAR entry, we will return the LATEST one.
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // Ensure the message is from our own extension's background script
    if (sender.id === chrome.runtime.id) {
        if (request.action === "getSelectedNetworkRequest") {
            // As discussed, there's no direct API for *selected* request.
            // We'll return the latest from HAR.
            chrome.devtools.network.getHAR(function(harLog) {
                if (harLog && harLog.entries && harLog.entries.length > 0) {
                    const latestEntry = harLog.entries[harLog.entries.length - 1];
                    // HAR entry has `request` and `response` objects.
                    // We need to get the response content asynchronously.
                    latestEntry.getContent((content) => {
                        const requestDetails = {
                            method: latestEntry.request.method,
                            url: latestEntry.request.url,
                            httpVersion: latestEntry.request.httpVersion,
                            requestHeaders: latestEntry.request.headers,
                            requestBody: latestEntry.request.postData,
                            responseStatus: latestEntry.response.status,
                            responseStatusText: latestEntry.response.statusText,
                            responseHttpVersion: latestEntry.response.httpVersion,
                            responseHeaders: latestEntry.response.headers,
                            responseContent: content,
                            responseMimeType: latestEntry.response.content.mimeType,
                            startedDateTime: latestEntry.startedDateTime // Pass timestamp for potential matching in panel.js
                        };
                        console.log("Responding to getSelectedNetworkRequest with latest HAR entry:", requestDetails);
                        sendResponse({ success: true, requestDetails: requestDetails });
                    });
                    return true; // Indicates that sendResponse will be called asynchronously
                } else {
                    console.warn("No HAR entries available in devtools_page.");
                    sendResponse({ success: false, message: "No network activity recorded." });
                }
            });
            return true; // Keep the message channel open for async sendResponse

        } else if (request.action === "focusReplayerPanel") {
            // Message from background.js to focus our panel
            if (replayerPanel) {
                replayerPanel.show(); // Attempt to show/focus the panel
                sendResponse({ success: true });
            } else {
                console.warn("Replayer panel not yet created or not accessible.");
                sendResponse({ success: false, message: "Panel not ready." });
            }
        }
    }
});