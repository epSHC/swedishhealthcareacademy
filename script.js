/**
 * Supplemental Charges – Trip Order
 * Vanilla JS: per-option date ranges (flatpickr), chargeable nights (Sep 13–17 excluded for pre/post),
 * validation, live summary. Submissions sent to Netlify Forms (no localStorage).
 * Application object is structured for backend/Stripe use and sent as JSON in hidden field.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  const OPTIONS = {
    companion: {
      id: 'companion',
      name: 'Companion rate',
      pricePerNight: 425,
    },
    'pre-post-night': {
      id: 'pre-post-night',
      name: 'Pre- or post-night',
      pricePerNight: 360,
    },
    'superior-room': {
      id: 'superior-room',
      name: 'Room upgrade – Superior Room',
      pricePerNight: 80,
    },
    'superior-terrace': {
      id: 'superior-terrace',
      name: 'Room upgrade – Superior Room with terrace',
      pricePerNight: 280,
    },
  };

  /** Option IDs that have a per-night rate and need a date range */
  const PER_NIGHT_OPTION_IDS = ['companion', 'pre-post-night', 'superior-room', 'superior-terrace'];

  /** Included nights (part of base trip) – highlighted in calendar; not selectable/chargeable for pre/post */
  const INCLUDED_NIGHTS = {
    from: new Date(2026, 8, 13),
    to: new Date(2026, 8, 17),
  };

  /** Calendar opens on September 2026 */
  const DEFAULT_CALENDAR_YEAR = 2026;
  const DEFAULT_CALENDAR_MONTH = 8; // 0-indexed (September)

  /** Sep 13–17 as discrete dates (for disabling in pre/post-night picker only) */
  const INCLUDED_NIGHT_DATES = [
    new Date(2026, 8, 13),
    new Date(2026, 8, 14),
    new Date(2026, 8, 15),
    new Date(2026, 8, 16),
    new Date(2026, 8, 17),
  ];

  // -------------------------------------------------------------------------
  // DOM references
  // -------------------------------------------------------------------------
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

  /** Hidden input that will carry the JSON application payload for Netlify */
  const applicationInput = form ? form.querySelector('input[name="application"]') : null;

  /** Per-option date range: optionId -> [fromDate, toDate] or null */
  let optionDateRanges = {};
  /** Per-option Flatpickr instances: optionId -> Flatpickr */
  let flatpickrInstances = {};

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  /**
   * Generate a unique ID for an application (included in JSON for reference).
   * @returns {string}
   */
  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  }

  /**
   * Count calendar nights between two dates (inclusive).
   */
  function countNights(from, to) {
    if (!from || !to || to < from) return 0;
    const ms = to.getTime() - from.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  }

  function formatDate(d) {
    if (!d || !(d instanceof Date)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isIncludedNight(d) {
    const t = d.getTime();
    return t >= INCLUDED_NIGHTS.from.getTime() && t <= INCLUDED_NIGHTS.to.getTime();
  }

  /**
   * Chargeable nights for an option. Sep 13–17 are included in the trip:
   * - Pre/post night: only nights OUTSIDE Sep 13–17 are chargeable.
   * - Other per-night options: all nights in the selected range are chargeable.
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

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  function isValidEmail(value) {
    if (!value || typeof value !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  /**
   * Update submit button disabled state based on name + email validity (UI only).
   */
  function updateSubmitButtonState() {
    const submitBtn = document.getElementById('submit-btn');
    if (!submitBtn) return;
    const name = fullNameInput.value.trim();
    const email = emailInput.value.trim();
    submitBtn.disabled = !(name && isValidEmail(email));
  }

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

  // -------------------------------------------------------------------------
  // Per-option date pickers (Flatpickr)
  // -------------------------------------------------------------------------

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
        const d = dayElem.dateObj;
        if (d && isIncludedNight(d)) {
          dayElem.classList.add('includedNight');
          dayElem.title = 'Included nights (part of your trip)';
        }
      },
      onReady: function (selectedDates, dateStr, fp) {
        // Open the calendar on September 2026 without pre-selecting dates
        fp.changeYear(DEFAULT_CALENDAR_YEAR);
        fp.changeMonth(DEFAULT_CALENDAR_MONTH, false); // false = absolute month (0-indexed), not offset
      },
    };

    // Pre/post-night only: disable Sep 13–17 so they cannot be selected (included in program).
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

  // -------------------------------------------------------------------------
  // Live order summary
  // -------------------------------------------------------------------------

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
        ? (chargeableNights > 0
            ? chargeableNights + ' night(s) · $' + lineTotal.toLocaleString()
            : 'Select dates')
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

  // -------------------------------------------------------------------------
  // Build application object (sent as JSON in hidden field to Netlify)
  // -------------------------------------------------------------------------

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
        nights: opt.pricePerNight != null ? nights : null,
        dateFrom: range && range[0] ? range[0].toISOString().slice(0, 10) : null,
        dateTo: range && range[1] ? range[1].toISOString().slice(0, 10) : null,
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

  // -------------------------------------------------------------------------
  // Submit to Netlify Forms and show confirmation
  // -------------------------------------------------------------------------

  function showConfirmation() {
    formSection.hidden = true;
    confirmationSection.hidden = false;
  }

  /**
   * Submit form via fetch so Netlify receives the POST; then show confirmation without navigating.
   */
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

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------
  PER_NIGHT_OPTION_IDS.forEach(function (id) {
    const container = document.getElementById('date-range-' + id);
    if (container) container.hidden = true;
  });
  updateOrderSummary();
  updateSubmitButtonState();
})();
