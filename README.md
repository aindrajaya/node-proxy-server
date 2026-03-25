# 🚀 TMAT Auth Proxy Service

High-performance, secure NodeJS Authentication Proxy Server utilizing the `Fastify` engine, explicitly developed to securely transmit dynamic credentials connecting the TMAT React Monitoring Dashboard and the production upstream `portal_v1` backend endpoints.

## Features
- **Dynamic Credentials Mappings**: Synchronizes native `X-API-KEY` header injection replacing exposed statically compiled tokens.
- **Strict Role-Based Scopes**: Implements parameter interceptions, guaranteeing query bounds preventing cross-environment probing seamlessly.
- **Robust Security Constructs**: 
  - JWT tokens rendered identically inside browser `HttpOnly` configurations preventing XSS exploitation natively.
  - Revocations natively mirrored utilizing lightning-fast distributed Redis blocklists.
  - Implements brute-force protection, native Pino sensitive variable redaction, strict HSTS CORS validation structures.

---

## 💻 Running Locally

### 1. Prerequisites
- **Node.js** (v18+)
- **MySQL** Running & configured matching the upstream credentials layouts.
- **Redis** Running locally (e.g. `localhost:6379`)

### 2. Setup Variables
Copy `.env.example` mapping out the local setups assigning database and caching resources accordingly:
```bash
cp .env.example .env
```

Review the configurations:
```env
PORT=4000
NODE_ENV=development
JWT_SECRET=super_secret_for_development_replace_in_prod  # Choose a secure hash!
COOKIE_NAME=tmat_session
COOKIE_SECURE=false # Set to true on production HTTPS scopes
ALLOWED_ORIGINS=http://localhost:5173 # Your React Dashboard Domain URL
BACKEND_BASE_URL=https://service.server.com/backoffice/api/v1
```

### 3. Install & Start Development Server
```bash
# Pull dependencies gracefully
npm install

# Run the dev server instances utilizing watch mode
npm run dev
```

The server should successfully launch answering endpoints along `http://localhost:4000`.

---

## 🔗 Frontend App Integration

Integrating the Fastify Proxy inside your React Application (`tmat-monitoring-dashboard`) is natively streamlined avoiding `localStorage` vulnerabilities safely:

### 1. Set VITE Variables
Locate your `.env` frontend configurations securely pointing towards the local Fastify instance routing proxy:
```env
VITE_API_MODE=dev
VITE_DEV_API_URL=http://localhost:4000/proxy
VITE_PROD_API_URL=https://proxy.yourdomain.com/proxy
```

### 2. Client Adjustments Overview
The `apiClient.ts` native definitions automatically fetch `VITE_DEV_API_URL`. Ensure any `fetch()` actions natively carry credentials mapping:
```typescript
const response = await fetch(`${baseUrl}/endpoint`, {
    credentials: 'include' // THIS is imperative transmitting the HttpOnly JWT Cookies safely.
});
```

### 3. Logging-In
Executing `AuthContext.tsx` bindings calling `POST /auth/login` via absolute backend URLs returns the session cookies directly natively authenticating queries across subsequent HTTP proxies.

```typescript
const { login } = useAuth();
// Resolves securely fetching MySQL configurations minting Cookies immediately.
await login("user@nouser.mail", "password_123"); 
```

No tokens are written onto native client memories explicitly hardening React environments reliably.

---

## 🛠️ Production Ready Commands

When deploying onto execution infrastructures, compile the TypeScript configurations matching PM2 Ecosystem parameters gracefully shutting instances.

```bash
# Compiles strict Typescript modules towards /dist output
npm run build 

# Launches PM2 clustering bindings natively matching machine CPUs
pm2 start ecosystem.config.js
```
