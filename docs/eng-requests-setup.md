# ENG Requests — OneDrive Sync Setup

FloorSync's **ENG Requests** tab shows a live, read-only copy of Justin's
`ENG request list.xlsx` (OneDrive). The server pulls the file through
Microsoft Graph every 15 minutes (and on the tab's **Sync** button).
The Excel file stays the source of truth — nothing is ever written back.

## One-time Azure setup (~10 min, requires admin)

1. Go to **entra.microsoft.com** → **App registrations** → **New registration**
   - Name: `FloorSync ENG Sync`
   - Supported account types: *Accounts in this organizational directory only*
   - No redirect URI needed → **Register**
2. On the app's **Overview** page, note the **Application (client) ID** and
   **Directory (tenant) ID**.
3. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → search `Files.Read.All` → add it →
   click **Grant admin consent for H&L Manufacturing**.
4. **Certificates & secrets** → **New client secret** (24 months) →
   copy the **Value** immediately (it's only shown once).

## Configure the server

Pick ONE of these on the machine running the FloorSync server:

### Option A — environment variables
```
set MS_TENANT_ID=<tenant id>
set MS_CLIENT_ID=<client id>
set MS_CLIENT_SECRET=<secret value>
```
(For a permanent setup, set them as Windows *System* environment variables
via **System Properties → Environment Variables**, then restart the server.)

### Option B — config file
Create `graph-config.json` in the `server/` folder (next to the `db/` folder;
for the installed desktop app: `%APPDATA%\hl-floorsync\graph-config.json`):

```json
{
  "tenantId": "<tenant id>",
  "clientId": "<client id>",
  "clientSecret": "<secret value>"
}
```
> The file is gitignored — never commit the secret.

## Optional overrides

The spreadsheet's Graph identifiers are built in. If the file is ever moved
or replaced, override with env vars `ENG_DRIVE_ID` and `ENG_ITEM_ID`.

## Verify

1. Restart the server. The console should NOT print
   `[eng-sync] Graph credentials not configured`.
2. Open FloorSync → **ENG Requests** tab → click **Sync**.
   You should see Tech / Fab / Proto rows with G/Y/R status pills.
