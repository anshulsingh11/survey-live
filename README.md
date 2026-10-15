# Test survey (SDK and lobby, v2)

A small static survey that runs the v2 browser SDK the way an agency's own survey page would, plus a console for
sending respondents through the lobby. It is ported from the old repo's `survey-live/` and rewritten for v2's API.
It is not part of the product, the gate or the image: it is a hand-run test page.

| File | Role |
|---|---|
| `index.html`, `assets/survey.js` | The survey. Loads `/static/sdk/surveyguard.js` from the backend, asks for consent, screens, collects while the respondent answers, and on submit calls `collectAndSend({ choices, answers })`, then sends the respondent back to their supplier |
| `supplier.html` | A stand-in supplier: the page the default redirects land on. It shows the status and the respondent id it received, and (to the operator) what SurveyGuard said |
| `thanks.html` | The survey's own end page (`?end=complete`, `terminate`, `overquota`, `security`), for a respondent whose supplier gave no URL for that ending. On localhost, 127.0.0.1 or with `?sg_debug=1`, it shows the SDK's result and a link to the scan in the dashboard |
| `launch.html` | The console: the supplier editor, an entry link per supplier with a fresh respondent id, each supplier's target URL for a lobby link, and a pasted lobby link with a fresh `rid` and the lane overrides |
| `assets/config.js` | The file to edit: backend, agency, project, fail strategy, the full quota cells, and the default supplier list (the console's editor overrides it in one browser) |
| `assets/styles.css`, `vercel.json` | Styling; static hosting headers |

## What changed from the old survey

- **No API key in the page.** The SDK opens a session (`auth/init`) and signs every call after it. What lets a page in
  is its **origin**: the page's host must be on the agency's allowed domains.
- **The SDK never navigates.** `collectAndSend` resolves with an action (`PROCEED_TO_SURVEY`, `SUPPLIER_SCREENOUT`,
  `DECOY_SURVEY`), and `survey.js` acts on it. A challenge is the SDK's own overlay, before the promise resolves.
- **Consent is the survey's question.** The welcome screen asks; the SDK collects nothing until `grantConsent()`.
  Starting without ticking the box declines, and the submit is then `consent_declined`: nothing is analysed.
- **Answers are sent, closed and open apart:** the choices, the grid's rows and the score as `choices`, and the open
  question as `answers` (Phase 19). The old `trackGrid` is gone.
- **Lobby links are signed by the server.** The console cannot make one: generate it in the dashboard and paste it.
- **No metrics endpoint.** The dashboard's Scans and Lobby feed show every respondent.

## Suppliers and their endings

A respondent arrives from a supplier with its code and the supplier's respondent id:

```
index.html?src=panel-a&rid=A-1001        Panel A: its id in `rid`
index.html?src=panel-b&psid=B-77         Panel B: its id in `psid`
index.html?src=social                    an open link: no ids
```

The supplier list says, per code, which parameter holds the id (`ridParam`) and where each ending goes
(`redirects`, with `[RID]` filled in). The survey reads both once, on arrival, and the SDK sends the code as
`sourceId` and the id as `respondentId`.

**Edit the list on the console** (`launch.html` → *Suppliers*): add, change and remove suppliers, then *Save*. It is
checked first (a code used twice, a parameter that is not one, a URL that is not http(s)), and warns about an ending
URL with no `[RID]`. The saved list lives in **this browser's `localStorage`** (`sg_test_suppliers`): every page of
the survey uses it in this browser, and no other browser sees it. To give it to respondents elsewhere (a deployed
survey), *Export for config.js* and paste the result over `suppliers` in `assets/config.js`. *Reset to config.js*
forgets the saved list.

| Ending | When | Goes to |
|---|---|---|
| `terminate` | the screener: **Under 18**, or shops online **Never** | the supplier's terminate URL |
| `overquota` | the screener: an age in `quotasFull` (default **65 or older**) | the supplier's over-quota URL |
| `complete` | finished, and SurveyGuard's action is `PROCEED_TO_SURVEY` | the supplier's complete URL |
| `security` | finished, and SurveyGuard's action is `SUPPLIER_SCREENOUT` (a block, a failed challenge, or `BLOCK` as the fail strategy) | the supplier's security URL, else its terminate URL |
| (decoy) | finished, and the action is `DECOY_SURVEY` | the decoy; afterwards, the server sends them on (below) |

- **A screened-out respondent is not analysed.** The screener ends the survey before `collectAndSend`. The SDK
  session the consent opened stays an undecided scan: nothing is charged for it.
- **An ending with no URL stays on this survey** (`thanks.html`). So does every ending for a respondent with no code or
  an unknown one: they are attributed to the code they brought, and never sent to another supplier's URLs.
- **The decoy's exit is the server's, not the survey's.** For a survey-page scan it is the security URL (else the
  terminate URL) of the supplier SurveyGuard has on record for the code, with the respondent id filled in. With no
  such supplier the decoy ends on its own page. So register each supplier in the dashboard (*Suppliers*) with the
  same code and the same URLs as the survey's list, written out in full (`http://127.0.0.1:5500/supplier.html?…`).

Suppliers that sign their redirects (a hash of the id and a secret) need the signature computed by a server, which
this static survey does not have.

## Set it up locally

1. **Run the stack** (`docker compose up --build`). The backend serves the SDK at
   `http://localhost:8001/static/sdk/surveyguard.js`.
2. **Sign in to the dashboard** (`http://localhost:8001/dashboard/`) as an owner of the agency you will test with.
3. **Allow the survey's host.** *Integrations* → "Survey domains, one per line" → add `127.0.0.1`, save.
   - `localhost` is refused as a domain (it has no dot), so serve and open the survey on **127.0.0.1**. It is still a
     secure context, which the SDK needs (WebCrypto).
   - Listing a domain also restricts the agency's **lobby**: an entry whose `Referer` names another host is refused
     (a missing one is fine). An empty list leaves the lobby unrestricted.
4. **Make two projects** (*Projects*): one for the survey page, one for the lobby link. A respondent who comes through
   the lobby and then runs the SDK makes two scans of one device at one address. In one project, once the worker has
   recorded the first, the second is a **duplicate**, and `policy.device_duplicate` blocks it.
5. **Edit `assets/config.js`:** `agency` (the `agy_…` id, from *Settings*), `project` (the survey project's `prj_…`),
   `failStrategy`.
6. **Serve the folder:**

   ```bash
   cd examples/survey-live
   python -m http.server 5500 --bind 127.0.0.1
   ```

7. Open `http://127.0.0.1:5500/launch.html`.

### Through the lobby

In the dashboard, open the **lobby** project → *Links*, and generate one link per supplier:

- choose the supplier (its code goes on the link as `src`);
- target URL: the console's, for that supplier: `http://127.0.0.1:5500/index.html?src=panel-b&psid=[RID]`. The
  lobby puts the respondent id where `[RID]` is. It does not pass `src` on, which is why the target carries it;
- terminate URL: leave it empty, and a respondent the lobby blocks goes to the supplier's security URL (else its
  terminate URL).

Paste it into the console. Its lane buttons need `SG_LOBBY_TEST_OVERRIDES=true` on the backend; without it they route
naturally.

## What to expect

- **New agencies are in shadow mode** (ADR-010): every effective verdict is `ALLOW` and every action
  `PROCEED_TO_SURVEY`. The dashboard's scan detail shows the policy verdict, the one that would have been enforced.
  Switch shadow mode off in *Settings* to see screen-outs, challenges and the decoy.
- **An automated browser is a bot.** Playwright's Chromium sets `navigator.webdriver` and renders on SwiftShader. A
  headless run of this survey was a policy GHOST at 99. Test as a person in an ordinary browser.
- **From one browser, the lobby escalates:** yellow from the second entry, a block from the seventh (ADR-018).
- **A fresh install with no GeoLite file reviews everyone:** policy `REVIEW` instead of `ALLOW`.
- `failure: session_refused` on the thanks page means the page's host is not on the agency's allowed domains.

## Hosting it (Vercel or any static host)

There is no build step: deploy this folder as it is (on Vercel, root directory `examples/survey-live`, framework
*Other*). Then:

- `config.js`'s `backend` must be a **public https** address: an https page cannot load the SDK from
  `http://localhost`;
- add the host (`your-app.vercel.app`, or `*.vercel.app` for preview deploys) to the agency's allowed domains.
