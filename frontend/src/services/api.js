import axios from 'axios';

export function createApiClient(baseURL) {
  const url = new URL(baseURL);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('VITE_API_URL must be a public HTTP(S) URL without credentials');
  }
  const listeners = new Set();
  const client = axios.create({
    baseURL: baseURL.replace(/\/$/, ''),
    withCredentials: true,
    timeout: 10000,
  });
  client.interceptors.request.use((config) => {
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
      config.headers.set('X-CSRF-Protection', '1');
    }
    return config;
  });
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401 && !error.config?.skipSessionInvalidation) {
        listeners.forEach((listener) => listener());
      }
      return Promise.reject(error);
    },
  );
  client.onUnauthorized = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return client;
}

const defaultURL = import.meta.env.PROD
  ? new URL('/api', window.location.origin).href
  : 'http://localhost:5000/api';
export const api = createApiClient(import.meta.env.VITE_API_URL || defaultURL);
