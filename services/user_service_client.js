// services/user_service_client.js
// Calls an external Users service to check if a user exists.

const DEFAULT_TIMEOUT_MS = 5000;
// Helper function to perform a fetch with a timeout limit
const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeoutId);
    }
};

// Checks if a user exists by calling the external User Service API
const userExistsRemote = async (userId) => {
    // Reading the service URL from the environment variables
    const baseUrl = process.env.USER_SERVICE_URL;
    if (!baseUrl) {
        throw new Error('USER_SERVICE_URL is not configured in .env');
    }
// Building the full URL for the exists check endpoint
    const url = `${baseUrl.replace(/\/$/, '')}/exists/${userId}`;

    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(
            `Users service error: HTTP ${response.status}. ${bodyText}`.trim()
        );
    }

    const data = await response.json();

    if (typeof data?.exists !== 'boolean') {
        throw new Error('Users service returned invalid response shape (expected { exists: boolean })');
    }

    return data.exists;
};

module.exports = {
    userExistsRemote
};
