'use strict';
/**
 * PixelLab v2 REST client with an on-disk response cache.
 *
 * Every request body is hashed; a finished response is written to
 * `<cacheDir>/<endpoint>-<hash>.json`, so re-running the pipeline never
 * pays for the same generation twice. Asynchronous endpoints return a
 * background job id, which is polled until it completes.
 *
 * Auth: set PIXELLAB_API_TOKEN, or run where a proxy injects the token
 * for api.pixellab.ai (any placeholder value is sent then).
 * Node's fetch only honours HTTPS_PROXY with NODE_USE_ENV_PROXY=1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.PIXELLAB_BASE || 'https://api.pixellab.ai/v2';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class PixelLab {
  constructor({ cacheDir, token = process.env.PIXELLAB_API_TOKEN || 'proxy-injected', log = console.error } = {}) {
    this.cacheDir = cacheDir;
    this.token = token;
    this.log = log;
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  }

  async raw(method, endpoint, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(BASE + endpoint, {
          method,
          headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (err) {
        if (attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
        throw err;
      }
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 5) { this.log(`  ${endpoint}: HTTP ${res.status}, retrying`); await sleep(5000 * 2 ** attempt); continue; }
      }
      if (!res.ok) throw new Error(`${method} ${endpoint} → HTTP ${res.status}: ${text.slice(0, 800)}`);
      return JSON.parse(text);
    }
  }

  cachePath(endpoint, body) {
    if (!this.cacheDir) return null;
    const hash = crypto.createHash('sha256').update(endpoint + JSON.stringify(body)).digest('hex').slice(0, 24);
    return path.join(this.cacheDir, endpoint.replace(/\W+/g, '') + '-' + hash + '.json');
  }

  /** POST, following a background job to completion. Cached by request body. */
  async post(endpoint, body, { label = endpoint } = {}) {
    const file = this.cachePath(endpoint, body);
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const t0 = Date.now();
    let res = await this.raw('POST', endpoint, body);
    const jobId = res.background_job_id || (res.status === 'processing' && res.id);
    if (jobId) {
      this.log(`  ${label}: job ${jobId}`);
      for (;;) {
        await sleep(6000);
        const job = await this.raw('GET', '/background-jobs/' + jobId);
        if (job.status === 'completed') { res = job.last_response || {}; res.usage = job.usage; break; }
        if (job.status === 'failed') throw new Error(`${label}: job failed: ${JSON.stringify(job.last_response).slice(0, 800)}`);
      }
    }
    this.log(`  ${label}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (file) fs.writeFileSync(file, JSON.stringify(res));
    return res;
  }

  balance() { return this.raw('GET', '/balance'); }
}

function b64png(buf) { return { type: 'base64', base64: Buffer.from(buf).toString('base64'), format: 'png' }; }

module.exports = { PixelLab, b64png };
