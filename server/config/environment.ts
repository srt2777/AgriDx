import dotenv from 'dotenv';
import path from 'node:path';
import { install, ProxyAgent, setGlobalDispatcher } from 'undici';

/** Keep environment loading ahead of provider construction and proxy detection. */
export function initializeEnvironment(): void {
  // Supported Node releases can bundle an older, vulnerable fetch implementation.
  // Install the locked, patched implementation and its matching Web API classes
  // before any server request. A ProxyAgent alone only replaces the dispatcher.
  // This startup module is not imported by the browser preview.
  install();
  // Existing process variables win; root .env then server/.env fill missing values.
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log('[server] proxy enabled (redacted)');
  }
}
