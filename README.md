This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## KEPServerEX IoT Gateway

The bridge polls the KEPServerEX IoT Gateway REST Server and sends readings to
the application's existing data receiver. The default Gateway URL matches the
local endpoint shown in the KEPServerEX configuration:
`http://127.0.0.1:39320/iotgateway/`.

Configure the REST Server agent in KEPServerEX and make sure the PLC channel and
device are connected. Start the web app and the bridge in separate terminals on
a machine that can reach the Gateway:

```bash
npm run dev
```

```bash
npm run kepserver
```

For Line 3 only (without polling or sending data for Line 4), use:

```bash
npm run kepserver:line3
```

If only Line 3 and Line 4 are being polled, use the line-specific bridges in
separate terminals for a faster Line 4 update cycle instead of the all-lines
bridge:

```bash
npm run kepserver:line3
npm run kepserver:line4
```

The Line 4 bridge polls every 500 ms by default (`KEP_INTERVAL_LINE4_MS` can
override this, with a minimum of 250 ms). The Line 3 bridge keeps its existing
`KEP_INTERVAL_MS`/`OPC_INTERVAL_MS` cadence. Do not run these line-specific
bridges at the same time as `npm run kepserver`, because the all-lines bridge
would poll the same machines concurrently.
If a Gateway read fails, the Line 4 bridge retries on its next polling interval
instead of applying the exponential backoff used by Line 3.

The bridge reads active tags for every configured production line from the database and polls the Gateway
with one `ids` query parameter per tag, for example
`<KEPWARE_REST_URL>/read?ids=<tag-1>&ids=<tag-2>`. Set these optional settings
in `.env.local` to override the defaults:

```dotenv
KEPWARE_REST_URL=http://127.0.0.1:39320/iotgateway/
SIM_TARGET_URL=http://127.0.0.1:3000
KEP_INTERVAL_MS=1500
# Optional per-line fallback prefix when kepserver_tag is not stored:
# KEPWARE_TAG_PREFIX_LINE3=S7-1200PLC.MIXING LINE3.
# KEPWARE_TAG_PREFIX_LINE3DB=S7-1200PLC.MIXING_LINE3DB.
# Set to 0 to suppress the per-tag value log (summary logs remain enabled):
KEP_LOG_VALUES=1
# Optional Gateway credentials; leave both unset for anonymous Gateway access:
# KEPWARE_REST_USER=your-kepware-user
# KEPWARE_REST_PASSWORD=your-kepware-password
```

`127.0.0.1` points to the computer running the bridge. Use it for both URLs
when KEPServerEX and the web app run on that same computer. `SIM_TARGET_URL`
sets where the bridge posts readings; keep `APP_BASE_URL` set to the web app's
LAN address instead if Telegram alarm links must be opened from another device.
If KEPServerEX is on another computer, set `KEPWARE_REST_URL` to that computer's
reachable IP address and configure the REST Server to listen on its network
interface. Restrict remote access with the firewall.

When anonymous login is disabled in KEPServerEX, set the Gateway account
credentials in `KEPWARE_REST_USER` and `KEPWARE_REST_PASSWORD`. These settings
are separate from OPC credentials. Keep the Gateway bound to localhost unless
remote access is required; if the app/bridge runs on another host, use a
reachable Gateway URL and restrict access with the network firewall.

The receiver uses `DATA_RECEIVER_KEY` when configured, so the bridge reuses that
key automatically. A running KEPServerEX/IoT Gateway Windows service alone does
not confirm that the REST Server agent is listening. Enable and apply the REST
Server agent configuration, then verify the listener and read endpoint from
PowerShell before starting the bridge:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 39320
Invoke-RestMethod -Uri "http://127.0.0.1:39320/iotgateway/read?ids=S7-1200PLC.MIXING_LINE4.TT1001"
```

The read endpoint should return JSON containing `readResults`. If the port has
no listener, verify the REST Server agent is enabled and configured for port
39320; if it uses another port or path, update `KEPWARE_REST_URL` accordingly.
The bridge retries on the next polling cycle and reports actionable guidance
when a connection is refused.

To verify the two Line 4 tank valves against the PLC, read both exact REST item
IDs and confirm each result has good quality (`s: true` or `s: "Good"`):

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:39320/iotgateway/read?ids=S7-1200PLC.MIXING_LINE4.PDV9001&ids=S7-1200PLC.MIXING_LINE4.PDV1044"
```

The authenticated admin endpoint `/api/kepserver/status` also reports each
valve under `gateway.valveReadTests`. An open REST port or a cached value with
bad quality does not confirm a live PLC connection; verify the Kepware channel,
device, and PLC item quality when either valve is not GOOD.

The browser does not need a direct PLC connection. The data path is
KEPServerEX IoT Gateway → `npm run kepserver` bridge → web app data receiver →
PostgreSQL → dashboard/realtime stream. The bridge logs the count of good,
bad-quality cached, and empty/failed tag reads, the returned tag values, and
whether each receiver request succeeded. A non-empty value with bad KepServer
quality is forwarded with its `BAD` quality so the dashboard can show the last
cached value with a warning; an empty value is not written, preserving the last
stored reading. The dashboard marks old readings as stale instead of hiding
them. Restart `npm run kepserver` after updating the bridge.

The Line 4 `Filling Room` view is stricter: each sensor or valve is displayed as
unknown unless its own reading is GOOD and no older than 10 seconds. Stale,
invalid, BAD-quality, or missing values are not presented as current; sensor
values show a dash and valve indicators turn gray, with affected tags listed
above the SVG. `SSE tersambung` reports only the browser stream connection, not
the quality of the PLC tags. Leaving and reopening the tab reloads the latest
stored readings and opens a single new stream.

Line 4 numeric readings are not treated as calibrated when the configured
calibration CSV files cannot be loaded; the receiver marks them BAD rather than
presenting raw PLC counts as engineering values. Restore the verified
calibration files before expecting numeric Filling Room values to display.

### Adding the Line 3 tags

Review and apply `db\migrations\003_line3_sensor_parameters.sql` against the
same PostgreSQL database used by the app. It creates `line3/mixingL3` only when
that machine is absent and inserts the 18 documented sensor parameters without
deleting or changing Line 4 data. Then apply
`db\migrations\004_line3_kepserver_tags.sql`. The second migration repairs the
sensor REST IDs, adds the six documented alarm/protection parameters, and adds
all 90 documented PBV/DKV valve tags using the exact namespaces in
`REST_MIXING_L3 dan 4.csv`:

- Boolean tags: `S7-1200PLC.MIXING LINE3.<PLC address with dots replaced by underscores>`
- Float tags: `S7-1200PLC.MIXING_LINE3DB.DB2_<name>`

The source documentation lists `T1_Press_High_Alarm` at `M175.7` and
`T2_Press_High_Alarm` at `M175.6`; the REST export enables both corresponding
items. Their mappings are included in the Line 3 migrations.

The PLC address mapping in `Dokumentasi IoT - Line 3.tsv` must still be
configured and verified in KEPServerEX; this repository cannot safely infer the
Line 3 PLC IP or create the KEPServerEX agent automatically. If the configured
channel/device namespace differs, update the stored `kepserver_tag` values only
after verifying the result with the Gateway `browse` and `read` endpoints.
The KEPServer bridge polls every active Line 3 sensor, alarm/protection, and
PBV/DKV tag from those stored IDs and forwards fresh values to the same realtime
receiver used by the simulator. BAD-quality or stale valve readings are shown
as unavailable rather than retaining an old ON/OFF state.

Finally, apply `db\migrations\005_line3_remove_xv_valves.sql` to deactivate
any `XV` valve rows imported for Line 3; Line 3 does not have XV valves.
Apply `db\migrations\005_line3_remove_xv_valves.sql` and
`db\migrations\006_line3_correct_dkv_tags.sql` to deactivate the obsolete XV
valve and correct PBV 1 / DKV 1 mappings from the latest source, including
`PBV 1-01 = Q0_0`, `DKV 1-09 = Q12_2`, and `DKV 1-10 = Q12_3`, without
changing valve history or current states.
Apply `db\migrations\008_line3_correct_pressure_alarm_mapping.sql` to align
`T1_Press_High_Alarm` with documented address `M175.7` and
`T2_Press_High_Alarm` with `M175.6`. Both corresponding items are enabled in
the REST export. Apply `db\migrations\009_line3_disable_dummy_parameters.sql`
to deactivate the leftover `DUMMY.*` parameters so the bridge only polls
documented Line 3 monitoring tags. These migrations affect Line 3 only; no
Line 4 tags or data are changed.

Numeric parameter values for Line 4 are converted to engineering units by the
data receiver using the two HMI/KEPServer reference points in the four
`Data Monitoring Mixing - PAGE * LINE 4.csv` files. The slope and intercept are
calculated as `(Value 2 HMI - Value 1 HMI) / (Value 2 KEPServer - Value 1
KEPServer)` and `Value 1 HMI - slope * Value 1 KEPServer`, rounded to 7 and 4
decimal places to match the spreadsheet formula. Converted Line 4 values are
floored at zero. Duplicate tags are resolved by matching the CSV parameter
category to the database parameter type; this selects the temperature equation
for `TT1004`. `PT1003` has incomplete reference points and is left uncalibrated
rather than assigned a fabricated equation.

Line 3 deliberately bypasses the Line 4 calibration table: the numeric value
received from KEPServerEX is stored, streamed, and displayed unchanged. Line 3
history and latest-value queries also preserve the stored value, including
negative values. Line 4 retains its existing engineering-unit formatting and
zero-floor behavior.

If the four calibration CSV files are not present, the data receiver logs the
problem and stores incoming numeric values without calibration instead of
rejecting the entire batch. Its response identifies this state as
`calibration: "unavailable-raw-values"`; provide the CSV files to restore
engineering-unit conversion.

### Simulating Line 3 before KEPServerEX

After applying the Line 3 tag migrations, start the app with `npm run dev`, then
run `npm run sim` in another terminal. It sends readings only to the active
`line3/mixingL3` machine: 18 documented sensors, six alarm/protection signals,
and 90 PBV/DKV valves. The simulator validates that these active database tags
and their KEPServer IDs are present, reloads the configuration every 30 seconds,
and reports any tag the receiver does not accept.

The sensor values and valve sequence are demo data for checking the Line 3
dashboard, not verified PLC readings or the actual recipe/valve logic. Defaults
use the documented units and broad engineering ranges; when both `min_value`
and `max_value` are configured for a sensor, the simulator uses those limits.
The source documentation does not specify calibration ranges or valve
sequencing, so verify them against the machine before using live data.
`npm run sim:line4` remains available for the existing simulator; the Line 4
simulator implementation is unchanged.

## User accounts and access control

Authentication is disabled by default when running `npm run dev`, so the
dashboard opens directly in a local development trial. To re-enable login
locally, set `AUTH_ENABLED=true` in `.env.local` and restart the dev server.
Authentication is always enabled in production. While the local trial bypass
is active, account-management pages and APIs remain unavailable.

When authentication is enabled, the dashboard requires an account. Both `ADMIN` and `USER` accounts can read
monitoring screens, while only administrators can manage accounts. The server
checks access to user-management routes and protected monitoring APIs.

Before first use, inspect the target PostgreSQL database and apply
`db/migrations/001_auth_rbac.sql` with a database account permitted to create
the application tables. For example, from PowerShell:

```powershell
.\scripts\run-migration.cmd 001_auth_rbac.sql
```

The `.cmd` launcher works even when PowerShell execution policies block direct
`.ps1` execution. It runs the migration script with process-scoped
`-ExecutionPolicy Bypass`; no machine or user policy is changed. The runner
reads `DATABASE_URL` from `.env.local`, so an old `$env:DATABASE_URL` in the
current PowerShell session cannot silently select another user or database.
It also checks that the requested file is inside `db\migrations`.
Use the same runner for the remaining migrations:

```powershell
.\scripts\run-migration.cmd 002_user_production_line.sql
.\scripts\run-migration.cmd 003_line3_sensor_parameters.sql
.\scripts\run-migration.cmd 004_line3_kepserver_tags.sql
.\scripts\run-migration.cmd 005_line3_remove_xv_valves.sql
```

If PostgreSQL returns `password authentication failed`, update the password
inside `DATABASE_URL` in `.env.local`, or reset the PostgreSQL role password
with an administrator account. That error occurs before PostgreSQL reads the
SQL file and cannot be fixed by changing the migration itself.

The migration creates only `app_users`, `app_sessions`, `app_audit_logs`, and
`app_login_attempts`; it does not alter monitoring tables. Review the database
target and migration contents before applying them, especially in production.

For production-line access, also inspect and apply
`db/migrations/002_user_production_line.sql` after migration 001:

```powershell
.\scripts\run-migration.cmd 002_user_production_line.sql
```

This migration creates the active production-line list from existing
`machines.line_code` values and adds an optional line assignment to users.
Administrators can access every line; each `USER` account must be assigned one
active line from the user-management page. Existing users are not assigned
automatically, so assign a line to each `USER` before they use the dashboard.

To create the first administrator, securely provide these process environment
variables and run `npm run admin:create`:

```text
ADMIN_BOOTSTRAP_NAME
ADMIN_BOOTSTRAP_EMAIL
ADMIN_BOOTSTRAP_PASSWORD (12-128 characters)
```

The command refuses to create a bootstrap administrator when an active admin
already exists. Do not commit the values or place a production password in
source control. Sign in at `/login`; administrators can manage accounts from
the sidebar. No default administrator password is configured.

To list administrator names and emails without revealing password hashes, run
`npm run admin:list` from either CMD or PowerShell in the project directory.

Set a strong `DATA_RECEIVER_KEY` in production and configure the KEPServerEX
bridge with the same key. Production rejects data-receiver requests if the key
is missing. This integration credential is separate from user sessions and is
used only by the data receiver.

### Importing exported Line 4 tags and testing without a PLC

With PostgreSQL running and `DATABASE_URL` set in `.env.local`, import the
enabled tags from `REST_MIXING_L4.csv` or the combined export
`REST_MIXING_L3 dan L4.csv` into the existing Line 4 machine:

```bash
npm run import:kepserver-tags
```

The import is safe to rerun: it aligns active Line 4 tag names and KEPServer
IDs with the CSV, updates data types, and adds missing tags. Active Line 4 tags
not enabled in the CSV are deactivated so the bridge no longer polls them;
their database rows and historical readings are retained. The legacy `BLZ-02`
tag is corrected to `BZL-02` when it is the only matching row.

To exercise the web dashboard without a physical PLC or an available Gateway,
start the app and run the Line 4 database simulator in separate terminals:

```bash
npm run dev
```

```bash
npm run sim:m2
```

The simulator generates test readings for the configured Line 4 tags and sends
them through the same application receiver used by the KEPServer bridge. These
are simulated values, not readings from the PLC.

## Getting Started

### Menjalankan dari terminal VS Code di Windows

Workspace ini menggunakan Command Prompt sebagai terminal default VS Code agar
perintah `npm` tidak terhalang kebijakan eksekusi PowerShell. Setelah membuka
terminal baru di VS Code, jalankan dari folder project:

```cmd
npm install
npm run dev
```

Jika terminal PowerShell tetap digunakan, panggil launcher Windows secara
langsung:

```powershell
npm.cmd install
npm.cmd run dev
```

Perintah yang benar untuk memasang dependency adalah `npm install` (bukan
`npm intsall`). Buka http://localhost:3000 setelah server development berjalan.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
