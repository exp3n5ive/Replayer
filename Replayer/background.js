// background.js

chrome.runtime.onInstalled.addListener(() => {
    // We create a generic context menu item.
    // Clicking this will primarily open/focus the DevTools panel.
    // It will then ask devtools.js to get the latest HAR entry as a fallback.
    chrome.contextMenus.create({
        id: "sendToReplayer",
        title: "Send to Replayer (Latest Request)", // Renamed title to clarify behavior
        contexts: ["all"], // Can be used on any element
        documentUrlPatterns: ["<all_urls>"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "sendToReplayer") {
        console.log("Context menu 'Send to Replayer' clicked.");

        // First, attempt to focus the DevTools Replayer panel
        chrome.runtime.sendMessage({ action: "focusReplayerPanel" }, (focusResponse) => {
            if (chrome.runtime.lastError) {
                console.warn("Could not send focus message to devtools_page:", chrome.runtime.lastError.message);
                console.log("Please ensure DevTools is open and the Replayer panel is active.");
                // If the panel isn't open, we can't get HAR entries via devtools_page.
                // In a real scenario, you might want to open DevTools programmatically,
                // but that's not directly supported by extension APIs for security.
                return;
            }

            // If focus message was successful, then ask devtools.js for the latest network request
            chrome.runtime.sendMessage({ action: "getSelectedNetworkRequest" }, async (requestResponse) => {
                if (chrome.runtime.lastError) {
                    console.error("Error asking devtools_page for request:", chrome.runtime.lastError.message);
                    return;
                }
                if (requestResponse && requestResponse.success && requestResponse.requestDetails) {
                    // Send the details received from devtools.js to panel.js
                    chrome.runtime.sendMessage({
                        action: "populateReplayer",
                        details: requestResponse.requestDetails
                    }, (populateResponse) => {
                        if (chrome.runtime.lastError) {
                            console.error("Error populating Replayer panel:", chrome.runtime.lastError.message);
                        } else if (populateResponse && populateResponse.success) {
                            console.log("Replayer panel populated with latest request.");
                        }
                    });
                } else {
                    console.error("Could not get latest network request details from devtools_page:", requestResponse?.message);
                }
            });
        });
    }
});