document.addEventListener('DOMContentLoaded', () => {
    // Get references to DOM elements
    const loadRequestButton = document.getElementById('loadRequest'); // Now "Clear History" button
    const sendRequestButton = document.getElementById('sendRequest');
    const requestEditor = document.getElementById('requestEditor'); // The editable textarea
    const requestDisplay = document.getElementById('requestDisplay'); // The highlighted pre code block
    const responseFrame = document.getElementById('responseFrame');
    const responseDisplay = document.getElementById('responseDisplay');
    const requestHistoryList = document.getElementById('requestHistoryList'); // History list element
    const historySearchInput = document.getElementById('historySearchInput'); // Search input
    const body = document.body;

    // Variables to hold request data
    let currentRequestDetails = null;
    let requestsHistory = []; // Array to store all captured requests
    let selectedRequestIndex = -1; // Index of the currently selected request in history

    /**
     * Helper function to normalize HTTP version string.
     * Ensures it's '1.1' or '2.0' and correctly prefixed for display.
     * @param {string} versionStr The raw httpVersion string from HAR (e.g., 'HTTP/1.1', 'h2').
     * @returns {string} Normalized version string (e.g., '1.1', '2.0').
     */
    function normalizeHttpVersion(versionStr) {
        if (!versionStr) return '1.1'; // Default if null/undefined

        // Remove any 'HTTP/' prefix, then trim and convert to lowercase
        let cleanedVersion = versionStr.replace(/^HTTP\//i, '').trim().toLowerCase();

        // Standardize 'h2' to '2.0'
        if (cleanedVersion === 'h2') {
            return '2.0';
        }
        // Return as is for '1.1' or other unexpected but valid numbers
        return cleanedVersion || '1.1'; // Fallback if cleaned is empty
    }

    /**
     * Decodes various types of request bodies from the HAR format.
     * Attempts to pretty-print JSON.
     * @param {object} postData - The postData object from a HAR entry.
     * @returns {string} The decoded request body as a string.
     */
    function decodeRequestBody(postData) {
        if (!postData) return '';

        // Handle 'text' field (simple string body, common for JSON/text payloads)
        if (postData.text) {
            try {
                // Attempt to pretty-print JSON if it's valid JSON
                return JSON.stringify(JSON.parse(postData.text), null, 2);
            } catch (e) {
                return postData.text; // Not JSON, return as is
            }
        }

        // Handle 'raw' array (for binary or specific encodings)
        // Note: For editing, raw/binary data is represented as text. Actual binary handling would be complex.
        if (postData.raw && postData.raw.length > 0) {
            let decoded = '';
            postData.raw.forEach(part => {
                if (part.encoding === 'base64' && part.bytes) {
                    decoded += atob(part.bytes);
                } else if (part.bytes) {
                    try {
                        const bytesArray = Array.isArray(part.bytes) ? part.bytes : Object.values(part.bytes || {});
                        decoded += new TextDecoder().decode(new Uint8Array(bytesArray));
                    } catch (e) {
                        console.warn("Could not decode request body bytes directly:", e, part.bytes);
                        decoded += '[Binary Data]';
                    }
                } else if (part.text) {
                    decoded += part.text;
                }
            });
            try {
                return JSON.stringify(JSON.parse(decoded), null, 2);
            } catch (e) {
                return decoded;
            }
        }

        // Handle 'params' (form data)
        if (postData.params && postData.params.length > 0) {
            return postData.params.map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
        }

        return '';
    }

    /**
     * Formats the HTTP request for display as raw as possible, reflecting HAR.
     * @param {object} details - The request details object derived from a HAR entry.
     * @returns {string} The formatted HTTP request string.
     */
    function formatHttpRequest(details) {
        if (!details) return '';

        // Normalize HTTP version for display
        const displayHttpVersion = normalizeHttpVersion(details.httpVersion);

        // Request Line: METHOD URL HTTP/VERSION (e.g., GET https://example.com HTTP/2.0)
        // Use the exact URL and the normalized HTTP version.
        let requestText = `${details.method} ${details.url} HTTP/${displayHttpVersion}\n`;

        // Add all request headers exactly as they appear in HAR.
        if (details.requestHeaders) {
            details.requestHeaders.forEach(header => {
                requestText += `${header.name}: ${header.value}\n`;
            });
        }

        requestText += '\n'; // End of headers, separating from body

        // Append body if present
        const requestBodyText = decodeRequestBody(details.requestBody);
        if (requestBodyText) {
            requestText += requestBodyText;
        }

        return requestText;
    }

    /**
     * Parses a raw HTTP request string from the editor into an object suitable for fetch.
     * @param {string} rawText The raw HTTP request text from the editor.
     * @returns {object|null} Parsed request details or null if malformed.
     */
    function parseHttpRequest(rawText) {
        const lines = rawText.split('\n');
        if (lines.length < 1) return null;

        // 1. Parse Request Line (e.g., GET /path HTTP/1.1)
        // FIXED BUG: Removed extra '.' after lines[0]
        const requestLine = lines[0].trim();
        const parts = requestLine.match(/^(\S+)\s+(\S+)\s+(HTTP\/\S+)$/i);
        if (!parts) {
            console.error("Malformed request line:", requestLine);
            return null;
        }
        const method = parts[1].toUpperCase();
        const url = parts[2];
        const httpVersion = parts[3];

        // 2. Parse Headers
        const headers = [];
        let i = 1;
        while (i < lines.length && lines[i].trim() !== '') {
            const headerLine = lines[i].trim();
            const separatorIndex = headerLine.indexOf(':');
            if (separatorIndex === -1) {
                console.warn("Malformed header line (skipping):", headerLine);
                i++;
                continue;
            }
            const name = headerLine.substring(0, separatorIndex).trim();
            const value = headerLine.substring(separatorIndex + 1).trim();
            headers.push({ name: name, value: value });
            i++;
        }

        // Skip the empty line separating headers and body
        if (i < lines.length && lines[i].trim() === '') {
            i++;
        }

        // 3. Parse Body
        let bodyText = lines.slice(i).join('\n');
        let postData = null;

        if (bodyText) {
            // This is a simplified HAR postData structure for text-based bodies
            let mimeType = headers.find(h => h.name.toLowerCase() === 'content-type')?.value || 'text/plain';
            if (mimeType.includes(';')) { // remove charset etc.
                mimeType = mimeType.split(';')[0].trim();
            }

            postData = {
                mimeType: mimeType,
                text: bodyText
            };

            // If it looks like form data, try to parse params (for potential future use, fetch handles text directly)
            if (mimeType.includes('application/x-www-form-urlencoded')) {
                const params = [];
                bodyText.split('&').forEach(pair => {
                    const eqIndex = pair.indexOf('=');
                    if (eqIndex !== -1) {
                        params.push({
                            name: decodeURIComponent(pair.substring(0, eqIndex)),
                            value: decodeURIComponent(pair.substring(eqIndex + 1))
                        });
                    }
                });
                postData.params = params;
            }
            // If it looks like JSON, validate it
            else if (mimeType.includes('application/json')) {
                try {
                    JSON.parse(bodyText); // Just to validate if it's parseable JSON
                } catch (e) {
                    console.warn("Body claimed JSON but was not valid JSON upon parsing:", e);
                }
            }
            // For other types, it remains in 'text'
        }

        return {
            method: method,
            url: url,
            httpVersion: httpVersion,
            requestHeaders: headers,
            requestBody: postData // This simplified postData structure will be used by fetch bodyToSend logic
        };
    }

    /**
     * Formats the HTTP response for display as raw as possible, reflecting HAR.
     * @param {object} response - The response details object.
     * @returns {Promise<string>} A promise that resolves to the formatted HTTP response string.
     */
    async function formatHttpResponse(response) {
        // Normalize HTTP version for display
        const displayHttpVersion = normalizeHttpVersion(response.httpVersion);

        // Response Line: HTTP/VERSION STATUS STATUS_TEXT (e.g., HTTP/2.0 200 OK)
        // Use the normalized HTTP version.
        let responseText = `HTTP/${displayHttpVersion} ${response.status} ${response.statusText}\n`;

        // Add all response headers exactly as they appear in HAR.
        // Ensure headers is an array. Fetch API response headers can be an IterableIterator.
        const headersArray = Array.isArray(response.headers) ? response.headers : Array.from(response.headers.entries()).map(([name, value]) => ({ name, value }));
        headersArray.forEach(header => {
            responseText += `${header.name}: ${header.value}\n`;
        });
        responseText += '\n';

        // Append response body
        if (response.content) {
            try {
                // Attempt to pretty-print JSON if it's valid JSON
                responseText += JSON.stringify(JSON.parse(response.content), null, 2);
            } catch (e) {
                responseText += response.content; // Not JSON, return as is
            }
        } else {
            responseText += 'Could not retrieve response body.';
        }
        return responseText;
    }

    // --- View/Edit Mode Logic ---

    // Function to switch to edit mode
    function setEditMode(enable) {
        if (enable) {
            requestDisplay.style.display = 'none'; // Hide the highlighted view
            requestEditor.style.display = 'block'; // Show the textarea editor
            requestEditor.value = requestDisplay.textContent; // Copy content to editor
            requestEditor.focus(); // Focus the editor for typing
        } else {
            requestEditor.style.display = 'none'; // Hide the textarea editor
            requestDisplay.style.display = 'block'; // Show the highlighted view
            requestDisplay.textContent = requestEditor.value; // Copy content back to view
            Prism.highlightElement(requestDisplay); // Re-highlight the view
        }
    }

    // Event listener for clicking the highlighted display to switch to edit mode
    requestDisplay.addEventListener('click', () => {
        setEditMode(true);
    });

    // Event listener for blurring the editor to switch back to view mode
    requestEditor.addEventListener('blur', () => {
        setEditMode(false);
    });

    // --- Request History List Management ---

    /**
     * Renders the requestsHistory array into the #requestHistoryList UL, applying search filter.
     */
    function renderRequestHistory() {
        requestHistoryList.innerHTML = ''; // Clear existing list items
        const searchTerm = historySearchInput.value.toLowerCase(); // Get current search term

        // Filter requests based on search term
        const filteredRequests = requestsHistory.filter(req =>
            req.method.toLowerCase().includes(searchTerm) ||
            req.url.toLowerCase().includes(searchTerm) ||
            (req.requestBody && req.requestBody.text && req.requestBody.text.toLowerCase().includes(searchTerm)) ||
            (new Date(req.startedDateTime).toLocaleTimeString().toLowerCase().includes(searchTerm)) // Search by timestamp string too
        );

        if (filteredRequests.length === 0) {
            requestHistoryList.innerHTML = '<li class="placeholder">No matching requests.</li>';
            if (requestsHistory.length === 0) {
                requestHistoryList.innerHTML = '<li class="placeholder">No requests captured yet.</li><li class="placeholder">Refresh page or perform actions.</li>';
            }
            return;
        }

        filteredRequests.forEach((reqDetails, indexInFiltered) => {
            // Find the original index to correctly select from requestsHistory array
            // Using a simple identity check `req === reqDetails` might be brittle if objects are recreated.
            // It's better to use a unique identifier or a combination of properties for `findIndex`.
            // For now, given that `filteredRequests` elements are direct references from `requestsHistory`, `req === reqDetails` is fine.
            const originalIndex = requestsHistory.indexOf(reqDetails); // Find by reference

            const listItem = document.createElement('li');
            // Display full URL as requested
            listItem.textContent = `${reqDetails.method} ${reqDetails.url}`;
            listItem.title = `Time: ${new Date(reqDetails.startedDateTime).toLocaleTimeString()} - ${reqDetails.method} ${reqDetails.url}`; // More comprehensive title
            listItem.dataset.originalIndex = originalIndex; // Store original index

            if (originalIndex === selectedRequestIndex) {
                listItem.classList.add('selected');
            }

            listItem.addEventListener('click', () => {
                selectRequestFromHistory(originalIndex); // Select using original index
            });
            requestHistoryList.appendChild(listItem);
        });
        // Scroll to the latest selected item (if one is selected and list grows/filters)
        if (selectedRequestIndex !== -1) {
            const selectedLi = requestHistoryList.querySelector(`li[data-original-index="${selectedRequestIndex}"]`);
            if (selectedLi) {
                selectedLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    /**
     * Loads a specific request from history into the editor/display.
     * @param {number} index The index of the request in the requestsHistory array.
     */
    function selectRequestFromHistory(index) {
        if (index < 0 || index >= requestsHistory.length) {
            console.error("Invalid request history index:", index);
            return;
        }

        // Update selected state in UI across all rendered items (even if filtered)
        // Remove 'selected' from previously selected item if it exists
        const prevSelected = requestHistoryList.querySelector(`li.selected`);
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }

        selectedRequestIndex = index; // Update the globally selected index

        // Add 'selected' to the newly selected item (if it's currently visible in the filtered list)
        const newSelectedLi = requestHistoryList.querySelector(`li[data-original-index="${selectedRequestIndex}"]`);
        if (newSelectedLi) {
            newSelectedLi.classList.add('selected');
        }


        currentRequestDetails = requestsHistory[index]; // Set the current request
        const formattedRequest = formatHttpRequest(currentRequestDetails);
        requestEditor.value = formattedRequest;
        requestDisplay.textContent = formattedRequest;
        Prism.highlightElement(requestDisplay);
        setEditMode(false); // Always switch to view mode after loading
        console.log(`Loaded request from history (original index ${index}).`);

        // Clear previous response when loading a new request
        responseDisplay.textContent = '';
        responseFrame.srcdoc = '';
        responseFrame.style.display = 'none';
    }


    // --- Other Event Listeners ---

    // Listen for network requests and add them to our history.
    chrome.devtools.network.onRequestFinished.addListener(async (request) => {
        // Filter out non-HTTP/HTTPS requests
        try {
            const urlObj = new URL(request.request.url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                return;
            }
        } catch (e) {
            // Handle cases where request.request.url might be malformed or not a valid URL
            console.warn("Skipping request due to invalid URL:", request.request.url, e);
            return;
        }


        try {
            const content = await new Promise(resolve => {
                // IMPORTANT: request.getContent can sometimes fail if the request was cancelled or too quick.
                // It's good practice to handle this gracefully. If content is null, just use an empty string.
                request.getContent((body, encoding) => {
                    if (encoding === 'base64') {
                        try {
                            resolve(atob(body)); // Decode base64 if specified
                        } catch (e) {
                            console.warn("Base64 decode failed for response content:", e);
                            resolve("[Failed to decode base64 content]");
                        }
                    } else {
                        resolve(body || ''); // Use empty string if body is null/undefined
                    }
                });
            });

            // Create a simplified object suitable for storage and replay
            const capturedDetails = {
                method: request.request.method,
                url: request.request.url,
                httpVersion: request.request.httpVersion,
                requestHeaders: request.request.headers,
                requestBody: request.request.postData, // HAR postData object
                responseStatus: request.response.status,
                responseStatusText: request.response.statusText,
                responseHttpVersion: request.response.httpVersion,
                responseHeaders: request.response.headers,
                responseContent: content, // Raw response content string
                responseMimeType: request.response.content.mimeType,
                startedDateTime: request.startedDateTime // Useful for display and sorting
            };
            requestsHistory.unshift(capturedDetails); // Add to the beginning of the array (most recent first)
            // Removed the limit (requestsHistory.length > 500) to record all requests.
            renderRequestHistory(); // Update the displayed list
            console.log("Captured network request and added to history.");
        } catch (e) {
            console.error("Error capturing request content from HAR:", e);
        }
    });

    // "Clear History" button click listener
    loadRequestButton.addEventListener('click', () => {
        requestsHistory = []; // Clear the history array
        selectedRequestIndex = -1; // Reset selection
        historySearchInput.value = ''; // Clear search input
        renderRequestHistory(); // Re-render to show placeholder
        // Clear main request/response panes
        requestEditor.value = '';
        requestDisplay.textContent = 'No request loaded.';
        Prism.highlightElement(requestDisplay);
        setEditMode(false);
        responseDisplay.textContent = '';
        responseFrame.srcdoc = '';
        responseFrame.style.display = 'none';
        console.log("Request history cleared.");
    });

    // Event listener for search input
    historySearchInput.addEventListener('input', () => {
        renderRequestHistory(); // Re-render history list with filter
    });


    // Send the current request when the "Send" button is clicked.
    sendRequestButton.addEventListener('click', async () => {
        // Ensure we read from the editor, as that's where user makes changes
        const rawRequestText = requestEditor.value;
        if (!rawRequestText.trim()) {
            responseDisplay.textContent = 'Request editor is empty. Please load or paste a request.';
            responseFrame.style.display = 'none';
            return;
        }

        // Before sending, ensure the view is updated and highlighted (in case user clicks send while in edit mode)
        setEditMode(false);

        // Parse the edited request from the editor content
        const parsedRequest = parseHttpRequest(rawRequestText);

        if (!parsedRequest) {
            responseDisplay.textContent = 'Failed to parse request from editor. Please ensure it follows the "Method URL HTTP/Version\\nHeaders\\n\\nBody" format.';
            console.error("Failed to parse edited request:", rawRequestText);
            responseFrame.style.display = 'none';
            return;
        }

        const { method, url, requestHeaders, requestBody } = parsedRequest;
        const headers = new Headers(); // Use Headers object for fetch
        let bodyToSend = undefined;

        // Populate headers for fetch, filtering out pseudo-headers and 'Host'
        requestHeaders.forEach(header => {
            const lowerCaseName = header.name.toLowerCase();
            // Filter out HTTP/2 pseudo-headers (e.g., :method, :path) and 'host' as fetch handles URL and doesn't allow pseudo-headers
            if (!lowerCaseName.startsWith(':') && lowerCaseName !== 'host') {
                headers.append(header.name, header.value);
            }
        });

        // Prepare body based on parsed requestBody
        if (requestBody && requestBody.text) {
            bodyToSend = requestBody.text;
        }
        // Note: For complex binary bodies or FormData, this simple text-based editing would need enhancement.

        const fetchOptions = {
            method: method,
            headers: headers, // Pass Headers object
            body: bodyToSend
        };

        try {
            responseDisplay.textContent = 'Sending request...';
            responseFrame.style.display = 'none';
            responseFrame.srcdoc = ''; // Clear iframe content

            const response = await fetch(url, fetchOptions);

            const responseHeadersArray = [];
            response.headers.forEach((value, name) => {
                responseHeadersArray.push({ name, value });
            });

            const responseContentText = await response.text();

            // The HTTP version from the *actual response* object from fetch is not directly exposed.
            // Default to 1.1 or use the original capture's responseHttpVersion if available for display.
            const fullResponseDetails = {
                httpVersion: currentRequestDetails?.responseHttpVersion || '1.1', // Use original if available, else default
                status: response.status,
                statusText: response.statusText,
                headers: responseHeadersArray,
                content: responseContentText,
                mimeType: response.headers.get('Content-Type') || 'text/plain'
            };

            const responseFormatted = await formatHttpResponse(fullResponseDetails);

            const contentType = fullResponseDetails.mimeType;

            if (contentType && contentType.includes('text/html')) {
                responseFrame.srcdoc = fullResponseDetails.content;
                responseFrame.style.display = 'block';
                responseDisplay.textContent = `HTML response rendered in iframe.\n\n${responseFormatted}`; // Show formatted text alongside iframe
            } else {
                responseDisplay.textContent = responseFormatted;
                responseFrame.style.display = 'none';
            }
            Prism.highlightElement(responseDisplay); // Highlight the response display

        } catch (error) {
            responseDisplay.textContent = `Error sending request: ${error.message}\n\nCheck console for details. Make sure the URL is valid and the request format is correct. CORS might also be an issue for cross-origin requests.`;
            console.error("Error sending request:", error);
            responseFrame.style.display = 'none';
        }
    });

    // Listen for messages from background.js (e.g., from the context menu "Send to Replayer").
    // This will now focus the panel and potentially load the LATEST HTTP/HTTPS request.
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Ensure message is from our own extension's background script
        if (sender.id === chrome.runtime.id) {
            if (request.action === "populateReplayer" && request.details) {
                // Before populating, apply the same filter
                try {
                    const urlObj = new URL(request.details.url);
                    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                        console.warn(`Skipping populate for non-HTTP(S) request from background: ${request.details.url}`);
                        sendResponse({ success: false, message: "Only HTTP/HTTPS requests can be populated." });
                        return;
                    }
                } catch (e) {
                    console.warn("Skipping populate from background due to invalid URL:", request.details.url, e);
                    sendResponse({ success: false, message: "Invalid URL provided." });
                    return;
                }


                currentRequestDetails = request.details;
                const formattedRequest = formatHttpRequest(currentRequestDetails);
                requestEditor.value = formattedRequest;
                requestDisplay.textContent = formattedRequest;
                Prism.highlightElement(requestDisplay);
                setEditMode(false); // Ensure view mode after populating
                // Also, clear response panel when a new request is loaded this way
                responseDisplay.textContent = '';
                responseFrame.srcdoc = '';
                responseFrame.style.display = 'none';

                // Try to highlight in history if this request matches one
                const indexToSelect = requestsHistory.findIndex(req =>
                    req.url === request.details.url && req.method === request.details.method &&
                    req.startedDateTime === request.details.startedDateTime); // Use timestamp for better match
                if (indexToSelect !== -1) {
                    // Update selection and re-render only if the found item is currently visible
                    selectedRequestIndex = indexToSelect; // Update selection
                    renderRequestHistory(); // Re-render to highlight
                }


                console.log("Replayer panel populated from background message.");
                sendResponse({ success: true });
                return true; // Keep message channel open for async response
            }
        }
    });

    // --- Theme Detection ---

    // Detect system theme changes (light/dark mode) and apply to the body.
    function updateTheme() {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            body.classList.add('dark-mode');
        } else {
            body.classList.remove('dark-mode');
        }
    }

    // Initial theme setup
    updateTheme();
    // Listen for future theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);

    // Initial highlighting of the display (when panel first loads)
    // Only highlight if there's content to highlight
    if (requestDisplay.textContent.trim()) {
        Prism.highlightElement(requestDisplay);
    }

    // Initial render of history list (will show placeholders)
    renderRequestHistory();
});