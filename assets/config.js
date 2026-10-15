/**
 * The test survey's settings: the one file to edit.
 *
 * Nothing here is a secret. The v2 SDK carries no API key: it opens a session with `auth/init`, which checks the
 * page's origin against the agency's allowed domains (Integrations, in the dashboard), and signs every call after.
 */
(function (global) {
  'use strict';

  var config = {
    // The SurveyGuard API, as the respondent's browser reaches it. The SDK is loaded from here, and talks to it.
    backend: 'http://localhost:8001',

    // The agency's public id (agy_…): Settings in the dashboard.
    agency: 'agy_01a13d42a5657a6699b640c92d101e7b',

    // The project the survey page's own scans belong to (prj_…). Not the lobby link's project: see README.md.
    project: 'prj_01a13fa11b3c7fea8b80c2ca1513327d',

    // What the SDK does when it cannot get an answer: BLOCK, REVIEW or ALLOW. There is no default.
    failStrategy: 'REVIEW',

    /**
     * The suppliers sending respondents, keyed by the code they arrive with (`?src=` or `?source=`). Use the same
     * codes as the dashboard's Suppliers: the SDK sends the code as `sourceId`, and SurveyGuard attributes the scan,
     * and sends a decoyed respondent out through *its* record's security URL.
     *
     * - `ridParam`: the query parameter that carries the supplier's respondent id (`rid`, `psid`, `pid`, …).
     * - `redirects`: where each ending goes. `[RID]` is replaced with the respondent id (URL-encoded). A relative URL
     *   is read against this page. An ending with no URL stays on this survey's own end page.
     *     complete    finished the survey, and SurveyGuard let them through
     *     terminate   did not qualify (the screener)
     *     overquota   qualified, but their quota cell is full
     *     security    SurveyGuard screened them out (falls back to `terminate` when missing)
     *
     * The defaults point at `supplier.html`, a stand-in supplier that shows what it received.
     */
    suppliers: {
      'test': {
        name: 'Panel A',
        ridParam: 'rid',
        redirects: {
          complete: 'supplier.html?s=panel-a&status=complete&rid=[RID]',
          terminate: 'supplier.html?s=panel-a&status=terminate&rid=[RID]',
          overquota: 'supplier.html?s=panel-a&status=overquota&rid=[RID]',
          security: 'supplier.html?s=panel-a&status=security&rid=[RID]'
        }
      },
      'panel-b': {
        name: 'Panel B',
        ridParam: 'psid',
        redirects: {
          complete: 'supplier.html?s=panel-b&result=1&psid=[RID]',
          terminate: 'supplier.html?s=panel-b&result=2&psid=[RID]',
          overquota: 'supplier.html?s=panel-b&result=3&psid=[RID]',
          security: 'supplier.html?s=panel-b&result=4&psid=[RID]'
        }
      },
      social: {
        name: 'Open link (no respondent ids)',
        ridParam: 'rid',
        redirects: {}
      }
    },

    // The supplier of a respondent who arrives with no code. One who arrives with an unknown code is attributed to
    // that code, but is never sent to another supplier's URLs: they end on this survey's own page.
    defaultSupplier: 'social',

    // Quota cells that are full: a respondent who answers one of these to the screener is over quota.
    quotasFull: ['65 or older']
  };

  /*
   * The launch page's supplier editor saves its list in this browser's localStorage, and every page of the survey
   * then uses it instead of the one above. It reaches no other browser: to deploy a list, export it from the launch
   * page and paste it over `suppliers` above.
   */
  config.defaultSuppliers = config.suppliers;
  config.savedSuppliersKey = 'sg_test_suppliers';
  config.suppliersSaved = false;
  try {
    var saved = JSON.parse(global.localStorage.getItem(config.savedSuppliersKey) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      config.suppliers = saved;
      config.suppliersSaved = true;
    }
  } catch (e) {
    // No storage (a private window, blocked site data): the list above.
  }

  global.SG_CONFIG = config;
})(window);
