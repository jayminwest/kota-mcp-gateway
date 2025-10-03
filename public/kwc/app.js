/* eslint-env browser */
/* global document, fetch, FormData, console */

const API_BASE = '/kwc/api';

const lineupForm = document.getElementById('lineup-form');
const lineupRows = document.getElementById('lineup-rows');
const addTrickButton = document.getElementById('add-trick');
const lineupUpdatedEl = document.getElementById('lineup-updated');
const runTotalEl = document.getElementById('run-total');
const lineupTotalEl = document.getElementById('lineup-total');
const runForm = document.getElementById('run-form');
const runDateInput = document.getElementById('run-date');
const runTricksContainer = document.getElementById('run-tricks');
const runsList = document.getElementById('runs-list');
const messagesEl = document.getElementById('messages');

const DEFAULT_TIMEZONE = 'America/Los_Angeles';
let kwcTimeZone = DEFAULT_TIMEZONE;

let lineup = [];

function scoreFromCode(code) {
  if (!code) return 0;
  const [level] = code.split(/[-\s]/);
  const parsed = Number.parseInt(level, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function setMessage(type, text) {
  messagesEl.textContent = text;
  messagesEl.className = type ? type : '';
}

function clearMessage() {
  setMessage('', '');
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '?';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

function setConfiguredTimeZone(value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed || trimmed === kwcTimeZone) return;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed }).format(new Date());
    kwcTimeZone = trimmed;
    applyRunDateDefault(true);
  } catch (error) {
    console.warn('Ignoring invalid timezone from server', trimmed, error);
  }
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: kwcTimeZone,
      timeZoneName: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch (error) {
    console.warn('Falling back to local timestamp formatting', error);
    return date.toLocaleString();
  }
}

function getCurrentDateInConfiguredZone() {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: kwcTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const map = new Map();
    parts.forEach(part => {
      if (part.type !== 'literal' && !map.has(part.type)) {
        map.set(part.type, part.value);
      }
    });
    const year = map.get('year');
    const month = map.get('month');
    const day = map.get('day');
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (error) {
    console.warn('Falling back to UTC date for run input', error);
  }
  return new Date().toISOString().slice(0, 10);
}

function applyRunDateDefault(force = false) {
  if (!runDateInput) return;
  const userSet = runDateInput.dataset.userSet === 'true';
  if (!force && runDateInput.value) return;
  if (force && userSet) return;
  runDateInput.value = getCurrentDateInConfiguredZone();
  runDateInput.dataset.userSet = 'false';
}

function captureLineupFromDom() {
  const rows = Array.from(lineupRows.querySelectorAll('.trick-row'));
  if (!rows.length) {
    return [...lineup];
  }
  return rows.map(row => {
    const code = row.querySelector('input[data-field="code"]').value.trim();
    const label = row.querySelector('input[data-field="label"]').value.trim();
    const score = scoreFromCode(code);
    return {
      code,
      label,
      score,
    };
  });
}

function updateTotals() {
  const total = lineup.reduce((sum, trick) => sum + scoreFromCode(trick.code), 0);
  const text = `Total Score: ${total} points`;
  if (runTotalEl) runTotalEl.textContent = text;
  if (lineupTotalEl) lineupTotalEl.textContent = text;
}

function renderLineup() {
  lineupRows.innerHTML = '';
  if (!lineup.length) {
    const empty = document.createElement('p');
    empty.className = 'section-hint';
    empty.textContent = 'No tricks yet. Add at least one trick to build your run.';
    lineupRows.appendChild(empty);
    updateTotals();
    return;
  }

  lineup.forEach((trick, index) => {
    const row = document.createElement('div');
    row.className = 'trick-row';

    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = 'Code (e.g., 9-5)';
    codeInput.value = trick.code || '';
    codeInput.dataset.field = 'code';
    codeInput.required = true;

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'Label (optional)';
    labelInput.value = trick.label || '';
    labelInput.dataset.field = 'label';

    const score = scoreFromCode(trick.code);
    lineup[index].score = score;

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = score ? `${score} pts` : '—';

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const upButton = document.createElement('button');
    upButton.type = 'button';
    upButton.className = 'small-button';
    upButton.textContent = '↑';
    upButton.title = 'Move up';
    upButton.addEventListener('click', () => {
      lineup = captureLineupFromDom();
      if (index > 0) {
        [lineup[index - 1], lineup[index]] = [lineup[index], lineup[index - 1]];
        renderLineup();
        renderRunForm();
      }
    });

    const downButton = document.createElement('button');
    downButton.type = 'button';
    downButton.className = 'small-button';
    downButton.textContent = '↓';
    downButton.title = 'Move down';
    downButton.addEventListener('click', () => {
      lineup = captureLineupFromDom();
      if (index < lineup.length - 1) {
        [lineup[index + 1], lineup[index]] = [lineup[index], lineup[index + 1]];
        renderLineup();
        renderRunForm();
      }
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'small-button';
    removeButton.textContent = '✕';
    removeButton.title = 'Remove';
    removeButton.addEventListener('click', () => {
      lineup = captureLineupFromDom();
      if (lineup.length <= 1) {
        setMessage('error', 'Keep at least one trick in the lineup.');
        return;
      }
      lineup.splice(index, 1);
      renderLineup();
      renderRunForm();
    });

    actions.append(upButton, downButton, removeButton);
    row.append(codeInput, labelInput, scoreDisplay, actions);
    lineupRows.appendChild(row);

    codeInput.addEventListener('input', () => {
      const code = codeInput.value.trim();
      const updatedScore = scoreFromCode(code);
      scoreDisplay.textContent = updatedScore ? `${updatedScore} pts` : '—';
      lineup[index] = {
        ...lineup[index],
        code,
        score: updatedScore,
      };
      const runCard = runTricksContainer.querySelectorAll('.trick-card')[index];
      if (runCard) {
        const headingEl = runCard.querySelector('h3');
        if (headingEl) {
          const labelPart = lineup[index].label ? ` – ${lineup[index].label}` : '';
          headingEl.textContent = `${index + 1}. ${code || 'Trick'}${labelPart}`;
        }
        const scoreInfoEl = runCard.querySelector('.timestamp');
        if (scoreInfoEl) {
          scoreInfoEl.textContent = `Score: ${updatedScore} point${updatedScore === 1 ? '' : 's'}`;
        }
      }
      updateTotals();
    });

    labelInput.addEventListener('input', () => {
      lineup[index] = {
        ...lineup[index],
        label: labelInput.value.trim(),
      };
      const runCard = runTricksContainer.querySelectorAll('.trick-card')[index];
      if (runCard) {
        const headingEl = runCard.querySelector('h3');
        if (headingEl) {
          const labelPart = lineup[index].label ? ` – ${lineup[index].label}` : '';
          headingEl.textContent = `${index + 1}. ${lineup[index].code || 'Trick'}${labelPart}`;
        }
      }
    });
  });

  updateTotals();
}

function renderRunForm() {
  runTricksContainer.innerHTML = '';
  if (!lineup.length) {
    const hint = document.createElement('p');
    hint.className = 'section-hint';
    hint.textContent = 'Save a lineup to unlock run logging.';
    runTricksContainer.appendChild(hint);
    runForm.querySelector('button[type="submit"]').disabled = true;
    updateTotals();
    return;
  }

  runForm.querySelector('button[type="submit"]').disabled = false;

  lineup.forEach((trick, index) => {
    const card = document.createElement('div');
    card.className = 'trick-card';

    const heading = document.createElement('h3');
    const labelPart = trick.label ? ` – ${trick.label}` : '';
    heading.textContent = `${index + 1}. ${trick.code || 'Trick'}${labelPart}`;
    card.appendChild(heading);

    const scoreInfo = document.createElement('p');
    scoreInfo.className = 'timestamp';
    const score = scoreFromCode(trick.code);
    lineup[index].score = score;
    scoreInfo.textContent = `Score: ${score} point${score === 1 ? '' : 's'}`;
    card.appendChild(scoreInfo);

    const attemptsLabel = document.createElement('label');
    attemptsLabel.textContent = 'Attempt durations (seconds)';

    const attemptsInput = document.createElement('input');
    attemptsInput.type = 'text';
    attemptsInput.name = `attempts-${index}`;
    attemptsInput.placeholder = 'e.g., 40, 37.5, 32';
    attemptsInput.autocomplete = 'off';

    attemptsLabel.appendChild(attemptsInput);
    card.appendChild(attemptsLabel);
    runTricksContainer.appendChild(card);
  });

  updateTotals();
}

async function loadLineup() {
  try {
    const response = await fetch(`${API_BASE}/lineup`);
    if (!response.ok) {
      throw new Error(`Failed with status ${response.status}`);
    }
    const data = await response.json();
    setConfiguredTimeZone(data.timeZone);
    const tricks = Array.isArray(data.lineup?.tricks) ? data.lineup.tricks : [];
    lineup = tricks.map(trick => {
      const code = trick.code || '';
      const score = Number.isFinite(trick.score) ? trick.score : scoreFromCode(code);
      return {
        code,
        label: trick.label || '',
        score,
      };
    });
    renderLineup();
    renderRunForm();
    if (data.lineup?.updatedAt) {
      const stamp = formatTimestamp(data.lineup.updatedAt);
      lineupUpdatedEl.textContent = stamp ? `Last updated ${stamp}` : '';
    } else {
      lineupUpdatedEl.textContent = lineup.length ? 'Lineup loaded.' : 'No lineup saved yet.';
    }
  } catch (error) {
    console.error('Failed to load lineup', error);
    setMessage('error', 'Unable to load lineup.');
    lineup = [];
    renderLineup();
    renderRunForm();
  }
}

async function loadRuns() {
  try {
    const response = await fetch(`${API_BASE}/runs`);
    if (!response.ok) {
      throw new Error(`Failed with status ${response.status}`);
    }
    const data = await response.json();
    setConfiguredTimeZone(data.timeZone);
    renderRunsList(Array.isArray(data.runs) ? data.runs : []);
  } catch (error) {
    console.error('Failed to load runs', error);
    setMessage('error', 'Unable to load run history.');
  }
}

function renderRunsList(runs) {
  runsList.innerHTML = '';
  if (!runs.length) {
    const empty = document.createElement('p');
    empty.className = 'section-hint';
    empty.textContent = 'No runs recorded yet. Enter your first session above.';
    runsList.appendChild(empty);
    return;
  }

  runs.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-item';

    const title = document.createElement('h3');
    title.textContent = run.date;
    item.appendChild(title);

    if (run.notes) {
      const notes = document.createElement('p');
      notes.textContent = run.notes;
      item.appendChild(notes);
    }

    const meta = document.createElement('p');
    meta.className = 'timestamp';
    const totalScore = (run.tricks || []).reduce((sum, trick) => {
      const score = Number.isFinite(trick.score) ? trick.score : scoreFromCode(trick.code);
      return sum + score;
    }, 0);
    const totalSeconds = (run.tricks || []).reduce((sum, trick) => {
      const attempts = Array.isArray(trick.attempts) ? trick.attempts : [];
      const attemptTotal = attempts.reduce((innerSum, attempt) => {
        const value = Number(attempt.durationSeconds);
        return Number.isFinite(value) && value >= 0 ? innerSum + value : innerSum;
      }, 0);
      return sum + attemptTotal;
    }, 0);
    const timestamp = formatTimestamp(run.recordedAt);
    const stampText = timestamp ? `Logged ${timestamp}` : 'Logged';
    meta.textContent = `${stampText} • Total Score: ${totalScore} points • Total Time: ${Math.round(totalSeconds)}s`;
    item.appendChild(meta);

    const list = document.createElement('ul');
    (run.tricks || []).forEach((trick, index) => {
      const li = document.createElement('li');
      const attempts = (trick.attempts || []).map(entry => formatDuration(entry.durationSeconds)).join(', ');
      const labelPart = trick.label ? ` – ${trick.label}` : '';
      const score = Number.isFinite(trick.score) ? trick.score : scoreFromCode(trick.code);
      li.textContent = `${index + 1}. ${trick.code || 'Trick'}${labelPart} (${score} pts): ${attempts}`;
      list.appendChild(li);
    });
    item.appendChild(list);

    runsList.appendChild(item);
  });
}

async function handleLineupSubmit(event) {
  event.preventDefault();
  clearMessage();
  lineup = captureLineupFromDom();
  const cleaned = lineup.map(trick => {
    const code = trick.code.trim();
    const score = scoreFromCode(code);
    return {
      code,
      label: trick.label.trim(),
      score,
    };
  });

  if (cleaned.some(trick => !trick.code)) {
    setMessage('error', 'Each trick needs a code.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/lineup`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tricks: cleaned.map(trick => ({
        code: trick.code,
        label: trick.label || undefined,
        score: trick.score,
      })) }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed with status ${response.status}`);
    }
    const data = await response.json();
    setConfiguredTimeZone(data.timeZone);
    const tricks = Array.isArray(data.lineup?.tricks) ? data.lineup.tricks : cleaned;
    lineup = tricks.map(trick => {
      const code = trick.code || '';
      const score = Number.isFinite(trick.score) ? trick.score : scoreFromCode(code);
      return {
        code,
        label: trick.label || '',
        score,
      };
    });
    renderLineup();
    renderRunForm();
    const stamp = data.lineup?.updatedAt ? formatTimestamp(data.lineup.updatedAt) : '';
    lineupUpdatedEl.textContent = stamp ? `Last updated ${stamp}` : 'Lineup saved.';
    setMessage('success', 'Lineup saved.');
  } catch (error) {
    console.error('Failed to save lineup', error);
    setMessage('error', 'Unable to save lineup.');
  }
}

async function handleRunSubmit(event) {
  event.preventDefault();
  clearMessage();

  if (!lineup.length) {
    setMessage('error', 'Add and save a lineup before logging runs.');
    return;
  }

  const formData = new FormData(runForm);
  const date = formData.get('date');
  if (!date) {
    setMessage('error', 'Date is required.');
    return;
  }

  const tricksPayload = [];
  for (let index = 0; index < lineup.length; index += 1) {
    const attemptsRaw = formData.get(`attempts-${index}`);
    const attempts = parseAttempts(attemptsRaw);
    if (!attempts.length) {
      setMessage('error', `Enter at least one attempt time for trick ${index + 1}.`);
      return;
    }
    tricksPayload.push({
      code: lineup[index].code,
      label: lineup[index].label ? lineup[index].label : undefined,
      score: scoreFromCode(lineup[index].code),
      attempts: attempts.map(value => ({ durationSeconds: value })),
    });
  }

  const notesRaw = formData.get('notes');
  const payload = {
    date: date.toString(),
    notes: notesRaw ? notesRaw.toString().trim() || undefined : undefined,
    tricks: tricksPayload,
  };

  try {
    const response = await fetch(`${API_BASE}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed with status ${response.status}`);
    }
    const data = await response.json();
    setConfiguredTimeZone(data.timeZone);
    await loadRuns();
    runForm.reset();
    if (runDateInput) {
      runDateInput.value = getCurrentDateInConfiguredZone();
      runDateInput.dataset.userSet = 'false';
    }
    renderRunForm();
    setMessage('success', 'Run recorded.');
  } catch (error) {
    console.error('Failed to record run', error);
    setMessage('error', 'Unable to record run.');
  }
}

function parseAttempts(value) {
  if (value == null) return [];
  return parseAttemptsValue(value.toString());
}

function parseAttemptsValue(source) {
  return source
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0);
}

addTrickButton.addEventListener('click', () => {
  clearMessage();
  lineup = captureLineupFromDom();
  lineup.push({ code: '', label: '', score: 0 });
  renderLineup();
  renderRunForm();
});

lineupForm.addEventListener('submit', handleLineupSubmit);
runForm.addEventListener('submit', handleRunSubmit);

if (runDateInput) {
  runDateInput.addEventListener('input', () => {
    runDateInput.dataset.userSet = 'true';
  });
}

applyRunDateDefault(true);
loadLineup().then(() => {
  if (!lineup.length) {
    // Seed with ten blank rows to guide input.
    lineup = Array.from({ length: 10 }, () => ({ code: '', label: '', score: 0 }));
    renderLineup();
    renderRunForm();
  }
});
loadRuns();
