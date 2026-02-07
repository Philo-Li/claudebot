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

let pollTimer = null;
let running = false;
let claudeRunner = null; // dynamically imported ESM module

/**
 * Make an HTTP(S) request with JSON body using fetch
 */
async function request(method, fullUrl, token, body) {
  const parsed = new URL(fullUrl);
  parsed.searchParams.set('token', token);

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(parsed.toString(), opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }

  if (!res.ok) {
    console.error(`[Dopamind] HTTP ${res.status} ${method} ${parsed.pathname}:`, data);
  }

  return { status: res.status, data };
}

/**
 * Poll for pending messages and process them
 */
async function pollOnce(config) {
  try {
    const pollUrl = `${config.apiUrl}/api/desktop-queue/poll?limit=1`;
    const res = await request('GET', pollUrl, config.token, null);

    if (res.status === 401) {
      const errMsg = res.data?.error?.message || 'Invalid device token';
      console.error(`[Dopamind] Auth failed: ${errMsg}`);
      stop();
      if (config.onError) config.onError(errMsg);
      return;
    }

    const messages = res.data?.messages || res.data?.data?.messages;
    if (res.status !== 200 || !messages?.length) {
      return;
    }

    for (const msg of messages) {
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
  console.log(`[Dopamind] Processing message ${msg.id} (conversationId=${msg.conversationId || 'none'}): ${msg.prompt.slice(0, 80)}...`);

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

    const sessionKey = msg.conversationId
      ? `dopamind_${msg.userId}_${msg.conversationId}`
      : `dopamind_${msg.userId}`;
    const workDir = msg.workDir || config.defaultWorkDir || process.cwd();

    const result = await claudeRunner.callClaude(sessionKey, msg.prompt, workDir, onProgress, {
      editDetails: true,
      allowSkipPermissions: config.allowSkipPermissions,
    });

    // Final progress flush
    if (progressFlushTimer) {
      clearTimeout(progressFlushTimer);
      progressFlushTimer = null;
    }
    await flushProgress();

    // Append usage suffix to response
    let response = result.output;
    if (result.success) {
      const usage = claudeRunner.getSessionUsage(sessionKey);
      if (usage && usage.contextWindow) {
        const remaining = (100 - usage.contextTokens / usage.contextWindow * 100).toFixed(0);
        response += `\n[context] ${remaining}% remaining`;
      }
    }

    // Submit result
    await request('POST', `${config.apiUrl}/api/desktop-queue/respond`, config.token, {
      messageId: msg.id,
      response,
      success: result.success,
      cost: result.cost || undefined,
      errorMessage: result.success ? undefined : result.output,
    });

    console.log(`[Dopamind] Message ${msg.id} completed (success=${result.success})${result.success ? '' : ' output=' + (result.output || '').slice(0, 200)}`);
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

  const { apiUrl, token, defaultWorkDir, allowSkipPermissions } = dopamindConfig;

  if (!apiUrl || !token) {
    console.error('[Dopamind] Missing required config (apiUrl, token)');
    return;
  }

  // Load claude-runner (ESM dynamic import)
  if (!claudeRunner) {
    claudeRunner = await import('./claude-runner.js');
  }

  running = true;
  const config = { apiUrl, token, defaultWorkDir, allowSkipPermissions, onError: dopamindConfig.onError };

  console.log(`[Dopamind] Polling started`);
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
