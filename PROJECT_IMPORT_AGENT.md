# Tindie Project Import Agent

This prototype implements the seller-side **Project → Product** workflow inside the current Tindie visual framework.

## Preview routes

- `/seller/import-project` — main seller import workflow
- `/import-project` — shortcut redirect
- `/` — shows the Import Agent automatically on standalone Vercel deployments that do not have the Resources database configured

## Implemented now

### 1. Connected Accounts

The Import Agent now has a Connected Sources layer before project selection.

GitHub supports:

- multiple connected GitHub accounts / organizations
- seller-selected repository access
- private repository browsing
- read-only access
- account avatar / installation identity
- account switching
- GitHub-side permission management
- Tindie-side disconnect
- automatic connection-health validation

The implementation uses a **GitHub App installation** instead of asking sellers to paste personal access tokens.

Long-lived GitHub repository tokens are not stored. Tindie stores only the installation identity and creates short-lived installation tokens on the server when repository access is needed.

### 2. Public GitHub fallback

A seller can still import any public GitHub repository without connecting an account. This is useful for public open-source projects and for testing the prototype.

### 3. Repository Browser

For a connected GitHub App installation, the Agent lists only repositories the seller granted to Tindie. It supports private repositories and search.

For public mode, the Agent lists public repositories for the entered GitHub username.

### 4. Project Import Agent

For GitHub projects the Agent reads repository metadata, README and the repository tree and detects:

- KiCad / schematic files
- PCB files
- BOM files
- Gerber files
- firmware
- STEP/STL/CAD files
- project images
- documentation
- likely MCU/FPGA families
- common interfaces such as USB-C, I2C, SPI, UART, CAN, Wi-Fi and Bluetooth

It then creates a Tindie-oriented listing draft with provenance and readiness metrics.

### 5. Project Source IR

Imported projects now receive a source identity structure before becoming a Tindie Listing IR. For connected GitHub projects it records the GitHub App connection identity so the same external project can later be linked and synchronized with a Tindie product.

### 6. Import History

The prototype keeps the most recent analyzed projects and generated drafts in browser local storage so the seller can leave and continue the workflow later.

The production database schema has also been added for:

- `external_connections`
- `external_projects`
- `project_import_sessions`
- `product_source_links`

The browser implementation is intentionally used for the standalone prototype because it does not yet share the production Tindie seller session/database.

### 7. Project URL import

Public URL import supports GitHub, Hackaday, Hackster, ezPLM, EETree and Instructables project pages. Repository import provides stronger engineering evidence than page-only import.

### 8. Seller confirmation

The Agent intentionally does **not** invent:

- price
- inventory
- ships-from location
- shipping profile
- handling time
- package weight
- certifications

These fields must be confirmed by the seller before the listing draft is generated.

### 9. Optional AI refinement

The Agent works without an LLM using deterministic repository analysis and listing heuristics. If `OPENAI_API_KEY` exists, listing copy is additionally refined using the OpenAI Responses API while keeping commercial facts seller-controlled.

## GitHub App setup

Create a GitHub App for Tindie with the minimum repository permissions:

- **Metadata: Read-only**
- **Contents: Read-only**

No repository write permission is required.

Set the GitHub App **Setup URL** to:

```text
https://YOUR_DOMAIN/api/project-import/connections/github/callback
```

Recommended settings:

- allow users to choose **All repositories** or **Only select repositories**
- do not request Issues, Pull Requests, Actions, Administration or repository write access
- the seller can manage repository selection later from GitHub's Installed GitHub Apps settings

Vercel environment variables:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=tindie-project-import
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
CONNECTION_SIGNING_SECRET=replace-with-a-random-string

# optional public API fallback / rate-limit headroom
GITHUB_TOKEN=github_pat_...

# optional AI refinement
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5

PROJECT_IMPORT_ALLOW_ANY_URL=false
```

`AUTH_SECRET` is used as the connection-cookie signing fallback when `CONNECTION_SIGNING_SECRET` is not provided.

## Connection security model

```text
Tindie Seller Browser
        │
        ▼
Connect GitHub
        │
        ▼
GitHub App installation screen
        │
Seller chooses repositories
        │
        ▼
Tindie setup callback
        │
        ▼
Signed installation reference
        │
        ▼
Short-lived installation access token
        │
        ▼
Read selected repository contents
```

The browser never receives the GitHub App private key or an installation access token.

## Current architecture

```text
Tindie Seller UI
      │
      ├── Connected Accounts
      │       └── GitHub App installations
      │
      ├── Public Project URL / Upload
      │
      ▼
Project Source IR
      │
      ▼
Project Import Agent
      │
      ├── source inspection
      ├── artifact scan
      ├── hardware extraction
      ├── evidence tracking
      └── optional LLM refinement
      │
      ▼
Tindie Listing IR / Draft
      │
      ▼
Seller commercial confirmation
      │
      ▼
Current Tindie List-a-Product structure
```

## Production persistence model

```text
Tindie Seller
     │
external_connections
     │
external_projects
     │
product_source_links ───── Tindie Product
     │
project_import_sessions
```

Run the new migration when enabling production persistence:

```bash
npm run db:migrate
```

## Remaining production integration

1. Bind `external_connections` and `project_import_sessions` to the real Tindie seller identity/session instead of the prototype browser cookie/local history.
2. Implement the Legacy Adapter that writes the generated Listing IR into the existing Django `List a Product` draft flow.
3. Replace prototype shipping choices with the seller's real Tindie shipping profiles.
4. Add direct provider auth/API connectors for Hackaday/Hackster where those platforms expose suitable APIs; URL import remains the fallback.
5. Add the ezPLM authenticated connector and project/BOM/version API.
6. Add sandboxed ZIP/KiCad/BOM parsing for direct uploads.
7. Add review-before-sync when a linked GitHub or ezPLM project changes or releases a new version.

