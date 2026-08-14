# UI-independent login and upload modules

The desktop UI is only an adapter around two independent modules:

- `lib/auth.js` handles provider configuration, cookie-based session checks, logout cookie removal, account validation, and one-account-per-provider normalization.
- `lib/upload.js` handles route planning, due-job selection, provider adapter execution, progress/retry state, and returned comments.

Neither module imports Electron, the DOM, or the HTTP server. They can be tested directly with Node.js doubles:

```bash
npm run test:auth
npm run test:upload
npm run test:headless
npm test
```

The headless tests use a fake cookie session and fake provider adapters, so they do not open a window, require a browser login, or send a real SNS upload. Real provider credentials and browser sessions remain handled by the Electron bridge; the provider upload adapter boundary is `getProviderAdapter()` in `lib/providers.js`.
