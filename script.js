/**
 * Supplemental Charges – Netlify Forms (Vanilla JS)
 * =================================================
 * Drop-in form handler for Netlify-hosted HTML. Requirements:
 *
 * 1.  Validate full name + email (required, valid format)
 * 2.  Track optional charges + selected dates per option
 * 3.  Build JSON: { customer, options, summary, submittedAt }
 * 4.  Set JSON on hidden input name="application"
 * 5.  Submit via fetch POST to "/" with FormData(form)
 * 6.  Show confirmation section on success, hide form
 * 7.  Alert user on submission failure
 * 8.  Multiple per-option Flatpickr date ranges
 * 9.  Highlight Sep 13–17, 2026 (included nights) in all calendars
 * 10. Pre/Post nights: disable Sep 13–17 (cannot be selected)
 * 11. Enable Submit button only when form is valid
 * 12. Modular, commented, ready to drop into HTML
 *
 * HTML: form#order-form, input[name="application"], #full-name, #email,
 *       .option-checkbox (value=optionId), #date-input-{optionId}, #date-range-{optionId},
 *       #form-section, #confirmation-section, #submit-btn, #back-to-form
 * Deps: Flatpickr
 */

(function () {
  'use strict';

  // ==========================================================================
  // 1. CONSTANTS
  // ==========================================================================

  const OPTIONS = {
    companion: { id: 'companion', name: 'Companion rate', pricePerNight: 425 },
    'pre-post-night': { id: 'pre-post-night', name: 'Pre- or post-night', pricePerNight: 360 },
    'superior-room': { id: 'superior-room', name: 'Room upgrade – Superior Room', pricePerNight: 80 },
    'superior-terrace': { id: 'superior-terrace', name: 'Room upgrade – Superior Room with terrace', pricePerNight: 280 },
  };

  /** Option IDs that require a per-option Flatpickr date range */
  const PER_NIGHT_OPTION_IDS = ['companion', 'pre-post-night', 'superior-room', 'superior-terrace'];

  /** Included nights (Sep 13–17, 2026) – highlighted in calendar; blocked for pre/post-night */
  const INCLUDED_NIGHTS = {
    from: new Date(2026, 8, 13),
    to: new Date(2026, 8, 17),
  };

  const INCLUDED_NIGHT_DATES = [
    new Date(2026, 8, 13),
    new Date(2026, 8, 14),
    new Date(2026, 8, 15),
    new Date(2026, 8, 16),
    new Date(2026, 8, 17),
  ];

  const DEFAULT_CALENDAR_YEAR = 2026;
  const DEFAULT_CALENDAR_MONTH = 8; // 0-indexed = September

  // ==========================================================================
  // 2. DOM REFERENCES
  // ==========================================================================

  const form = document.getElementById('order-form');
  const formSection = document.getElementById('form-section');
  const confirmationSection = document.getElementById('confirmation-section');
  const summaryEmpty = document.getElementById('summary-empty');
  const summaryList = document.getElementById('summary-list');
  const summaryTotal = document.getElementById('summary-total');
  const fullNameInput = document.getElementById('full-name');
  const emailInput = document.getElementById('email');
  const fullNameError = document.getElementById('full-name-error');
  const emailError = document.getElementById('email-error');
  const backToFormBtn = document.getElementById('back-to-form');
  const applicationInput = form ? form.querySelector('input[name="application"]') : null;

  /** Per-option date ranges: optionId -> [fromDate, toDate] or null */
  let optionDateRanges = {};
  /** Per-option Flatpickr instances */
  let flatpickrInstances = {};

  // ==========================================================================
  // 3. HELPERS
  // ==========================================================================

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  }

  function countNights(from, to) {
    if (!from || !to || to < from) return 0;
    return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  }

  function isIncludedNight(d) {
    const t = d.getTime();
    return t >= INCLUDED_NIGHTS.from.getTime() && t <= INCLUDED_NIGHTS.to.getTime();
  }

  /**
   * Chargeable nights:
   * - Pre/post-night: only nights outside Sep 13–17
   * - Other options: all nights in range
   */
  function getChargeableNights(optionId, from, to) {
    if (!from || !to || to < from) return 0;
    if (optionId === 'pre-post-night') {
      let n = 0;
      const d = new Date(from);
      d.setHours(0, 0, 0, 0);
      const end = to.getTime();
      while (d.getTime() <= end) {
        if (!isIncludedNight(d)) n++;
        d.setDate(d.getDate() + 1);
      }
      return n;
    }
    return countNights(from, to);
  }

  // ==========================================================================
  // 4. VALIDATION – full name & email
  // ==========================================================================

  function isValidEmail(value) {
    if (!value || typeof value !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function updateSubmitButtonState() {
    const submitBtn = document.getElementById('submit-btn');
    if (!submitBtn) return;
    const name = fullNameInput.value.trim();
    const email = emailInput.value.trim();
    submitBtn.disabled = !(name && isValidEmail(email));
  }

  /** Validates name and email; returns true if valid, sets error messages otherwise */
  function validateForm() {
    const name = fullNameInput.value.trim();
    const email = emailInput.value.trim();
    let valid = true;

    fullNameError.textContent = '';
    fullNameInput.classList.remove('invalid');
    emailError.textContent = '';
    emailInput.classList.remove('invalid');

    if (!name) {
      fullNameError.textContent = 'Please enter your full name.';
      fullNameInput.classList.add('invalid');
      valid = false;
    }
    if (!email) {
      emailError.textContent = 'Please enter your email address.';
      emailInput.classList.add('invalid');
      valid = false;
    } else if (!isValidEmail(email)) {
      emailError.textContent = 'Please enter a valid email address.';
      emailInput.classList.add('invalid');
      valid = false;
    }

    return valid;
  }

  // ==========================================================================
  // 5. FLATPICKR – per-option date ranges
  // ==========================================================================

  function createFlatpickrForOption(optionId) {
    const input = document.getElementById('date-input-' + optionId);
    if (!input || flatpickrInstances[optionId]) return;

    const opts = {
      mode: 'range',
      dateFormat: 'Y-m-d',
      defaultDate: null,
      minDate: new Date(2026, 0, 1),
      maxDate: new Date(2026, 11, 31),
      allowInput: false,
      onChange: function (selectedDates) {
        optionDateRanges[optionId] = selectedDates.length === 2 ? selectedDates : null;
        updateOrderSummary();
      },
      onDayCreate: function (dObj, dStr, fp, dayElem) {
        if (dayElem.dateObj && isIncludedNight(dayElem.dateObj)) {
          dayElem.classList.add('includedNight');
          dayElem.title = 'Included nights (part of your trip)';
        }
      },
      onReady: function (selectedDates, dateStr, fp) {
        fp.changeYear(DEFAULT_CALENDAR_YEAR);
        fp.changeMonth(DEFAULT_CALENDAR_MONTH, false);
      },
    };

    if (optionId === 'pre-post-night') {
      opts.disable = INCLUDED_NIGHT_DATES;
    }

    flatpickrInstances[optionId] = flatpickr(input, opts);
  }

  function destroyFlatpickrForOption(optionId) {
    if (flatpickrInstances[optionId]) {
      flatpickrInstances[optionId].destroy();
      delete flatpickrInstances[optionId];
    }
    optionDateRanges[optionId] = null;
  }

  function getSelectedOptionIds() {
    const checkboxes = form.querySelectorAll('.option-checkbox:checked');
    return Array.from(checkboxes).map(function (cb) { return cb.value; });
  }

  function toggleOptionDateRange(optionId) {
    const container = document.getElementById('date-range-' + optionId);
    const checkbox = form.querySelector('.option-checkbox[value="' + optionId + '"]');
    if (!container || !checkbox) return;

    if (checkbox.checked) {
      container.hidden = false;
      createFlatpickrForOption(optionId);
    } else {
      container.hidden = true;
      destroyFlatpickrForOption(optionId);
    }
    updateOrderSummary();
  }

  // ==========================================================================
  // 6. LIVE ORDER SUMMARY
  // ==========================================================================

  function updateOrderSummary() {
    const optionIds = getSelectedOptionIds();

    if (optionIds.length === 0) {
      summaryEmpty.hidden = false;
      summaryList.hidden = true;
      summaryTotal.hidden = true;
      return;
    }

    summaryEmpty.hidden = true;
    summaryList.hidden = false;
    summaryList.innerHTML = '';

    let totalAmount = 0;
    let anyPerNightNeedsDates = false;

    optionIds.forEach(function (id) {
      const opt = OPTIONS[id];
      if (!opt) return;

      const range = optionDateRanges[id];
      const chargeableNights = opt.pricePerNight != null && range && range[0] && range[1]
        ? getChargeableNights(id, range[0], range[1])
        : (opt.pricePerNight != null ? 0 : 1);
      if (opt.pricePerNight != null && (!range || !range[0] || !range[1])) {
        anyPerNightNeedsDates = true;
      }
      const lineTotal = opt.pricePerNight != null ? opt.pricePerNight * chargeableNights : 0;
      totalAmount += lineTotal;

      const li = document.createElement('li');
      const nightsLabel = opt.pricePerNight != null
        ? (chargeableNights > 0 ? chargeableNights + ' night(s) · $' + lineTotal.toLocaleString() : 'Select dates')
        : '';
      li.innerHTML = '<span>' + escapeHtml(opt.name) + '</span><span class="nights">' + nightsLabel + '</span>';
      summaryList.appendChild(li);
    });

    summaryTotal.hidden = false;
    summaryTotal.textContent = 'Total: $' + totalAmount.toLocaleString() + ' USD';

    if (anyPerNightNeedsDates) {
      const hint = document.createElement('li');
      hint.className = 'summary-hint';
      hint.style.color = 'var(--color-text-muted)';
      hint.style.fontSize = '0.8125rem';
      hint.textContent = 'Select date range(s) above for per-night options.';
      summaryList.appendChild(hint);
    }
  }

  // ==========================================================================
  // 7. BUILD JSON OBJECT – for hidden "application" field
  // ==========================================================================

  /**
   * Builds application JSON:
   * { customer, options: [{ id, name, pricePerNight, dateFrom, dateTo, nights, total }], summary, submittedAt }
   */
  function buildApplicationObject() {
    const optionIds = getSelectedOptionIds();
    const options = optionIds.map(function (id) {
      const opt = OPTIONS[id];
      if (!opt) return null;
      const range = optionDateRanges[id];
      const nights = opt.pricePerNight != null && range && range[0] && range[1]
        ? getChargeableNights(id, range[0], range[1])
        : (opt.pricePerNight != null ? 0 : 1);
      const total = opt.pricePerNight != null ? opt.pricePerNight * nights : 0;
      return {
        id: opt.id,
        name: opt.name,
        pricePerNight: opt.pricePerNight ?? null,
        dateFrom: range && range[0] ? range[0].toISOString().slice(0, 10) : null,
        dateTo: range && range[1] ? range[1].toISOString().slice(0, 10) : null,
        nights: opt.pricePerNight != null ? nights : null,
        total: total,
      };
    }).filter(Boolean);

    const totalAmount = options.reduce(function (sum, o) { return sum + o.total; }, 0);

    return {
      id: generateId(),
      customer: {
        fullName: fullNameInput.value.trim(),
        email: emailInput.value.trim(),
      },
      options: options,
      summary: {
        totalAmount: totalAmount,
        currency: 'USD',
      },
      submittedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // 8. NETLIFY SUBMISSION & CONFIRMATION
  // ==========================================================================

  function showConfirmation() {
    formSection.hidden = true;
    confirmationSection.hidden = false;
  }

  /** POST form to Netlify via fetch; returns Promise */
  function submitToNetlify(formElement) {
    const formData = new FormData(formElement);
    const action = formElement.getAttribute('action') || '/';
    const url = action.startsWith('http') ? action : (window.location.origin + (action === '/' ? '' : action));

    return fetch(url, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'text/html' },
    });
  }

  function resetForm() {
    form.reset();
    if (applicationInput) applicationInput.value = '';
    fullNameError.textContent = '';
    emailError.textContent = '';
    fullNameInput.classList.remove('invalid');
    emailInput.classList.remove('invalid');
    PER_NIGHT_OPTION_IDS.forEach(function (id) {
      optionDateRanges[id] = null;
      destroyFlatpickrForOption(id);
      const container = document.getElementById('date-range-' + id);
      if (container) container.hidden = true;
    });
    updateOrderSummary();
    updateSubmitButtonState();
  }

  // ==========================================================================
  // 9. EVENT HANDLERS
  // ==========================================================================

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateForm()) return;

    const application = buildApplicationObject();
    if (applicationInput) {
      applicationInput.value = JSON.stringify(application);
    }

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }

    submitToNetlify(form)
      .then(function (response) {
        if (response.ok || response.redirected) {
          showConfirmation();
          resetForm();
        } else {
          alert('Something went wrong. Please try again or submit later.');
        }
      })
      .catch(function () {
        alert('Something went wrong. Please try again or submit later.');
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit request';
        }
      });
  });

  form.querySelectorAll('.option-checkbox').forEach(function (cb) {
    cb.addEventListener('change', function () {
      toggleOptionDateRange(cb.value);
    });
  });

  backToFormBtn.addEventListener('click', function () {
    confirmationSection.hidden = true;
    formSection.hidden = false;
    resetForm();
  });

  fullNameInput.addEventListener('input', function () {
    fullNameError.textContent = '';
    fullNameInput.classList.remove('invalid');
    updateSubmitButtonState();
  });
  emailInput.addEventListener('input', function () {
    emailError.textContent = '';
    emailInput.classList.remove('invalid');
    updateSubmitButtonState();
  });

  // ==========================================================================
  // 10. INIT
  // ==========================================================================

  PER_NIGHT_OPTION_IDS.forEach(function (id) {
    const container = document.getElementById('date-range-' + id);
    if (container) container.hidden = true;
  });
  updateOrderSummary();
  updateSubmitButtonState();
})();
