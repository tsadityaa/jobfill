# 🧠 Personal Copilot

A secure personal application assistant Chrome Extension. Store your reusable information, automatically fill forms, and manage documents — all locally encrypted.

## Quick Start

```bash
# Install dependencies
npm install

# Start extension in dev mode (opens Chrome automatically)
cd extension
npm run dev
```

## Project Structure

```
personal-copilot/
├── extension/          # Chrome Extension (React + TypeScript + WXT)
│   ├── entrypoints/    # WXT entrypoints (popup, content script, background)
│   ├── components/     # React UI components
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utilities (storage, autofill engine)
│   └── test-pages/     # Test HTML pages for autofill testing
├── backend/            # (Phase 7) Node.js + Express API
└── shared/             # (Phase 7) Shared types and schemas
```

## Features

### Phase 1-2 (Current)
- ✅ Profile management (personal, contact, education, experience, professional)
- ✅ 3-layer autofill engine (HTML attributes → known dictionary → semantic)
- ✅ Sensitive field detection (won't auto-fill legal/consent questions)
- ✅ Test job application page

### Planned
- 🔒 Encrypted local vault (IndexedDB + Web Crypto API)
- 📄 Document processing (resize, crop, compress, convert)
- 🤖 AI Agent (natural language commands)
- ☁️ Cloud sync (encrypted)

## Tech Stack

- **Extension**: React, TypeScript, WXT (Vite), Tailwind CSS v4, Manifest V3
- **Storage**: chrome.storage.local (Phase 1) → IndexedDB + Web Crypto (Phase 3)
