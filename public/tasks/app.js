// State management
let currentProject = null;
const state = {
  projects: [],
  tasks: [],
  stats: {},
};

// DOM elements
const projectsList = document.getElementById('projects-list');
const statsSection = document.getElementById('stats-section');
const controlsSection = document.getElementById('controls-section');
const tasksSection = document.getElementById('tasks-section');
const createSection = document.getElementById('create-section');
const tasksList = document.getElementById('tasks-list');
const emptyState = document.getElementById('empty-state');
const messages = document.getElementById('messages');
const statusFilter = document.getElementById('status-filter');
const priorityFilter = document.getElementById('priority-filter');
const refreshBtn = document.getElementById('refresh-btn');
const createTaskBtn = document.getElementById('create-task-btn');
const createTaskForm = document.getElementById('create-task-form');
const cancelCreateBtn = document.getElementById('cancel-create-btn');

// Utility functions
function showMessage(text, type = 'success') {
  messages.textContent = text;
  messages.className = type;
  setTimeout(() => {
    messages.textContent = '';
    messages.className = '';
  }, 5000);
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// API functions
async function fetchProjects() {
  try {
    // For now, we'll hardcode the known projects
    // In the future, we could expose project list via an API endpoint
    state.projects = [{ id: 'kotadb', name: 'KotaDB' }];
    renderProjects();

    // Auto-select the first project if we have any
    if (state.projects.length > 0 && !currentProject) {
      currentProject = state.projects[0].id;
      renderProjects();
      showProjectSections();
      fetchTasks();
    }
  } catch (error) {
    console.error('Error fetching projects:', error);
    showMessage('Failed to load projects', 'error');
  }
}

async function fetchTasks() {
  if (!currentProject) return;

  const status = statusFilter.value;
  const priority = priorityFilter.value;

  const params = new URLSearchParams();
  if (status !== 'all') params.append('status', status);
  if (priority !== 'all') params.append('priority', priority);
  params.append('limit', '100');

  try {
    const response = await fetch(`/api/tasks/${currentProject}?${params}`);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    state.tasks = await response.json();
    calculateStats();
    renderStats();
    renderTasks();
  } catch (error) {
    console.error('Error fetching tasks:', error);
    showMessage('Failed to load tasks', 'error');
  }
}

async function createTask(taskData) {
  if (!currentProject) return;

  try {
    const response = await fetch(`/api/tasks/${currentProject}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create task');
    }

    const task = await response.json();
    showMessage(`Task created: ${task.title}`, 'success');
    createSection.style.display = 'none';
    createTaskForm.reset();
    await fetchTasks();
  } catch (error) {
    console.error('Error creating task:', error);
    showMessage(error.message, 'error');
  }
}

async function deleteTask(taskId) {
  if (!currentProject) return;
  if (!confirm('Are you sure you want to delete this task?')) return;

  try {
    const response = await fetch(`/api/tasks/${currentProject}/${taskId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete task');
    }

    showMessage('Task deleted successfully', 'success');
    await fetchTasks();
  } catch (error) {
    console.error('Error deleting task:', error);
    showMessage(error.message, 'error');
  }
}

// Rendering functions
function renderProjects() {
  projectsList.innerHTML = state.projects
    .map(
      (project) => `
      <button
        class="project-btn ${currentProject === project.id ? 'active' : ''}"
        data-project="${project.id}"
      >
        ${project.name}
      </button>
    `
    )
    .join('');

  // Add click handlers
  projectsList.querySelectorAll('.project-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentProject = btn.dataset.project;
      renderProjects();
      showProjectSections();
      fetchTasks();
    });
  });
}

function showProjectSections() {
  statsSection.style.display = 'block';
  controlsSection.style.display = 'block';
  tasksSection.style.display = 'block';
  document.getElementById('project-title').textContent =
    state.projects.find(p => p.id === currentProject)?.name + ' Overview' || 'Project Overview';
}

function calculateStats() {
  state.stats = {
    pending: 0,
    claimed: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
  };

  // Calculate from current filtered view
  state.tasks.forEach((task) => {
    if (state.stats[task.status] !== undefined) {
      state.stats[task.status]++;
    }
  });
}

function renderStats() {
  document.getElementById('stat-pending').textContent = state.stats.pending || 0;
  document.getElementById('stat-claimed').textContent = state.stats.claimed || 0;
  document.getElementById('stat-in-progress').textContent = state.stats.in_progress || 0;
  document.getElementById('stat-completed').textContent = state.stats.completed || 0;
  document.getElementById('stat-failed').textContent = state.stats.failed || 0;
}

function renderTasks() {
  if (state.tasks.length === 0) {
    tasksList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  tasksList.innerHTML = state.tasks
    .map((task) => renderTaskCard(task))
    .join('');

  // Add delete button handlers
  tasksList.querySelectorAll('[data-delete-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteTask(btn.dataset.deleteTask);
    });
  });
}

function renderTaskCard(task) {
  const tags = task.tags
    ? Object.entries(task.tags)
        .map(([key, value]) => `<span class="tag-item">${key}: ${value}</span>`)
        .join('')
    : '';

  const error = task.error
    ? `<div class="task-error"><strong>Error:</strong> ${escapeHtml(task.error)}</div>`
    : '';

  const result = task.result
    ? `<div class="task-result"><strong>Result:</strong><pre>${escapeHtml(
        JSON.stringify(task.result, null, 2)
      )}</pre></div>`
    : '';

  return `
    <div class="task-item">
      <div class="task-header">
        <div class="task-title-section">
          <h3>${escapeHtml(task.title)}</h3>
          <div class="task-meta">
            <span class="status-badge status-${task.status}">${task.status.replace('_', ' ')}</span>
            <span class="priority-badge priority-${task.priority}">${task.priority}</span>
            <span class="timestamp">Created ${formatRelativeTime(task.created_at)}</span>
            ${task.adw_id ? `<span>ADW: ${escapeHtml(task.adw_id)}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="small-button" data-delete-task="${task.task_id}">Delete</button>
        </div>
      </div>

      <div class="task-description">${escapeHtml(task.description)}</div>

      ${tags ? `<div class="task-tags">${tags}</div>` : ''}
      ${error}
      ${result}

      <div class="task-details">
        ${task.worktree ? `
          <div class="task-detail-item">
            <span class="detail-label">Worktree</span>
            <span class="detail-value">${escapeHtml(task.worktree)}</span>
          </div>
        ` : ''}
        ${task.claimed_at ? `
          <div class="task-detail-item">
            <span class="detail-label">Claimed At</span>
            <span class="detail-value">${formatDate(task.claimed_at)}</span>
          </div>
        ` : ''}
        ${task.completed_at ? `
          <div class="task-detail-item">
            <span class="detail-label">Completed At</span>
            <span class="detail-value">${formatDate(task.completed_at)}</span>
          </div>
        ` : ''}
        ${task.commit_hash ? `
          <div class="task-detail-item">
            <span class="detail-label">Commit Hash</span>
            <span class="detail-value">${escapeHtml(task.commit_hash)}</span>
          </div>
        ` : ''}
        <div class="task-detail-item">
          <span class="detail-label">Task ID</span>
          <span class="detail-value">${escapeHtml(task.task_id)}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Event handlers
statusFilter.addEventListener('change', fetchTasks);
priorityFilter.addEventListener('change', fetchTasks);
refreshBtn.addEventListener('click', fetchTasks);

createTaskBtn.addEventListener('click', () => {
  createSection.style.display = 'block';
  createSection.scrollIntoView({ behavior: 'smooth' });
});

cancelCreateBtn.addEventListener('click', () => {
  createSection.style.display = 'none';
  createTaskForm.reset();
});

createTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const taskData = {
    title: formData.get('title'),
    description: formData.get('description'),
    priority: formData.get('priority'),
  };

  const worktree = formData.get('worktree');
  if (worktree) {
    taskData.worktree = worktree;
  }

  const tagsText = formData.get('tags');
  if (tagsText.trim()) {
    try {
      taskData.tags = JSON.parse(tagsText);
    } catch (error) {
      showMessage('Invalid JSON format for tags', 'error');
      return;
    }
  }

  await createTask(taskData);
});

// Auto-refresh every 30 seconds
setInterval(() => {
  if (currentProject) {
    fetchTasks();
  }
}, 30000);

// Initialize
fetchProjects();
