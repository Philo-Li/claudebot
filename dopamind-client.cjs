/**
 * dopamind-client.cjs — HTTP polling client for Dopamind ↔ ClaudeBot Desktop.
 *
 * Polls GET /api/desktop-queue/poll every 3 seconds.
 * On message: calls callClaude() from shared claude-runner.js
 * Progress: buffers steps, flushes via POST /progress every 2 seconds
 * On complete: POST /respond with result
 *
 * Exports: start({ dopamindConfig }), stop()
 */

const https = require('https');
const http = require('http');
const url = require('url');

let pollTimer = null;
let running = false;
let claudeRunner = null; // dynamically imported ESM module

/**
 * Make an HTTP(S) request with JSON body
 */
function request(method, fullUrl, token, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
    };

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Poll for pending messages and process them
 */
async function pollOnce(config) {
  try {
    const pollUrl = `${config.apiUrl}/api/desktop-queue/poll?deviceId=${encodeURIComponent(config.deviceId)}&limit=1`;
    const res = await request('GET', pollUrl, config.token, null);

    if (res.status !== 200 || !res.data?.messages?.length) {
      return;
    }

    for (const msg of res.data.messages) {
      await processMessage(config, msg);
    }
  } catch (err) {
    console.error('[Dopamind] Poll error:', err.message);
  }
}

/**
 * Process a single queued message
 */
async function processMessage(config, msg) {
  console.log(`[Dopamind] Processing message ${msg.id}: ${msg.prompt.slice(0, 80)}...`);

  // Progress step buffer
  const progressSteps = [];
  let progressFlushTimer = null;
  let lastFlush = 0;

  const flushProgress = async () => {
    if (progressSteps.length === 0) return;
    const stepsToSend = progressSteps.splice(0, progressSteps.length);
    try {
      await request('POST', `${config.apiUrl}/api/desktop-queue/progress`, config.token, {
        messageId: msg.id,
        steps: stepsToSend,
      });
    } catch (err) {
      console.error('[Dopamind] Progress flush error:', err.message);
    }
    lastFlush = Date.now();
  };

  const onProgress = (text) => {
    progressSteps.push(text);
    const now = Date.now();
    if (now - lastFlush >= 2000) {
      flushProgress();
    } else if (!progressFlushTimer) {
      progressFlushTimer = setTimeout(() => {
        progressFlushTimer = null;
        flushProgress();
      }, 2000);
    }
  };

  try {
    // Ensure claude-runner is loaded
    if (!claudeRunner) {
      claudeRunner = await import('./claude-runner.js');
    }

    const sessionKey = `dopamind_${msg.userId}`;
    const workDir = msg.workDir || config.defaultWorkDir || process.cwd();

    const result = await claudeRunner.callClaude(sessionKey, msg.prompt, workDir, onProgress);

    // Final progress flush
    if (progressFlushTimer) {
      clearTimeout(progressFlushTimer);
      progressFlushTimer = null;
    }
    await flushProgress();

    // Submit result
    await request('POST', `${config.apiUrl}/api/desktop-queue/respond`, config.token, {
      messageId: msg.id,
      response: result.output,
      success: result.success,
      cost: result.cost || undefined,
    });

    console.log(`[Dopamind] Message ${msg.id} completed (success=${result.success})`);
  } catch (err) {
    console.error(`[Dopamind] Message ${msg.id} error:`, err.message);

    if (progressFlushTimer) {
      clearTimeout(progressFlushTimer);
      progressFlushTimer = null;
    }

    // Report error
    try {
      await request('POST', `${config.apiUrl}/api/desktop-queue/respond`, config.token, {
        messageId: msg.id,
        response: null,
        success: false,
        errorMessage: err.message,
      });
    } catch {}
  }
}

/**
 * Start polling loop
 */
async function start({ dopamindConfig }) {
  if (running) return;

  const { apiUrl, token, deviceId, defaultWorkDir } = dopamindConfig;

  if (!apiUrl || !token || !deviceId) {
    console.error('[Dopamind] Missing required config (apiUrl, token, deviceId)');
    return;
  }

  // Load claude-runner (ESM dynamic import)
  if (!claudeRunner) {
    claudeRunner = await import('./claude-runner.js');
  }

  running = true;
  const config = { apiUrl, token, deviceId, defaultWorkDir };

  console.log(`[Dopamind] Polling started (device: ${deviceId})`);
  console.log(`[Dopamind] API: ${apiUrl}`);

  const poll = async () => {
    if (!running) return;
    await pollOnce(config);
    if (running) {
      pollTimer = setTimeout(poll, 3000);
    }
  };

  // Start first poll
  poll();
}

/**
 * Stop polling
 */
function stop() {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[Dopamind] Polling stopped');
}

module.exports = { start, stop };
