/* eslint-env browser */
/* global document, fetch, console, window, URL */

const API_ANALYTICS = '/kwc/api/analytics';

const windowSelect = document.getElementById('window-select');
const overviewWindow = document.getElementById('overview-window');
const overviewRunCount = document.getElementById('overview-run-count');
const overviewMedianTime = document.getElementById('overview-median-time');
const trickTableBody = document.getElementById('trick-table-body');
const trendGrid = document.getElementById('trend-grid');
const consistentRunsBody = document.getElementById('consistent-runs-body');
const recentRunsList = document.getElementById('recent-runs-list');
const messagesEl = document.getElementById('messages');

function setMessage(type, text) {
  messagesEl.textContent = text;
  messagesEl.className = type ? type : '';
}

function formatSeconds(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

function formatWindow(days, windowSize) {
  const parts = [];
  if (days) parts.push(`${days}-day window`);
  if (windowSize) parts.push(`rolling ${windowSize}-day median`);
  return parts.length ? parts.join(' · ') : 'Full history';
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function createSparkline(points) {
  const values = points
    .filter(point => point.rollingMedian !== null)
    .map(point => ({ date: point.date, value: point.rollingMedian }));
  if (!values.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'sparkline-empty';
    placeholder.textContent = 'Not enough data';
    return placeholder;
  }

  const width = 160;
  const height = 48;
  const minValue = Math.min(...values.map(point => point.value));
  const maxValue = Math.max(...values.map(point => point.value));
  const range = maxValue - minValue || 1;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('sparkline');

  const coords = values.map((point, index) => {
    const ratio = values.length === 1 ? 0 : index / (values.length - 1);
    const x = 4 + ratio * (width - 8);
    const normalized = (point.value - minValue) / range;
    const y = height - 4 - normalized * (height - 8);
    return `${x},${y}`;
  });

  const path = document.createElementNS(svgNS, 'polyline');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('points', coords.join(' '));
  svg.appendChild(path);

  return svg;
}

function renderOverview(analytics) {
  overviewWindow.textContent = formatWindow(analytics.windowDays, analytics.windowSize);
  overviewRunCount.textContent = String(analytics.recentRuns.length);
  overviewMedianTime.textContent = formatSeconds(analytics.medianTotalRunSeconds);
}

function renderTrickTable(trickStats) {
  clearChildren(trickTableBody);
  if (!trickStats.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No trick data available yet.';
    row.appendChild(cell);
    trickTableBody.appendChild(row);
    return;
  }

  for (const item of trickStats) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = item.code;
    row.appendChild(nameCell);

    const medianCell = document.createElement('td');
    medianCell.textContent = formatSeconds(item.stats.medianSeconds);
    row.appendChild(medianCell);

    const iqrCell = document.createElement('td');
    iqrCell.textContent = item.stats.interquartileRangeSeconds !== null
      ? formatSeconds(item.stats.interquartileRangeSeconds)
      : '—';
    row.appendChild(iqrCell);

    const attemptsCell = document.createElement('td');
    attemptsCell.textContent = String(item.stats.sampleCount);
    row.appendChild(attemptsCell);

    const outlierCell = document.createElement('td');
    if (item.stats.outliers.length) {
      outlierCell.textContent = item.stats.outliers.map(value => formatSeconds(value)).join(', ');
      outlierCell.classList.add('warning-text');
    } else {
      outlierCell.textContent = 'None';
    }
    row.appendChild(outlierCell);

    trickTableBody.appendChild(row);
  }
}

function renderTrends(trickStats, summary) {
  clearChildren(trendGrid);
  if (!trickStats.length) {
    const placeholder = document.createElement('p');
    placeholder.className = 'section-hint';
    placeholder.textContent = 'No trend data available yet.';
    trendGrid.appendChild(placeholder);
    return;
  }

  const directionLabels = {
    improving: 'Improving',
    regressing: 'Regressing',
    stable: 'Stable',
    'insufficient-data': 'Needs more data',
  };

  const consistencyLabels = {
    'more-consistent': 'More consistent',
    'less-consistent': 'Less consistent',
    'unchanged': 'Consistency unchanged',
    'insufficient-data': 'Needs more data',
  };

  for (const item of trickStats) {
    const card = document.createElement('div');
    card.className = 'trend-card';

    const title = document.createElement('h3');
    title.textContent = item.code;
    card.appendChild(title);

    const spark = createSparkline(item.trend.points);
    card.appendChild(spark);

    const direction = document.createElement('p');
    direction.className = 'trend-meta';
    direction.textContent = directionLabels[item.trend.direction] ?? '—';
    card.appendChild(direction);

    const consistency = document.createElement('p');
    consistency.className = 'trend-meta';
    consistency.textContent = consistencyLabels[item.trend.consistency] ?? '—';
    card.appendChild(consistency);

    trendGrid.appendChild(card);
  }

  // Summary section for improving/regressing lists
  const summaryCard = document.createElement('div');
  summaryCard.className = 'trend-summary';

  const buildList = (label, items) => {
    const section = document.createElement('div');
    const heading = document.createElement('h4');
    heading.textContent = label;
    section.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'section-hint';
      empty.textContent = '—';
      section.appendChild(empty);
      return section;
    }
    const list = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item.code;
      list.appendChild(li);
    }
    section.appendChild(list);
    return section;
  };

  const improvingSection = buildList('Improving', summary.improving);
  const regressingSection = buildList('Regressing', summary.regressing);
  const stableSection = buildList('Stable', summary.stable);

  summaryCard.append(improvingSection, regressingSection, stableSection);
  trendGrid.appendChild(summaryCard);
}

function renderConsistentRuns(runs) {
  clearChildren(consistentRunsBody);
  if (!runs.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No runs yet';
    row.appendChild(cell);
    consistentRunsBody.appendChild(row);
    return;
  }

  for (const run of runs) {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = run.date;
    row.appendChild(dateCell);

    const timeCell = document.createElement('td');
    timeCell.textContent = formatSeconds(run.total_seconds);
    row.appendChild(timeCell);

    const scoreCell = document.createElement('td');
    scoreCell.textContent = String(run.total_score);
    row.appendChild(scoreCell);

    const varianceCell = document.createElement('td');
    varianceCell.textContent = run.trick_variance !== null && run.trick_variance !== undefined
      ? run.trick_variance.toFixed(2)
      : '—';
    row.appendChild(varianceCell);

    consistentRunsBody.appendChild(row);
  }
}

function renderRecentRuns(runs) {
  clearChildren(recentRunsList);
  if (!runs.length) {
    const empty = document.createElement('p');
    empty.className = 'section-hint';
    empty.textContent = 'No runs logged in this window.';
    recentRunsList.appendChild(empty);
    return;
  }

  for (const run of runs) {
    const card = document.createElement('div');
    card.className = 'run-item';

    const header = document.createElement('h3');
    header.textContent = `${run.date} — ${formatSeconds(run.totalRunTimeSeconds)} (${run.totalScore} pts)`;
    card.appendChild(header);

    if (run.notes) {
      const notes = document.createElement('p');
      notes.textContent = run.notes;
      card.appendChild(notes);
    }

    const list = document.createElement('ul');
    for (const summary of run.trickSummaries) {
      const li = document.createElement('li');
      const attemptsText = summary.attempts.length
        ? summary.attempts.map(value => formatSeconds(value)).join(', ')
        : '—';
      li.textContent = `${summary.code}: ${attemptsText}`;
      list.appendChild(li);
    }
    card.appendChild(list);

    recentRunsList.appendChild(card);
  }
}

async function loadAnalytics(days = 30) {
  try {
    setMessage('', '');
    const url = new URL(API_ANALYTICS, window.location.origin);
    if (days) url.searchParams.set('days', String(days));
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Analytics request failed with status ${response.status}`);
    }
    const data = await response.json();
    const analytics = data.analytics;
    if (!analytics) {
      setMessage('error', 'Analytics payload missing from response');
      return;
    }

    renderOverview(analytics);
    renderTrickTable(analytics.trickStats);
    renderTrends(analytics.trickStats, analytics.trendSummary);
    renderConsistentRuns(analytics.topConsistentRuns);
    renderRecentRuns(analytics.recentRuns);
  } catch (error) {
    console.error('Failed to load analytics', error);
    setMessage('error', 'Unable to load analytics data.');
  }
}

windowSelect.addEventListener('change', () => {
  const value = Number.parseInt(windowSelect.value, 10);
  loadAnalytics(Number.isFinite(value) ? value : 30);
});

loadAnalytics(Number.parseInt(windowSelect.value, 10) || 30);
